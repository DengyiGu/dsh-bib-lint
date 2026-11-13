import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { normalizeDoi, parseBibtex, serializeEntry } from '../lib/bibtex.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const clean = readFileSync(path.join(here, 'fixtures', 'clean.bib'), 'utf8')

test('reads entries, keys and types', () => {
  const { entries, errors } = parseBibtex(clean)
  assert.deepEqual(errors, [])
  assert.equal(entries.length, 3)
  assert.deepEqual(
    entries.map((entry) => entry.key),
    ['einstein1905', 'vaswani2017', 'knuth1997'],
  )
  assert.equal(entries[0].type, 'article')
  assert.equal(entries[1].type, 'inproceedings')
})

test('keeps nested braces inside a value', () => {
  const { entries } = parseBibtex(clean)
  assert.equal(entries[0].fields.title, 'Zur Elektrodynamik bewegter K{\\"o}rper')
})

test('reads quoted values, concatenation and @string macros', () => {
  const source = [
    '@string{conf = "Proceedings of the Conference"}',
    '@article{a,',
    '  title = "Part one" # " and two",',
    '  booktitle = conf,',
    '  year = 2020,',
    '  month = jan,',
    '}',
  ].join('\n')
  const { entries, errors } = parseBibtex(source)
  assert.deepEqual(errors, [])
  assert.equal(entries[0].fields.title, 'Part one and two')
  assert.equal(entries[0].fields.booktitle, 'Proceedings of the Conference')
  assert.equal(entries[0].fields.year, '2020')
  assert.equal(entries[0].fields.month, 'January')
})

test('accepts parenthesis delimiters', () => {
  const { entries, errors } = parseBibtex('@article(a, title = {X})')
  assert.deepEqual(errors, [])
  assert.equal(entries[0].key, 'a')
  assert.equal(entries[0].fields.title, 'X')
})

test('records the line an entry starts on', () => {
  const source = '@misc{first,\n  title = {A}\n}\n\n@misc{second,\n  title = {B}\n}\n'
  const { entries } = parseBibtex(source)
  assert.deepEqual(
    entries.map((entry) => entry.line),
    [1, 5],
  )
})

test('reports an unterminated entry instead of throwing', () => {
  const { entries, errors } = parseBibtex('@article{a, title = {x}')
  assert.equal(entries.length, 0)
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /unterminated/)
})

test('reports an entry without a citation key', () => {
  const { errors } = parseBibtex('@misc{, title = {x}}')
  assert.ok(errors.some((error) => /without a citation key/.test(error.message)))
})

test('skips @comment and @preamble', () => {
  const { entries } = parseBibtex('@comment{ignore me}\n@preamble{"\\\\x"}\n@misc{kept, title = {Y}}')
  assert.deepEqual(
    entries.map((entry) => entry.key),
    ['kept'],
  )
})

test('round-trips through serializeEntry', () => {
  const { entries } = parseBibtex(clean)
  const text = serializeEntry(entries[0])
  const again = parseBibtex(text).entries[0]
  assert.equal(again.type, entries[0].type)
  assert.equal(again.key, entries[0].key)
  assert.deepEqual(again.fields, entries[0].fields)
})

test('normalises DOI forms', () => {
  assert.equal(normalizeDoi('https://doi.org/10.1000/xyz'), '10.1000/xyz')
  assert.equal(normalizeDoi('http://dx.doi.org/10.1000/xyz'), '10.1000/xyz')
  assert.equal(normalizeDoi('doi: 10.1000/xyz'), '10.1000/xyz')
  assert.equal(normalizeDoi('  10.1000/xyz '), '10.1000/xyz')
})


test('keeps parentheses, escaped braces and comments in their proper scope', () => {
  const source = '% @article{ignored, title={Ignored}}\n@article(real,\n% comment with } and )\ntitle={A (nested) title}, note="Quoted ) text", year=2024)'
  const parsed = parseBibtex(source)
  assert.deepEqual(parsed.errors, [])
  assert.equal(parsed.entries.length, 1)
  assert.equal(parsed.entries[0].fields.title, 'A (nested) title')
  assert.equal(parsed.entries[0].fields.note, 'Quoted ) text')
  const escaped = parseBibtex(String.raw`@misc{x, title={A \{ brace}, year={2024}}`)
  assert.deepEqual(escaped.errors, [])
  assert.equal(escaped.entries[0].fields.year, '2024')
})
