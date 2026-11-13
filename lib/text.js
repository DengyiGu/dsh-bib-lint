const CONTROL_WORD = /\\[a-zA-Z]+\*?/g
const ESCAPED_PUNCT = /\\([&%$#_{}])/g

// LaTeX accent commands are two characters ("o -> ö) but they appear with or
// without braces, so both forms are folded into the base letter plus a combining
// mark and then normalised. Anything fancier than this is out of scope: a
// bibliography is not a typesetting engine.
const ACCENTS = {
  '"': '\u0308',
  "'": '\u0301',
  '`': '\u0300',
  '^': '\u0302',
  '~': '\u0303',
  '=': '\u0304',
  '.': '\u0307',
}
const ACCENT_COMMAND = /\\(["'`^~=.])\s*\{?(\p{L})\}?/gu

/** Collapse every run of whitespace into one space and trim. */
export function normalizeSpace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

/** Drop LaTeX control words and grouping braces so titles can be compared. */
export function stripLatex(value) {
  return normalizeSpace(
    String(value ?? '')
      .replace(ACCENT_COMMAND, (_, accent, letter) => `${letter}${ACCENTS[accent] ?? ''}`.normalize('NFC'))
      .replace(ESCAPED_PUNCT, '$1')
      .replace(CONTROL_WORD, ' ')
      .replace(/[{}]/g, '')
      .replace(/~/g, ' '),
  )
}

/** Lowercase, accent-preserving form used for comparisons and similarity. */
export function foldForCompare(value) {
  return stripLatex(value)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function bigramCounts(folded) {
  const squashed = folded.replace(/\s+/g, '')
  const counts = new Map()
  for (let i = 0; i + 1 < squashed.length; i += 1) {
    const gram = squashed.slice(i, i + 2)
    counts.set(gram, (counts.get(gram) ?? 0) + 1)
  }
  return { squashed, counts }
}

/**
 * Sørensen–Dice coefficient over character bigrams, 0..1.
 * Used to decide whether a .bib title still matches the DOI it points at.
 */
export function titleSimilarity(left, right) {
  const a = bigramCounts(foldForCompare(left))
  const b = bigramCounts(foldForCompare(right))
  if (!a.squashed && !b.squashed) return 1
  if (!a.squashed || !b.squashed) return 0
  if (a.squashed.length < 2 || b.squashed.length < 2) {
    return a.squashed === b.squashed ? 1 : 0
  }
  let overlap = 0
  for (const [gram, count] of a.counts) {
    const other = b.counts.get(gram)
    if (other) overlap += Math.min(count, other)
  }
  const total = a.squashed.length - 1 + (b.squashed.length - 1)
  return (2 * overlap) / total
}

/** First N characters, with an ellipsis, for compact issue messages. */
export function clip(value, max = 120) {
  const text = normalizeSpace(value)
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/** "10.1000/xyz" -> "10.1000-xyz", for stable identifiers in reports. */
export function slug(value) {
  return foldForCompare(value).replace(/\s+/g, '-')
}
