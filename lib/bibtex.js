import { normalizeSpace } from './text.js'

const ENTRY_OPEN = /^@([A-Za-z][A-Za-z0-9_-]*)\s*([{(])/

const BUILTIN_MACROS = {
  jan: 'January',
  feb: 'February',
  mar: 'March',
  apr: 'April',
  may: 'May',
  jun: 'June',
  jul: 'July',
  aug: 'August',
  sep: 'September',
  oct: 'October',
  nov: 'November',
  dec: 'December',
}

// Field order used when writing an entry back out; anything unknown is appended
// in the order it was read.
const FIELD_ORDER = [
  'author',
  'editor',
  'title',
  'booktitle',
  'journal',
  'journaltitle',
  'publisher',
  'school',
  'institution',
  'year',
  'date',
  'volume',
  'number',
  'pages',
  'doi',
  'url',
  'eprint',
  'archiveprefix',
  'isbn',
  'issn',
  'note',
]

function countLines(text, index) {
  let line = 1
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1
  }
  return line
}

function skipSpace(text, index) {
  let i = index
  while (i < text.length) {
    if (/\s/.test(text[i])) i += 1
    else if (text[i] === '%') {
      const end = text.indexOf('\n', i)
      i = end === -1 ? text.length : end + 1
    } else break
  }
  return i
}

function findClose(text, openIndex, open, close) {
  let depth = 0
  let braces = 0
  let quoted = false
  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i]
    if (char === '\\') { i += 1; continue }
    if (char === '"' && (open === '{' ? depth === 1 : braces === 0)) quoted = !quoted
    if (quoted) continue
    if (open === '(') {
      if (char === '{') braces += 1
      else if (char === '}') braces -= 1
      if (braces > 0 || char === '}') continue
    }
    if (char === '%' && (open === '{' ? depth === 1 : braces === 0)) {
      const end = text.indexOf('\n', i)
      if (end === -1) return -1
      i = end
      continue
    }
    if (char === open) depth += 1
    else if (char === close) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function readBraced(text, index) {
  let depth = 0
  for (let i = index; i < text.length; i += 1) {
    const char = text[i]
    if (char === '\\') { i += 1; continue }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return { value: text.slice(index + 1, i), end: i + 1 }
    }
  }
  return { value: text.slice(index + 1), end: text.length }
}

function readQuoted(text, index) {
  let depth = 0
  for (let i = index + 1; i < text.length; i += 1) {
    const char = text[i]
    if (char === '\\') {
      i += 1
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
    } else if (char === '"' && depth === 0) {
      return { value: text.slice(index + 1, i), end: i + 1 }
    }
  }
  return { value: text.slice(index + 1), end: text.length }
}

function readBare(text, index) {
  let i = index
  while (i < text.length && !/[\s,}#]/.test(text[i])) i += 1
  return { value: text.slice(index, i), end: i }
}

function readValue(text, start, macros) {
  let i = start
  let value = ''
  for (;;) {
    i = skipSpace(text, i)
    const char = text[i]
    if (char === undefined) break
    if (char === '{') {
      const read = readBraced(text, i)
      value += read.value
      i = read.end
    } else if (char === '"') {
      const read = readQuoted(text, i)
      value += read.value
      i = read.end
    } else {
      const read = readBare(text, i)
      const macro = /^[A-Za-z][A-Za-z0-9_-]*$/.test(read.value)
        ? macros.get(read.value.toLowerCase())
        : undefined
      value += macro ?? read.value
      i = read.end
    }
    i = skipSpace(text, i)
    if (text[i] === '#') {
      i += 1
      continue
    }
    break
  }
  return { value: normalizeSpace(value), end: i }
}

function readAssignments(text, macros) {
  const fields = {}
  const problems = []
  let i = 0
  while (i < text.length) {
    i = skipSpace(text, i)
    if (i >= text.length) break
    if (text[i] === ',') {
      i += 1
      continue
    }
    const nameMatch = /^[A-Za-z][A-Za-z0-9_:.+-]*/.exec(text.slice(i))
    if (!nameMatch) {
      problems.push(`unreadable field near "${text.slice(i, i + 24)}"`)
      break
    }
    const name = nameMatch[0].toLowerCase()
    i = skipSpace(text, i + nameMatch[0].length)
    if (text[i] !== '=') {
      problems.push(`expected "=" after field "${name}"`)
      break
    }
    const read = readValue(text, i + 1, macros)
    fields[name] = read.value
    i = read.end
  }
  return { fields, problems }
}

/**
 * Parse a .bib source.
 * @returns {{ entries: Array<{type: string, key: string, fields: Record<string, string>, line: number}>, errors: Array<{line: number, message: string}>, file: string }}
 */
export function parseBibtex(source, { file = '' } = {}) {
  const text = String(source ?? '')
  const macros = new Map(Object.entries(BUILTIN_MACROS))
  const entries = []
  const errors = []
  let cursor = 0

  while (cursor < text.length) {
    let at = cursor
    while (at < text.length && text[at] !== '@') {
      if (text[at] === '%') {
        const end = text.indexOf('\n', at)
        at = end === -1 ? text.length : end
      } else at += 1
    }
    if (at === text.length) break
    const head = ENTRY_OPEN.exec(text.slice(at, at + 64))
    if (!head) {
      cursor = at + 1
      continue
    }
    const type = head[1].toLowerCase()
    const line = countLines(text, at)
    const open = head[2]
    const openIndex = at + head[0].length - 1
    const close = open === '{' ? '}' : ')'
    const closeIndex = findClose(text, openIndex, open, close)
    if (closeIndex === -1) {
      errors.push({ line, message: `unterminated @${type} entry` })
      break
    }
    const body = text.slice(openIndex + 1, closeIndex)
    cursor = closeIndex + 1

    if (type === 'comment' || type === 'preamble') continue
    if (type === 'string') {
      const { fields, problems } = readAssignments(body, macros)
      for (const problem of problems) errors.push({ line, message: `@string: ${problem}` })
      for (const [name, value] of Object.entries(fields)) macros.set(name, value)
      continue
    }

    const comma = body.indexOf(',')
    const key = normalizeSpace(comma === -1 ? body : body.slice(0, comma))
    const fieldText = comma === -1 ? '' : body.slice(comma + 1)
    if (!key) errors.push({ line, message: `@${type} entry without a citation key` })
    const { fields, problems } = readAssignments(fieldText, macros)
    for (const problem of problems) {
      errors.push({ line, message: `@${type}{${key}}: ${problem}` })
    }
    entries.push({ type, key, fields, line })
  }

  return { entries, errors, file }
}

/** Render one entry back to BibTeX text, for copy-paste and for `bib_lookup`. */
export function serializeEntry(entry, { indent = '  ' } = {}) {
  const known = FIELD_ORDER.filter((field) => entry.fields[field] !== undefined)
  const extra = Object.keys(entry.fields).filter((field) => !FIELD_ORDER.includes(field)).sort()
  const lines = [`@${entry.type}{${entry.key},`]
  for (const field of [...known, ...extra]) {
    lines.push(`${indent}${field} = {${entry.fields[field]}},`)
  }
  lines.push('}')
  return lines.join('\n')
}

/** Minimal DOI normalisation: accept a URL, doi: prefix or bare DOI. */
export function normalizeDoi(value) {
  const text = normalizeSpace(value)
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim()
  return text
}
