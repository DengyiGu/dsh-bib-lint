import { parseName, splitNames } from './names.js'
import { normalizeDoi } from './bibtex.js'
import { normalizeSpace, stripLatex } from './text.js'

export const STYLES = ['gbt7714', 'apa', 'ieee', 'vancouver']

const GB_TYPE_MARK = {
  article: 'J',
  inproceedings: 'C',
  conference: 'C',
  incollection: 'C',
  book: 'M',
  proceedings: 'C',
  phdthesis: 'D',
  mastersthesis: 'D',
  thesis: 'D',
  techreport: 'R',
  report: 'R',
  online: 'EB/OL',
  misc: 'Z',
  unpublished: 'Z',
  manual: 'M',
  booklet: 'M',
  software: 'CP/OL',
  dataset: 'DS/OL',
}

function names(entry) {
  const field = entry.fields.author ?? entry.fields.editor ?? ''
  const raw = splitNames(field)
  const people = raw.filter((item) => item.toLowerCase() !== 'others').map(parseName)
  return { people, etAl: raw.length !== people.length }
}

function compactInitials(given) {
  return normalizeSpace(given)
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.replace(/[{}]/g, '')[0])
    .filter(Boolean)
    .join('')
}

function dottedInitials(given) {
  return compactInitials(given)
    .split('')
    .map((letter) => `${letter}.`)
    .join(' ')
}

function yearOf(entry) {
  const match = /\b(\d{4})\b/.exec(String(entry.fields.year ?? entry.fields.date ?? ''))
  return match ? match[1] : ''
}

function pages(entry, { enDash = false } = {}) {
  const raw = normalizeSpace(entry.fields.pages ?? '')
  if (!raw) return ''
  return raw.replace(/\s*(?:--|–|—|-)\s*/g, enDash ? '–' : '-')
}

