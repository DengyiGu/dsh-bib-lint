import assert from 'node:assert/strict'
import { test } from 'node:test'

import { crossrefUrl, fetchWork, normalizeWork, workToEntry } from '../lib/crossref.js'

const PAYLOAD = {
  message: {
    DOI: '10.1038/nature14539',
    title: ['Deep learning'],
    'container-title': ['Nature'],
    type: 'journal-article',
    publisher: 'Springer Science and Business Media LLC',
    author: [{ family: 'LeCun', given: 'Yann' }, { given: 'Yoshua' }, { family: 'Hinton', given: 'Geoffrey' }],
    issued: { 'date-parts': [[2015, 5, 27]] },
    'updated-by': [{ type: 'retraction', DOI: '10.1000/notice' }],
  },
}

const fakeFetch = (response) => async () => response

test('builds a Crossref URL with an optional polite-pool address', () => {
  assert.equal(crossrefUrl('10.1000/xyz'), 'https://api.crossref.org/works/10.1000%2Fxyz')
  assert.equal(
    crossrefUrl('https://doi.org/10.1000/xyz', { mailto: 'a@b.c' }),
    'https://api.crossref.org/works/10.1000%2Fxyz?mailto=a%40b.c',
  )
})

test('normalises a Crossref work record', () => {
  const work = normalizeWork(PAYLOAD.message)
  assert.equal(work.doi, '10.1038/nature14539')
  assert.equal(work.title, 'Deep learning')
  assert.equal(work.containerTitle, 'Nature')
  assert.equal(work.year, 2015)
  assert.deepEqual(work.authors, ['LeCun, Yann', 'Yoshua', 'Hinton, Geoffrey'])
  assert.equal(work.retracted, true)
})

test('treats a work without a retraction notice as not retracted', () => {
  assert.equal(normalizeWork({ title: ['X'] }).retracted, false)
})

test('returns ok with a normalized work', async () => {
  const result = await fetchWork('10.1038/nature14539', {
    fetchImpl: fakeFetch({ ok: true, status: 200, json: async () => PAYLOAD }),
  })
  assert.equal(result.status, 'ok')
  assert.equal(result.work.title, 'Deep learning')
})

test('reports a missing DOI as not_found', async () => {
  const result = await fetchWork('10.1000/nope', { fetchImpl: fakeFetch({ ok: false, status: 404 }) })
  assert.equal(result.status, 'not_found')
})

test('reports an HTTP failure as an error, not an exception', async () => {
  const result = await fetchWork('10.1000/x', { fetchImpl: fakeFetch({ ok: false, status: 503 }) })
  assert.equal(result.status, 'error')
  assert.match(result.message, /503/)
})

test('reports a network failure as an error', async () => {
  const result = await fetchWork('10.1000/x', {
    fetchImpl: async () => {
      throw new Error('socket hang up')
    },
  })
  assert.equal(result.status, 'error')
  assert.match(result.message, /socket hang up/)
})

test('rejects an empty DOI before touching the network', async () => {
  let called = false
  const result = await fetchWork('   ', {
    fetchImpl: async () => {
      called = true
      return { ok: true, status: 200, json: async () => PAYLOAD }
    },
  })
  assert.equal(result.status, 'error')
  assert.equal(called, false)
})

test('turns a work into a pasteable entry', () => {
  const entry = workToEntry(normalizeWork(PAYLOAD.message))
  assert.equal(entry.type, 'article')
  assert.equal(entry.fields.journal, 'Nature')
  assert.equal(entry.fields.year, '2015')
  assert.equal(entry.fields.doi, '10.1038/nature14539')
  assert.equal(entry.key, 'lecun2015deep')
})


test('distinguishes a retracted article from its retraction notice', () => {
  const update = { type: 'retraction', DOI: '10.1000/article' }
  assert.equal(normalizeWork({ DOI: '10.1000/notice', 'update-to': [update] }).retracted, false)
  assert.equal(normalizeWork({ DOI: '10.1000/article', 'update-to': [update] }).retracted, true)
  assert.equal(normalizeWork({ DOI: '10.1000/article', relation: { 'is-retracted-by': [{ id: '10.1000/notice' }] } }).retracted, true)
})

test('preserves full authors, chapter container and publication details', () => {
  const work = normalizeWork({ ...PAYLOAD.message, type: 'book-chapter', volume: '12', issue: '3', page: '10-20' })
  const entry = workToEntry(work)
  assert.equal(entry.fields.author, 'LeCun, Yann and Yoshua and Hinton, Geoffrey')
  assert.equal(entry.fields.booktitle, 'Nature')
  assert.equal(entry.fields.journal, undefined)
  assert.equal(entry.fields.volume, '12')
  assert.equal(entry.fields.number, '3')
  assert.equal(entry.fields.pages, '10--20')
})

test('propagates cancellation instead of starting another lookup', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(() => fetchWork('10.1000/x', { signal: controller.signal, fetchImpl: () => { throw Error('should not fetch') } }), { name: 'AbortError' })
})
