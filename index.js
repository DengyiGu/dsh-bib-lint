import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'

import { normalizeDoi, parseBibtex, serializeEntry } from './lib/bibtex.js'
import { compareWithWork, makeIssue, runLocalChecks, sortIssues, summarize } from './lib/audit.js'
import { fetchWork, workToEntry } from './lib/crossref.js'
import { diffEntries } from './lib/diff.js'
import { formatEntries, STYLES } from './lib/format.js'
import { renderAudit, renderDiff, renderFormat, renderLookup } from './lib/report.js'

export const name = 'bib-lint'
export const inject = ['tools']

const VERIFY_MODES = ['none', 'crossref']

const DEFAULTS = {
  defaultStyle: 'apa',
  verifyLimit: 20,
  maxIssues: 200,
  requestTimeoutMs: 8000,
  crossrefMailto: '',
}

export const Config = Schema.object({
  defaultStyle: Schema.union(STYLES)
    .default(DEFAULTS.defaultStyle)
    .description('Reference style used when bib_format is called without one.'),
  verifyLimit: Schema.number()
    .min(0)
    .max(200)
    .default(DEFAULTS.verifyLimit)
    .description('How many entries bib_audit may send to Crossref when verifying. 0 disables lookups.'),
  maxIssues: Schema.number()
    .min(10)
    .max(2000)
    .default(DEFAULTS.maxIssues)
    .description('Upper bound on reported issues, so a badly broken file cannot flood the conversation.'),
  requestTimeoutMs: Schema.number()
    .min(1000)
    .max(60000)
    .default(DEFAULTS.requestTimeoutMs)
    .description('Timeout for a single Crossref request.'),
  crossrefMailto: Schema.string()
    .default(DEFAULTS.crossrefMailto)
    .description('Optional contact address; Crossref gives polite-pool rate limits to requests that carry one.'),
})

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function settings(config) {
  const merged = { ...DEFAULTS, ...(config ?? {}) }
  return {
    defaultStyle: STYLES.includes(merged.defaultStyle) ? merged.defaultStyle : DEFAULTS.defaultStyle,
    verifyLimit: clamp(merged.verifyLimit, 0, 200, DEFAULTS.verifyLimit),
    maxIssues: clamp(merged.maxIssues, 10, 2000, DEFAULTS.maxIssues),
    requestTimeoutMs: clamp(merged.requestTimeoutMs, 1000, 60000, DEFAULTS.requestTimeoutMs),
    crossrefMailto: String(merged.crossrefMailto ?? '').trim(),
  }
}

function clamp(value, min, max, fallback, integer = true) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, integer ? Math.round(number) : number))
}

function expand(target) {
  const text = String(target ?? '').trim()
  if (!text) throw fail('a path is required')
  if (text === '~') return homedir()
  if (text.startsWith('~/') || text.startsWith('~\\')) return path.join(homedir(), text.slice(2))
  return path.isAbsolute(text) ? text : path.resolve(process.cwd(), text)
}

function fail(message) {
  const error = new Error(message)
  error.code = 'BIB_LINT_INPUT'
  return error
}

async function readSource(target, signal) {
  const resolved = expand(target)
  try {
    const text = await readFile(resolved, { encoding: 'utf8', signal })
    return { text, resolved }
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    if (error?.code === 'ENOENT') {
      throw fail(
        `no such file: ${resolved} (relative paths resolve against the host process working directory, so pass an absolute path if unsure)`,
      )
    }
    if (error?.code === 'EISDIR') throw fail(`that is a directory, not a .bib file: ${resolved}`)
    throw fail(`could not read ${resolved}: ${error?.message ?? String(error)}`)
  }
}

function pickStyle(requested, fallback) {
  if (requested === undefined || requested === null || requested === '') return fallback
  const style = String(requested).toLowerCase()
  if (!STYLES.includes(style)) {
    throw fail(`unknown style "${requested}"; expected one of ${STYLES.join(', ')}`)
  }
  return style
}

function pickVerify(requested) {
  if (requested === undefined || requested === null || requested === '') return 'crossref'
  const mode = String(requested).toLowerCase()
  if (!VERIFY_MODES.includes(mode)) {
    throw fail(`unknown verify mode "${requested}"; expected one of ${VERIFY_MODES.join(', ')}`)
  }
  return mode
}

