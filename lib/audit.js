import { normalizeDoi } from './bibtex.js'
import { parseNameList } from './names.js'
import { clip, foldForCompare, normalizeSpace, stripLatex, titleSimilarity } from './text.js'

export const SEVERITIES = ['error', 'warning', 'info']

// Each requirement is a list of alternative field names; the entry must carry at
// least one of them.
const REQUIRED_FIELDS = {
  article: [['author'], ['title'], ['journal', 'journaltitle'], ['year']],
  inproceedings: [['author'], ['title'], ['booktitle'], ['year']],
  conference: [['author'], ['title'], ['booktitle'], ['year']],
  incollection: [['author'], ['title'], ['booktitle'], ['publisher'], ['year']],
  book: [['author', 'editor'], ['title'], ['publisher'], ['year']],
  proceedings: [['title'], ['year']],
  phdthesis: [['author'], ['title'], ['school'], ['year']],
  mastersthesis: [['author'], ['title'], ['school'], ['year']],
  thesis: [['author'], ['title'], ['school'], ['year']],
  techreport: [['author'], ['title'], ['institution'], ['year']],
  report: [['author'], ['title'], ['institution'], ['year']],
  unpublished: [['author'], ['title'], ['note']],
  manual: [['title']],
  booklet: [['title']],
  misc: [['title']],
  online: [['title'], ['url']],
  software: [['title']],
  dataset: [['title']],
}

export const KNOWN_TYPES = Object.keys(REQUIRED_FIELDS)

const DOI_SHAPE = /^10\.\d{4,9}\/\S+$/
const PAGES_SHAPE = /^\s*[A-Za-z]?\d+\s*(?:--|-|–|—)\s*[A-Za-z]?\d+\s*$|^\s*[A-Za-z]?\d+\s*$|^\s*e\d+\s*$/
const ET_AL = /\bet\s*\.?\s*al\b|\bet\.?\s*al\b|等|…/iu

function issue(severity, code, key, field, message) {
  return { severity, code, key, field, message }
}

function yearOf(entry) {
  const raw = entry.fields.year ?? entry.fields.date ?? ''
  const match = /\b(\d{4})\b/.exec(String(raw))
  return match ? Number(match[1]) : null
}

function firstFamily(entry) {
  const raw = entry.fields.author ?? entry.fields.editor ?? ''
  const names = parseNameList(raw)
  return names.length ? stripLatex(names[0].family) : ''
}

/**
 * Structural checks. `options.now` is injectable so the future-year rule is
 * deterministic in tests.
 */
export function runLocalChecks(entries, { parseErrors = [], now = () => new Date() } = {}) {
  const issues = []
  const currentYear = now().getFullYear()

  for (const error of parseErrors) {
    issues.push(issue('error', 'PARSE_ERROR', '', '', `line ${error.line}: ${error.message}`))
  }

  const byKey = new Map()
  for (const entry of entries) {
    if (!byKey.has(entry.key)) byKey.set(entry.key, [])
    byKey.get(entry.key).push(entry)
  }
  for (const [key, group] of byKey) {
    if (group.length > 1) {
      const lines = group.map((entry) => entry.line).join(', ')
      issues.push(
        issue('error', 'DUPLICATE_KEY', key, '', `${group.length} entries share this key (lines ${lines})`),
      )
    }
  }

  for (const entry of entries) {
    const required = REQUIRED_FIELDS[entry.type]
    if (!required) {
      issues.push(
        issue('warning', 'UNKNOWN_TYPE', entry.key, 'type', `unknown entry type "@${entry.type}"`),
      )
    } else {
      for (const alternatives of required) {
        const present = alternatives.some((field) => normalizeSpace(entry.fields[field] ?? '') !== '')
        if (!present) {
          issues.push(
            issue(
              'error',
              'MISSING_REQUIRED',
              entry.key,
              alternatives[0],
              `@${entry.type} is missing ${alternatives.join(' or ')}`,
            ),
          )
        }
      }
    }

    for (const [field, rawValue] of Object.entries(entry.fields)) {
      if (normalizeSpace(rawValue) === '') {
        issues.push(issue('warning', 'EMPTY_FIELD', entry.key, field, `field "${field}" is empty`))
        continue
      }
      if (field === 'author' || field === 'editor') {
        if (ET_AL.test(rawValue)) {
          issues.push(
            issue(
              'warning',
              'AUTHOR_ET_AL',
              entry.key,
              field,
              'author lists cannot contain "et al." / "等" — list every author or use the "and others" form',
            ),
          )
        }
      }
      if (field === 'year') {
        const year = yearOf(entry)
        if (year === null) {
          issues.push(issue('error', 'INVALID_YEAR', entry.key, 'year', `"${clip(rawValue, 40)}" is not a 4-digit year`))
        } else if (year > currentYear + 1) {
          issues.push(issue('warning', 'FUTURE_YEAR', entry.key, 'year', `${year} is in the future`))
        }
      }
      if (field === 'doi') {
        const doi = normalizeDoi(rawValue)
        if (!DOI_SHAPE.test(doi)) {
          issues.push(issue('warning', 'INVALID_DOI', entry.key, 'doi', `"${clip(rawValue, 60)}" is not a bare DOI`))
        } else if (doi !== normalizeSpace(rawValue)) {
          issues.push(issue('info', 'DOI_NOT_BARE', entry.key, 'doi', `use "${doi}" without the URL prefix`))
        }
      }
      if (field === 'pages' && !PAGES_SHAPE.test(rawValue)) {
        issues.push(
          issue('info', 'PAGES_FORMAT', entry.key, 'pages', `"${clip(rawValue, 40)}" is not "first--last"`),
        )
      }
    }

    if ((entry.type === 'article' || entry.type === 'inproceedings') && !entry.fields.doi) {
      issues.push(issue('info', 'MISSING_DOI', entry.key, 'doi', 'no DOI, so it cannot be verified'))
    }
  }

  // The same work published under two keys is the expensive mistake: it survives
  // review and splits a citation count. Compare on DOI, else on title + year.
  const seen = new Map()
  for (const entry of entries) {
    const doi = normalizeDoi(entry.fields.doi ?? '').toLowerCase()
    const title = foldForCompare(entry.fields.title ?? '')
    const fingerprint = doi
      ? `doi:${doi}`
      : title
        ? `title:${title}|${yearOf(entry) ?? ''}|${foldForCompare(firstFamily(entry))}`
        : ''
    if (!fingerprint) continue
    const previous = seen.get(fingerprint)
    if (previous) {
      issues.push(
        issue(
          'warning',
          'DUPLICATE_WORK',
          entry.key,
          '',
          `same work as "${previous.key}" (line ${previous.line})`,
        ),
      )
    } else {
      seen.set(fingerprint, entry)
    }
  }

  return issues.sort(bySeverityThenKey)
}

