import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const support = (name) => pathToFileURL(path.join(here, 'support', name)).href
const fixture = (name) => path.join(here, 'fixtures', name)

let plugin = null
if (typeof registerHooks === 'function') {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '@deepseek-ai/dsh-tools') {
        return { url: support('dsh-tools.stub.mjs'), shortCircuit: true }
      }
      if (specifier === '@deepseek-ai/schemastery') {
        return { url: support('schemastery.stub.mjs'), shortCircuit: true }
      }
      return nextResolve(specifier, context)
    },
  })
  plugin = await import('../index.js')
}

const skip = plugin ? false : 'module.registerHooks is unavailable in this Node build'

function mount(config = {}) {
  const registered = []
  const ctx = {
    tools: {
      register(spec) {
        registered.push(spec)
        return () => {}
      },
    },
  }
  plugin.apply(ctx, config)
  return registered
}

function tool(registered, name) {
  const found = registered.find((spec) => spec.name === name)
  assert.ok(found, `${name} was not registered`)
  return found
}

test('exports a cordis plugin identity', { skip }, () => {
  assert.equal(plugin.name, 'bib-lint')
  assert.deepEqual(plugin.inject, ['tools'])
  assert.ok(plugin.Config, 'Config schema is exported so the host can render settings')
})

test('registers exactly the four documented tools', { skip }, () => {
  const registered = mount()
  assert.deepEqual(registered.map((spec) => spec.name).sort(), [
    'bib_audit',
    'bib_diff',
    'bib_format',
    'bib_lookup',
  ])
})



test('bib_audit runs offline end to end on a clean file', { skip }, async () => {
  const audit = tool(mount({ verifyLimit: 0 }), 'bib_audit')
  const value = await audit.execute({ path: fixture('clean.bib'), verify: 'none' }, {})
  assert.equal(value.entries, 3)
  assert.equal(value.verified, 0)
  assert.equal(value.summary.errors, 0)
  assert.equal(value.truncated, 0)
  assert.ok(Array.isArray(value.issues))
})

test('bib_audit reports the broken fixture and caps the issue list', { skip }, async () => {
  const audit = tool(mount({ verifyLimit: 0, maxIssues: 10 }), 'bib_audit')
  const value = await audit.execute({ path: fixture('broken.bib'), verify: 'none' }, {})
  assert.ok(value.summary.errors > 0)
  assert.ok(value.issues.length <= 10)
  assert.ok(value.truncated >= 0)
})

test('bib_format honours the requested style and key subset', { skip }, async () => {
  const format = tool(mount(), 'bib_format')
  const value = await format.execute({ path: fixture('clean.bib'), style: 'ieee', keys: ['knuth1997'] }, {})
  assert.equal(value.style, 'ieee')
  assert.equal(value.count, 1)
  assert.match(value.references[0], /^\[1\] /)
  assert.match(value.references[0], /Knuth/)
})

test('bib_format falls back to the configured default style', { skip }, async () => {
  const format = tool(mount({ defaultStyle: 'vancouver' }), 'bib_format')
  const value = await format.execute({ path: fixture('clean.bib') }, {})
  assert.equal(value.style, 'vancouver')
})

test('bib_diff compares two files', { skip }, async () => {
  const diff = tool(mount(), 'bib_diff')
  const value = await diff.execute({ before: fixture('clean.bib'), after: fixture('revision.bib') }, {})
  assert.deepEqual(value.added, ['blogpost2023'])
  assert.deepEqual(value.removed, ['vaswani2017'])
})

test('an unknown style is rejected with the list of valid ones', { skip }, async () => {
  const format = tool(mount(), 'bib_format')
  await assert.rejects(
    () => format.execute({ path: fixture('clean.bib'), style: 'chicago' }, {}),
    /unknown style "chicago"; expected one of gbt7714, apa, ieee, vancouver/,
  )
})

test('a missing file names the resolved path', { skip }, async () => {
  const audit = tool(mount(), 'bib_audit')
  await assert.rejects(
    () => audit.execute({ path: 'definitely-not-here.bib', verify: 'none' }, {}),
    /no such file: .*definitely-not-here\.bib/,
  )
})

test('an empty path is rejected before any filesystem access', { skip }, async () => {
  const audit = tool(mount(), 'bib_audit')
  await assert.rejects(() => audit.execute({ path: '   ' }, {}), /a path is required/)
})


test('format and diff reject parse errors and duplicate keys', { skip }, async () => {
  const format = tool(mount(), 'bib_format')
  const diff = tool(mount(), 'bib_diff')
  await assert.rejects(() => format.execute({ path: fixture('broken.bib') }, {}), /parsing errors|duplicate citation key/)
  await assert.rejects(() => diff.execute({ before: fixture('clean.bib'), after: fixture('broken.bib') }, {}), /parsing errors|duplicate citation key/)
  await assert.rejects(() => format.execute({ path: fixture('clean.bib'), keys: ['absent'] }, {}), /citation keys not found: absent/)
})

test('audit respects a disabled network budget even when the call asks for lookups', { skip }, async () => {
  const audit = tool(mount({ verifyLimit: 0 }), 'bib_audit')
  const result = await audit.execute({ path: fixture('clean.bib'), limit: 20 }, {})
  assert.equal(result.attempted, 0)
  assert.equal(result.verified, 0)
})

test('audit preserves fractional title thresholds and reports lookup attempts', { skip }, async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ message: {
    DOI: '10.1038/nature14539', title: ['Zur Elektrodynamik bewegter Körpers'], author: [{ family: 'LeCun', given: 'Yann' }], issued: { 'date-parts': [[2015]] }
  } }) })
  try {
    const audit = tool(mount(), 'bib_audit')
    const result = await audit.execute({ path: fixture('clean.bib'), limit: 1, titleThreshold: 0.9 }, {})
    assert.equal(result.attempted, 1)
    assert.equal(result.verified, 1)
    assert.equal(result.issues.some(x => x.code === 'TITLE_MISMATCH'), false)
    const strict = await audit.execute({ path: fixture('clean.bib'), limit: 1, titleThreshold: 0.99 }, {})
    assert.equal(strict.issues.some(x => x.code === 'TITLE_MISMATCH'), true)
  } finally { globalThis.fetch = original }
})