function requireParsed(parsed) {
  if (parsed.errors.length) {
    const first = parsed.errors[0]
    throw fail(`${parsed.file}: line ${first.line}: ${first.message}; run bib_audit to review parsing errors`)
  }
  const keys = new Set()
  for (const entry of parsed.entries) {
    if (keys.has(entry.key)) throw fail(`${parsed.file}: duplicate citation key "${entry.key}"; run bib_audit first`)
    keys.add(entry.key)
  }
  return parsed
}

// ---------------------------------------------------------------------------
// output schemas
// ---------------------------------------------------------------------------

const AUDIT_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    file: { type: 'string' },
    entries: { type: 'number' },
    verified: { type: 'number' },
    attempted: { type: 'number' },
    truncated: { type: 'number' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { type: 'string' },
          code: { type: 'string' },
          key: { type: 'string' },
          field: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
    summary: {
      type: 'object',
      additionalProperties: false,
      properties: {
        errors: { type: 'number' },
        warnings: { type: 'number' },
        infos: { type: 'number' },
      },
    },
  },
}

const FORMAT_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    style: { type: 'string' },
    count: { type: 'number' },
    references: { type: 'array', items: { type: 'string' } },
    missing: { type: 'array', items: { type: 'string' } },
  },
}

const DIFF_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    before: { type: 'string' },
    after: { type: 'string' },
    added: { type: 'array', items: { type: 'string' } },
    removed: { type: 'array', items: { type: 'string' } },
    changed: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string' },
          fields: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                field: { type: 'string' },
                from: { type: 'string' },
                to: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
}

const LOOKUP_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    found: { type: 'boolean' },
    doi: { type: 'string' },
    type: { type: 'string' },
    title: { type: 'string' },
    authors: { type: 'array', items: { type: 'string' } },
    year: { type: 'string' },
    container: { type: 'string' },
    bibtex: { type: 'string' },
    message: { type: 'string' },
  },
}

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------