function bySeverityThenKey(a, b) {
  const rank = (severity) => SEVERITIES.indexOf(severity)
  return rank(a.severity) - rank(b.severity) || a.key.localeCompare(b.key) || a.code.localeCompare(b.code)
}

/** Stable ordering for a mixed list of local and Crossref issues. */
export function sortIssues(issues) {
  return [...issues].sort(bySeverityThenKey)
}

/** Build one issue with the shape the output schema declares. */
export function makeIssue(severity, code, key, field, message) {
  return issue(severity, code, key, field, message)
}

/**
 * Compare one entry against a normalized Crossref record (see lib/crossref.js).
 * Purely a judgement call on values that are already in hand.
 */
export function compareWithWork(entry, work, { titleThreshold = 0.9, venueThreshold = 0.85 } = {}) {
  const issues = []
  const localTitle = stripLatex(entry.fields.title ?? '')
  const remoteTitle = stripLatex(work.title ?? '')

  if (localTitle && remoteTitle) {
    const similarity = titleSimilarity(localTitle, remoteTitle)
    if (similarity < titleThreshold) {
      issues.push(
        issue(
          'warning',
          'TITLE_MISMATCH',
          entry.key,
          'title',
          `similarity ${similarity.toFixed(2)} against Crossref title "${clip(remoteTitle, 90)}"`,
        ),
      )
    }
  } else if (!localTitle && remoteTitle) {
    issues.push(issue('info', 'TITLE_MISSING', entry.key, 'title', `Crossref has "${clip(remoteTitle, 90)}"`))
  }

  const localYear = yearOf(entry)
  if (localYear !== null && work.year && Math.abs(localYear - work.year) > 1) {
    issues.push(
      issue('warning', 'YEAR_MISMATCH', entry.key, 'year', `entry says ${localYear}, Crossref says ${work.year}`),
    )
  }

  const localFirst = firstFamily(entry)
  const remoteFirst = work.authorFamilies?.[0] ?? work.authors?.[0] ?? ''
  if (localFirst && remoteFirst && foldForCompare(localFirst) !== foldForCompare(remoteFirst)) {
    issues.push(
      issue(
        'warning',
        'AUTHOR_MISMATCH',
        entry.key,
        'author',
        `first author is "${localFirst}", Crossref says "${remoteFirst}"`,
      ),
    )
  }

  const localVenue = entry.fields.journal ?? entry.fields.journaltitle ?? entry.fields.booktitle ?? ''
  if (localVenue && work.containerTitle) {
    const similarity = titleSimilarity(stripLatex(localVenue), stripLatex(work.containerTitle))
    if (similarity < venueThreshold) {
      issues.push(
        issue(
          'info',
          'VENUE_MISMATCH',
          entry.key,
          'journal',
          `venue "${clip(localVenue, 60)}" vs Crossref "${clip(work.containerTitle, 60)}"`,
        ),
      )
    }
  }

  if (work.retracted) {
    issues.push(issue('error', 'RETRACTED', entry.key, 'doi', 'Crossref marks this work as retracted'))
  }

  return issues
}

export function summarize(issues) {
  const summary = { errors: 0, warnings: 0, infos: 0 }
  for (const item of issues) {
    if (item.severity === 'error') summary.errors += 1
    else if (item.severity === 'warning') summary.warnings += 1
    else summary.infos += 1
  }
  return summary
}
