import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { parseBibtex } from '../lib/bibtex.js'
import { formatEntries, formatEntry } from '../lib/format.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const clean = readFileSync(path.join(here, 'fixtures', 'clean.bib'), 'utf8')
const { entries } = parseBibtex(clean)
const einstein = entries[0]
const knuth = entries[2]

test('gbt7714 marks the document type and keeps the numeric tail', () => {
  const text = formatEntry(einstein, 'gbt7714')
  assert.match(text, /^Einstein A\. /)
  assert.match(text, /Körper\[J\]\./)
  assert.match(text, /Annalen der Physik, 1905, 322\(10\): 891-921\./)
  assert.match(text, /DOI: 10\.1002\/andp\.19053221004/)
})

test('gbt7714 uses [M] for a book without a journal block', () => {
  const text = formatEntry(knuth, 'gbt7714')
  assert.match(text, /\[M\]/)
  assert.match(text, /Addison-Wesley, 1997/)
})

test('apa renders author, year, container and DOI link', () => {
  const text = formatEntry(einstein, 'apa')
  assert.match(text, /^Einstein, A\. \(1905\)\. /)
  assert.match(text, /Annalen der Physik, 322\(10\), 891–921\./)
  assert.match(text, /https:\/\/doi\.org\/10\.1002\/andp\.19053221004/)
})

test('ieee is numbered and puts initials first', () => {
  const text = formatEntry(einstein, 'ieee')
  assert.match(text, /^\[1\] A\. Einstein, "Zur Elektrodynamik bewegter Körper,"/)
  assert.match(text, /vol\. 322, no\. 10, pp\. 891–921, 1905/)
})

test('vancouver is numbered and compacts the year/volume/pages tail', () => {
  const text = formatEntry(einstein, 'vancouver')
  assert.match(text, /^1\. Einstein A\. /)
  assert.match(text, /1905;322\(10\):891-921\./)
})

test('collapses a long author list to et al', () => {
  const text = formatEntry(entries[1], 'gbt7714')
  assert.match(text, /Vaswani A, Shazeer N, Parmar N, et al/)
})

test('formatEntries skips entries without a title and renumbers', () => {
  const input = [
    { type: 'misc', key: 'notitle', fields: { title: '' }, line: 1 },
    { type: 'article', key: 'a', fields: { author: 'Doe, Jane', title: 'A', journal: 'J', year: '2020' }, line: 2 },
    { type: 'article', key: 'b', fields: { author: 'Roe, Richard', title: 'B', journal: 'K', year: '2021' }, line: 3 },
  ]
  const { references, missing } = formatEntries(input, 'ieee')
  assert.deepEqual(missing, ['notitle'])
  assert.equal(references.length, 2)
  assert.ok(references[0].startsWith('[1] '))
  assert.ok(references[1].startsWith('[2] '))
})

test('a subset keeps the author shape of the requested entry', () => {
  const { references } = formatEntries(entries.filter((entry) => entry.key === 'knuth1997'), 'apa')
  assert.equal(references.length, 1)
  assert.match(references[0], /Knuth, D\. E\./)
})


test('book references retain publisher and year in IEEE and Vancouver', () => {
  const book = { type: 'book', key: 'book', fields: { author: 'Knuth, Donald E.', title: 'The Art of Computer Programming', publisher: 'Addison-Wesley', year: '1997' } }
  for (const style of ['ieee', 'vancouver']) {
    const text = formatEntry(book, style)
    assert.match(text, /Addison-Wesley/)
    assert.match(text, /1997/)
  }
})

test('formats DOI URLs once and keeps corporate authors together', () => {
  const entry = { type: 'article', key: 'org', fields: { author: '{World Health Organization}', title: 'Report', journal: 'Bulletin', year: '2024', doi: 'https://doi.org/10.1000/report' } }
  const text = formatEntry(entry, 'apa')
  assert.match(text, /World Health Organization/)
  assert.equal(text.match(/https:\/\/doi.org\//g)?.length, 1)
})
