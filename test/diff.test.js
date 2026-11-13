import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { parseBibtex } from '../lib/bibtex.js'
import { diffEntries } from '../lib/diff.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (name) => parseBibtex(readFileSync(path.join(here, 'fixtures', name), 'utf8')).entries

test('reports added, removed and changed keys', () => {
  const result = diffEntries(read('clean.bib'), read('revision.bib'))
  assert.deepEqual(result.added, ['blogpost2023'])
  assert.deepEqual(result.removed, ['vaswani2017'])
  assert.deepEqual(
    result.changed.map((item) => item.key),
    ['knuth1997'],
  )
})

test('reports the fields that actually moved', () => {
  const result = diffEntries(read('clean.bib'), read('revision.bib'))
  const knuth = result.changed.find((item) => item.key === 'knuth1997')
  const fields = knuth.fields.map((field) => field.field).sort()
  assert.deepEqual(fields, ['edition', 'title'])
  const edition = knuth.fields.find((field) => field.field === 'edition')
  assert.deepEqual(edition, { field: 'edition', from: '', to: '3rd' })
})

test('a file compared with itself is empty', () => {
  const entries = read('clean.bib')
  assert.deepEqual(diffEntries(entries, entries), { added: [], removed: [], changed: [] })
})

test('an unchanged key with the same fields is not reported', () => {
  const result = diffEntries(read('clean.bib'), read('revision.bib'))
  assert.ok(!result.changed.some((item) => item.key === 'einstein1905'))
})