function ensureStop(text) {
  const trimmed = normalizeSpace(text)
  if (!trimmed) return ''
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

function trimStop(text) {
  return normalizeSpace(text).replace(/[.。]+$/, '')
}

function gbtAuthors(entry) {
  const { people, etAl } = names(entry)
  if (!people.length) return ''
  const rendered = people.map((person) => {
    const family = stripLatex(person.family)
    const initials = compactInitials(person.given)
    return initials ? `${family} ${initials}` : family
  })
  if (rendered.length > 3 || etAl) return `${rendered.slice(0, 3).join(', ')}, et al`
  return rendered.join(', ')
}

function formatGbt7714(entry) {
  const author = gbtAuthors(entry)
  const title = stripLatex(entry.fields.title ?? '')
  const marker = GB_TYPE_MARK[entry.type] ?? 'Z'
  const year = yearOf(entry)
  const volume = normalizeSpace(entry.fields.volume ?? '')
  const number = normalizeSpace(entry.fields.number ?? '')
  const page = pages(entry)
  const venue = stripLatex(entry.fields.journal ?? entry.fields.journaltitle ?? entry.fields.booktitle ?? '')
  const publisher = stripLatex(entry.fields.publisher ?? entry.fields.school ?? entry.fields.institution ?? '')
  const doi = normalizeDoi(entry.fields.doi ?? '')

  const parts = []
  if (author) parts.push(`${author}.`)
  parts.push(`${trimStop(title)}[${marker}].`)

  if (entry.type === 'book' || entry.type === 'manual' || entry.type === 'booklet') {
    let tail = ''
    if (publisher) tail += `${publisher}, `
    tail += year ? `${year}` : ''
    if (tail) parts.push(`${tail}.`)
  } else if (marker === 'C') {
    parts.pop()
    parts.push(`${trimStop(title)}[${marker}]${venue ? `//${venue}` : ''}.`)
    const publication = [publisher, year].filter(Boolean).join(', ')
    const tail = `${publication}${page ? `${publication ? ': ' : ''}${page}` : ''}`
    if (tail) parts.push(`${tail}.`)
  } else {
    const head = [venue, year, volume ? `${volume}${number ? `(${number})` : ''}` : '']
      .filter(Boolean)
      .join(', ')
    let tail = head
    if (page) tail = tail ? `${tail}: ${page}` : page
    if (tail) parts.push(`${tail}.`)
  }

  if (doi) parts.push(`DOI: ${doi}.`)
  return normalizeSpace(parts.join(' ')).replace(/\s+\./g, '.')
}

function apaAuthors(entry) {
  const { people, etAl } = names(entry)
  if (!people.length) return ''
  const rendered = people.map((person) => {
    const family = stripLatex(person.family)
    const initials = dottedInitials(person.given)
    return initials ? `${family}, ${initials}` : family
  })
  if (etAl) return `${rendered.join(', ')}, et al.`
  if (rendered.length === 1) return rendered[0]
  if (rendered.length <= 20) return `${rendered.slice(0, -1).join(', ')}, & ${rendered.at(-1)}`
  return `${rendered.slice(0, 19).join(', ')}, ... ${rendered.at(-1)}`
}

function formatApa(entry) {
  const author = apaAuthors(entry)
  const year = yearOf(entry)
  const title = ensureStop(stripLatex(entry.fields.title ?? ''))
  const venue = stripLatex(entry.fields.journal ?? entry.fields.journaltitle ?? '')
  const bookTitle = stripLatex(entry.fields.booktitle ?? '')
  const publisher = stripLatex(entry.fields.publisher ?? entry.fields.school ?? entry.fields.institution ?? '')
  const volume = normalizeSpace(entry.fields.volume ?? '')
  const number = normalizeSpace(entry.fields.number ?? '')
  const page = pages(entry, { enDash: true })
  const doi = normalizeDoi(entry.fields.doi ?? '')

  const head = [author ? ensureStop(author) : '', year ? `(${year}).` : '(n.d.).'].filter(Boolean).join(' ')
  const parts = [head, title]

  if (venue) {
    const journal = [venue]
    if (volume) journal.push(volume)
    let tail = journal.join(', ')
    if (number) tail += `(${number})`
    if (page) tail += `, ${page}`
    parts.push(ensureStop(tail))
  } else if (bookTitle) {
    parts.push(ensureStop(bookTitle))
  }

  if (publisher && !venue) parts.push(ensureStop(publisher))
  if (doi) parts.push(`https://doi.org/${doi}`)
  return normalizeSpace(parts.join(' '))
}

function ieeeAuthors(entry) {
  const { people, etAl } = names(entry)
  if (!people.length) return ''
  const rendered = people.map((person) => {
    const initials = dottedInitials(person.given)
    const family = stripLatex(person.family)
    return initials ? `${initials} ${family}` : family
  })
  if (etAl || rendered.length > 6) return `${rendered[0]} et al.`
  if (rendered.length === 1) return rendered[0]
  if (rendered.length === 2) return `${rendered[0]} and ${rendered[1]}`
  return `${rendered.slice(0, -1).join(', ')}, and ${rendered.at(-1)}`
}

function formatIeee(entry, index) {
  const author = ieeeAuthors(entry)
  const title = stripLatex(entry.fields.title ?? '').replace(/\.$/, '')
  const venue = stripLatex(entry.fields.journal ?? entry.fields.journaltitle ?? entry.fields.booktitle ?? '')
  const volume = normalizeSpace(entry.fields.volume ?? '')
  const number = normalizeSpace(entry.fields.number ?? '')
  const page = pages(entry, { enDash: true })
  const year = yearOf(entry)
  const doi = normalizeDoi(entry.fields.doi ?? '')
  const publisher = stripLatex(entry.fields.publisher ?? entry.fields.school ?? entry.fields.institution ?? '')

  const segments = []
  if (author) segments.push(`${author},`)
  segments.push(`"${title},"`)
  if (venue) segments.push(`${venue},`)
  else if (publisher) segments.push(`${publisher},`)

  const numeric = []
  if (volume) numeric.push(`vol. ${volume}`)
  if (number) numeric.push(`no. ${number}`)
  if (page) numeric.push(`pp. ${page}`)
  if (year) numeric.push(year)
  if (numeric.length) segments.push(`${numeric.join(', ')},`)
  if (doi) segments.push(`doi: ${doi}.`)

  const body = segments.filter(Boolean).join(' ').replace(/\s+,/g, ',').replace(/,\s*$/, '.')
  return `[${index + 1}] ${body}`
}

function vancouverAuthors(entry) {
  const { people, etAl } = names(entry)
  if (!people.length) return ''
  const rendered = people.map((person) => {
    const family = stripLatex(person.family)
    const initials = compactInitials(person.given)
    return initials ? `${family} ${initials}` : family
  })
  if (etAl || rendered.length > 6) return `${rendered.slice(0, 6).join(', ')}, et al`
  return rendered.join(', ')
}

function formatVancouver(entry, index) {
  const author = vancouverAuthors(entry)
  const title = ensureStop(stripLatex(entry.fields.title ?? ''))
  const venue = stripLatex(entry.fields.journal ?? entry.fields.journaltitle ?? entry.fields.booktitle ?? '')
  const volume = normalizeSpace(entry.fields.volume ?? '')
  const number = normalizeSpace(entry.fields.number ?? '')
  const page = pages(entry)
  const year = yearOf(entry)
  const doi = normalizeDoi(entry.fields.doi ?? '')
  const publisher = stripLatex(entry.fields.publisher ?? entry.fields.school ?? entry.fields.institution ?? '')

  const head = [author ? ensureStop(author) : '', title].filter(Boolean).join(' ')
  const details = `${volume}${number ? `(${number})` : ''}`
  const publication = [venue, publisher && !volume ? publisher : ''].filter(Boolean).join('. ')
  const numeric = `${year}${details ? `${year ? ';' : ''}${details}` : ''}${page ? `:${page}` : ''}`
  const citation = [publication, numeric].filter(Boolean).map(ensureStop).join(' ')
  const doiPart = doi ? ` doi:${doi}.` : ''
  return normalizeSpace(`${index + 1}. ${head} ${citation}${doiPart}`).replace(/\s+\./g, '.')
}

/** Format a single entry in the requested style. `index` only matters for numbered styles. */
export function formatEntry(entry, style = 'apa', index = 0) {
  switch (style) {
    case 'gbt7714':
      return formatGbt7714(entry)
    case 'ieee':
      return formatIeee(entry, index)
    case 'vancouver':
      return formatVancouver(entry, index)
    case 'apa':
    default:
      return formatApa(entry)
  }
}

/**
 * @returns {{ references: string[], missing: string[] }} `missing` lists keys
 * whose title was absent, because a reference without a title is not usable.
 */
export function formatEntries(entries, style = 'apa') {
  const references = []
  const missing = []
  for (const entry of entries) {
    if (!normalizeSpace(entry.fields.title ?? '')) {
      missing.push(entry.key)
      continue
    }
    references.push(formatEntry(entry, style, references.length))
  }
  if (style === 'ieee' || style === 'vancouver') {
    return {
      references: references.map((text, index) => text.replace(/^\[\d+\]|^\d+\./, style === 'ieee' ? `[${index + 1}]` : `${index + 1}.`)),
      missing,
    }
  }
  return { references, missing }
}