export function apply(ctx, config) {
  const options = settings(config)

  ctx.tools.register(
    defineTool({
      name: 'bib_audit',
      description:
        'Audit a BibTeX file: required fields per entry type, duplicate keys, the same work listed twice, malformed years, DOIs and page ranges, and — unless verify is "none" — each DOI checked against Crossref for title, year, first author, venue and retraction status.',
      parameters: {
        path: {
          type: 'string',
          required: true,
          description: 'Path to the .bib file. Absolute, or relative to the host process working directory.',
        },
        verify: {
          type: 'string',
          description: 'Network verification: "crossref" (default) or "none" for a fully offline audit.',
        },
        limit: {
          type: 'number',
          description: `How many entries to verify against Crossref (default ${options.verifyLimit}).`,
        },
        titleThreshold: {
          type: 'number',
          description: 'Title similarity below which a mismatch is reported. Default 0.9.',
        },
      },
      output: {
        schema: AUDIT_OUTPUT,
        render: (_args, value) => renderAudit(value),
      },
      async execute(args, exec) {
        const source = await readSource(args.path, exec?.signal)
        const parsed = parseBibtex(source.text, { file: source.resolved })
        const issues = runLocalChecks(parsed.entries, { parseErrors: parsed.errors })

        const verify = pickVerify(args.verify)
        const budget = Math.min(options.verifyLimit, clamp(args.limit, 0, 200, options.verifyLimit))
        let verified = 0
        let attempted = 0

        if (verify === 'crossref' && budget > 0) {
          const candidates = parsed.entries
            .filter((entry) => normalizeDoi(entry.fields.doi ?? ''))
            .slice(0, budget)
          for (const entry of candidates) {
            exec?.signal?.throwIfAborted()
            attempted += 1
            const lookup = await fetchWork(entry.fields.doi, {
              mailto: options.crossrefMailto,
              timeoutMs: options.requestTimeoutMs,
              signal: exec?.signal,
            })
            if (lookup.status === 'ok') {
              verified += 1
              issues.push(
                ...compareWithWork(entry, lookup.work, {
                  titleThreshold: clamp(args.titleThreshold, 0.1, 1, 0.9, false),
                }),
              )
            } else if (lookup.status === 'not_found') {
              issues.push(makeIssue('error', 'DOI_NOT_FOUND', entry.key, 'doi', lookup.message))
            } else {
              issues.push(makeIssue('warning', 'DOI_LOOKUP_FAILED', entry.key, 'doi', lookup.message))
            }
          }
        }

        const sorted = sortIssues(issues)
        const kept = sorted.slice(0, options.maxIssues)
        return {
          file: source.resolved,
          entries: parsed.entries.length,
          verified,
          attempted,
          truncated: Math.max(0, sorted.length - kept.length),
          issues: kept,
          summary: summarize(sorted),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'bib_format',
      description:
        'Render bibliography entries as a reference list in gbt7714, apa, ieee or vancouver style. Approximations of each manual: author lists, ordering and punctuation are handled, but sentence-case conversion and translated titles are not.',
      parameters: {
        path: { type: 'string', required: true, description: 'Path to the .bib file.' },
        style: {
          type: 'string',
          description: `One of ${STYLES.join(', ')}. Defaults to the configured style (${options.defaultStyle}).`,
        },
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional subset of citation keys to format, in file order.',
        },
      },
      output: {
        schema: FORMAT_OUTPUT,
        render: (_args, value) => renderFormat(value),
      },
      async execute(args, exec) {
        const source = await readSource(args.path, exec?.signal)
        const parsed = requireParsed(parseBibtex(source.text, { file: source.resolved }))
        const style = pickStyle(args.style, options.defaultStyle)
        const wanted = Array.isArray(args.keys) && args.keys.length
          ? new Set(args.keys.map((key) => String(key).trim()))
          : null
        const selected = wanted ? parsed.entries.filter((entry) => wanted.has(entry.key)) : parsed.entries
        if (wanted) {
          const found = new Set(selected.map((entry) => entry.key))
          const absent = [...wanted].filter((key) => !found.has(key))
          if (absent.length) throw fail(`citation keys not found: ${absent.join(', ')}`)
        }
        const { references, missing } = formatEntries(selected, style)
        return { style, count: references.length, references, missing }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'bib_diff',
      description:
        'Compare two revisions of a .bib file and report which citation keys were added, removed, or had fields changed — the honest answer to "what changed in the references".',
      parameters: {
        before: { type: 'string', required: true, description: 'Path to the earlier .bib file.' },
        after: { type: 'string', required: true, description: 'Path to the later .bib file.' },
      },
      output: {
        schema: DIFF_OUTPUT,
        render: (_args, value) => renderDiff(value),
      },
      async execute(args, exec) {
        const left = await readSource(args.before, exec?.signal)
        const right = await readSource(args.after, exec?.signal)
        const before = requireParsed(parseBibtex(left.text, { file: left.resolved }))
        const after = requireParsed(parseBibtex(right.text, { file: right.resolved }))
        const result = diffEntries(before.entries, after.entries)
        return { before: left.resolved, after: right.resolved, ...result }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'bib_lookup',
      description:
        'Look a DOI up in Crossref and return a normalized, ready-to-paste BibTeX entry. Read-only: it returns text to the conversation and never modifies a file.',
      parameters: {
        doi: { type: 'string', required: true, description: 'Bare DOI, doi: prefix, or a https://doi.org/ URL.' },
      },
      output: {
        schema: LOOKUP_OUTPUT,
        render: (_args, value) => renderLookup(value),
      },
      async execute(args, exec) {
        const doi = normalizeDoi(args.doi)
        if (!doi) throw fail('a DOI is required')
        const lookup = await fetchWork(doi, {
          mailto: options.crossrefMailto,
          timeoutMs: options.requestTimeoutMs,
          signal: exec?.signal,
        })
        if (lookup.status !== 'ok') {
          return {
            found: false,
            doi,
            type: '',
            title: '',
            authors: [],
            year: '',
            container: '',
            bibtex: '',
            message: lookup.message ?? `no Crossref record for ${doi}`,
          }
        }
        const entry = workToEntry(lookup.work)
        return {
          found: true,
          doi: lookup.work.doi,
          type: entry.type,
          title: lookup.work.title,
          authors: lookup.work.authors,
          year: lookup.work.year === null ? '' : String(lookup.work.year),
          container: lookup.work.containerTitle,
          bibtex: serializeEntry(entry),
          message: '',
        }
      },
    }),
  )
}
