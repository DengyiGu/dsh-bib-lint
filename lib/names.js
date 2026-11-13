import { normalizeSpace } from './text.js'

function splitCommas(text) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '{') depth += 1
    else if (char === '}') depth = Math.max(0, depth - 1)
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(text.slice(start).trim())
  return parts
}

function stripBraces(value) {
  return normalizeSpace(value.replace(/[{}]/g, ''))
}

function startsLower(value) {
  return /^\p{Ll}/u.test(stripBraces(value))
}

/** Split an author/editor field into individual raw names. */
export function splitNames(value) {
  const text = normalizeSpace(value)
  if (!text) return []
  const names = []
  let depth = 0
  let start = 0
  let i = 0
  while (i < text.length) {
    const char = text[i]
    if (char === '{') {
      depth += 1
      i += 1
      continue
    }
    if (char === '}') {
      depth = Math.max(0, depth - 1)
      i += 1
      continue
    }
    if (depth === 0 && /\s/.test(text[i - 1] ?? ' ') && /^and\s/i.test(text.slice(i, i + 4))) {
      names.push(text.slice(start, i).trim())
      i += 3
      start = i
      continue
    }
    i += 1
  }
  names.push(text.slice(start).trim())
  return names.filter(Boolean)
}

/**
 * Parse one raw name into { family, given, suffix }.
 * "Doe, Jane" -> family Doe, given Jane.
 * "Jane Doe"  -> family Doe, given Jane.
 * "van der Berg, Jr, Jan" -> family "van der Berg", suffix Jr, given Jan.
 */
export function parseName(raw) {
  const text = normalizeSpace(raw)
  if (!text) return { family: '', given: '', suffix: '' }
  if (text.startsWith('{') && text.endsWith('}')) {
    return { family: stripBraces(text), given: '', suffix: '' }
  }
  const parts = splitCommas(text)
  if (parts.length >= 3) {
    return { family: parts[0], suffix: parts[1], given: parts.slice(2).join(', ') }
  }
  if (parts.length === 2) {
    return { family: parts[0], given: parts[1], suffix: '' }
  }
  const tokens = text.split(/\s+/)
  if (tokens.length === 1) {
    return { family: tokens[0], given: '', suffix: '' }
  }
  let cut = tokens.length - 1
  const last = tokens[tokens.length - 1]
  while (cut > 0 && startsLower(tokens[cut - 1]) && !startsLower(last)) {
    cut -= 1
  }
  return {
    family: tokens.slice(cut).join(' '),
    given: tokens.slice(0, cut).join(' '),
    suffix: '',
  }
}

/** Parse a whole author field. */
export function parseNameList(value) {
  return splitNames(value).map(parseName)
}

/** "Jane Ann" -> "J. A." */
export function initials(given) {
  return normalizeSpace(given)
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const bare = stripBraces(token)
      return bare ? `${bare[0].toUpperCase()}.` : ''
    })
    .filter(Boolean)
    .join(' ')
}

/** "J. A. Doe" style, used by IEEE. */
export function initialsBeforeFamily(name) {
  const init = initials(name.given)
  const family = stripBraces(name.family)
  return init ? `${init} ${family}` : family
}

/** "Doe, J. A." style, used by APA. */
export function familyThenInitials(name) {
  const init = initials(name.given)
  const family = stripBraces(name.family)
  return init ? `${family}, ${init}` : family
}

export { stripBraces }
