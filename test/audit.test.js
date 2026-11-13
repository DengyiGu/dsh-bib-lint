import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { compareWithWork, runLocalChecks, summarize } from '../lib/audit.js'
import { parseBibtex } from '../lib/bibtex.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name) => readFileSync(path.join(here, 'fixtures', name), 'utf8')

function audit(name, options) {
  const parsed = parseBibtex(fixture(name), { file: name })
  return runLocalChecks(parsed.entries, { parseErrors: parsed.errors, ...options })
}

const FIXED_NOW = () => new Date('2026-06-01T00:00:00Z')

test('a clean bibliography has no errors', () => {
  const issues = audit('clean.bib', { now: FIXED_NOW })
  assert.deepEqual(
    issues.filter((issue) => issue.severity === 'error'),
    [],
  )
})

test('reports every structural problem in the broken fixture', () => {
  const codes = new Set(audit('broken.bib', { now: FIXED_NOW }).map((issue) => issue.code))
  for (const expected of [
    'DUPLICATE_KEY',
    'DUPLICATE_WORK',
    'MISSING_REQUIRED',
    'INVALID_YEAR',
    'AUTHOR_ET_AL',
    'DOI_NOT_BARE',
    'PAGES_FORMAT',
    'UNKNOWN_TYPE',
  ]) {
    assert.ok(codes.has(expected), `expected ${expected}, got ${[...codes].join(', ')}`)
  }
})

test('flags a year in the future relative to the injected clock', () => {
  const parsed = parseBibtex(
    '@article{f, author = {A, B}, title = {T}, journal = {J}, year = {2999}, doi = {10.1000/x}}',
  )
  const issues = runLocalChecks(parsed.entries, { now: FIXED_NOW })
  assert.ok(issues.some((issue) => issue.code === 'FUTURE_YEAR'))
})

test('surfaces parser errors as issues', () => {
  const parsed = parseBibtex('@article{a, title = {x}')
  const issues = runLocalChecks(parsed.entries, { parseErrors: parsed.errors })
  assert.equal(issues.filter((issue) => issue.code === 'PARSE_ERROR').length, 1)
})

test('never reports more than one issue per missing requirement', () => {
  const parsed = parseBibtex('@article{e, title = {T}}')
  const missing = runLocalChecks(parsed.entries, { now: FIXED_NOW }).filter(
    (issue) => issue.code === 'MISSING_REQUIRED',
  )
  assert.deepEqual(
    missing.map((issue) => issue.field).sort(),
    ['author', 'journal', 'year'],
  )
})

test('sorts issues by severity, then key', () => {
  const issues = audit('broken.bib', { now: FIXED_NOW })
  const rank = { error: 0, warning: 1, info: 2 }
  for (let i = 1; i < issues.length; i += 1) {
    const previous = issues[i - 1]
    const current = issues[i]
    const delta = rank[previous.severity] - rank[current.severity]
    assert.ok(delta <= 0, `issue ${i} is out of order`)
    if (delta === 0) assert.ok(previous.key <= current.key, 'keys are not sorted inside a severity')
  }
})

test('summarize counts each severity', () => {
  const summary = summarize([
    { severity: 'error' },
    { severity: 'error' },
    { severity: 'warning' },
    { severity: 'info' },
  ])
  assert.deepEqual(summary, { errors: 2, warnings: 1, infos: 1 })
})

const ENTRY = parseBibtex(
  '@article{k, author = {Smith, John}, title = {Deep Learning}, journal = {Nature}, year = {2015}, doi = {10.1038/nature14539}}',
).entries[0]

const MATCHING_WORK = {
  doi: '10.1038/nature14539',
  title: 'Deep learning',
  containerTitle: 'Nature',
  year: 2015,
  authors: ['Smith'],
  type: 'journal-article',
  retracted: false,
}

test('a matching Crossref record produces no issues', () => {
  assert.deepEqual(compareWithWork(ENTRY, MATCHING_WORK), [])
})

test('reports title, year, author and venue disagreements', () => {
  const codes = new Set(
    compareWithWork(ENTRY, {
      ...MATCHING_WORK,
      title: 'A Completely Different Subject Entirely',
      year: 1999,
      authors: ['Nobody'],
      containerTitle: 'Journal of Unrelated Things',
    }).map((issue) => issue.code),
  )
  for (const expected of ['TITLE_MISMATCH', 'YEAR_MISMATCH', 'AUTHOR_MISMATCH', 'VENUE_MISMATCH']) {
    assert.ok(codes.has(expected), `expected ${expected}, got ${[...codes].join(', ')}`)
  }
})

test('a one-year gap is tolerated, because online-first publishing moves it', () => {
  assert.deepEqual(compareWithWork(ENTRY, { ...MATCHING_WORK, year: 2014 }), [])
})

test('a retracted work is an error', () => {
  const issues = compareWithWork(ENTRY, { ...MATCHING_WORK, retracted: true })
  assert.ok(issues.some((issue) => issue.code === 'RETRACTED' && issue.severity === 'error'))
})
