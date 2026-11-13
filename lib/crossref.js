import { normalizeDoi } from './bibtex.js'

const API_BASE = 'https://api.crossref.org/works/'
const USER_AGENT = 'dsh-bib-lint/0.1 (DeepSeek Harness plugin)'

export function crossrefUrl(doi, { mailto = '' } = {}) {
  const base = `${API_BASE}${encodeURIComponent(normalizeDoi(doi))}`
  return mailto ? `${base}?mailto=${encodeURIComponent(mailto)}` : base
}

function first(value) {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

function yearFrom(message) {
  const parts = message.issued?.['date-parts']?.[0]
    ?? message.published?.['date-parts']?.[0]
    ?? message['published-print']?.['date-parts']?.[0]
  const year = Array.isArray(parts) ? parts[0] : undefined
  return Number.isFinite(year) ? Number(year) : null
}

/** Crossref JSON -> the shape lib/audit.js compares against. */
export function normalizeWork(message) {
  const authors = Array.isArray(message.author) ? message.author : []
  const doi = normalizeDoi(first(message.DOI))
  const isRetraction = (update) => String(update?.type ?? '').toLowerCase() === 'retraction'
  // update-to normally belongs to the notice, not the retracted article.
  // Retraction Watch also uses it for updates made to the same DOI in place.
  const retracted = (message['updated-by'] ?? []).some(isRetraction)
    || (message.relation?.['is-retracted-by'] ?? []).length > 0
    || (message['update-to'] ?? []).some((update) =>
      isRetraction(update) && doi && normalizeDoi(update.DOI).toLowerCase() === doi.toLowerCase())
  return {
    doi,
    title: first(message.title),
    containerTitle: first(message['container-title']),
    type: String(message.type ?? ''),
    year: yearFrom(message),
    authors: authors.map((author) => {
      if (author?.family) return [author.family, author.given].filter(Boolean).join(', ')
      return author?.name ? `{${author.name}}` : String(author?.given ?? '')
    }).filter(Boolean),
    authorFamilies: authors.map((author) => String(author?.family ?? author?.name ?? author?.given ?? '')),
    publisher: String(message.publisher ?? ''),
    volume: String(message.volume ?? ''),
    number: String(message.issue ?? ''),
    pages: String(message.page ?? '').replace(/\s*[-–—]+\s*/g, '--'),
    retracted,
  }
}

/**
 * @returns {Promise<{status: 'ok'|'not_found'|'error', work?: object, message?: string}>}
 */
export async function fetchWork(doi, options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    mailto = '',
    timeoutMs = 8000,
    signal,
    userAgent = USER_AGENT,
  } = options

  const normalized = normalizeDoi(doi)
  if (!normalized) return { status: 'error', message: 'empty DOI' }
  if (typeof fetchImpl !== 'function') return { status: 'error', message: 'no fetch implementation available' }

  const timeout = AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || 8000))
  const composed = AbortSignal.any([timeout, signal].filter(Boolean))
  signal?.throwIfAborted()

  try {
    const response = await fetchImpl(crossrefUrl(normalized, { mailto }), {
      headers: { accept: 'application/json', 'user-agent': userAgent },
      signal: composed,
      redirect: 'follow',
    })
    if (response.status === 404) return { status: 'not_found', message: `Crossref has no record for ${normalized}` }
    if (!response.ok) return { status: 'error', message: `Crossref answered HTTP ${response.status}` }
    const payload = await response.json()
    const message = payload?.message
    if (!message || typeof message !== 'object') return { status: 'error', message: 'Crossref returned no work object' }
    return { status: 'ok', work: normalizeWork(message) }
  } catch (error) {
    signal?.throwIfAborted()
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      return { status: 'error', message: `Crossref lookup timed out after ${timeoutMs}ms` }
    }
    return { status: 'error', message: `Crossref lookup failed: ${error?.message ?? String(error)}` }
  }
}

/**
 * Turn a work record into a .bib entry we are willing to hand back to the user.
 * Deliberately conservative: only fields Crossref actually gives us.
 */
export function workToEntry(work) {
  const fields = {}
  if (work.authors?.length) fields.author = work.authors.join(' and ')
  if (work.title) fields.title = work.title
  if (work.containerTitle) {
    if (work.type === 'proceedings-article' || work.type === 'book-chapter') fields.booktitle = work.containerTitle
    else fields.journal = work.containerTitle
  }
  if (work.year) fields.year = String(work.year)
  if (work.doi) fields.doi = work.doi
  if (work.publisher) fields.publisher = work.publisher
  for (const field of ['volume', 'number', 'pages']) {
    if (work[field]) fields[field] = work[field]
  }

  const type = work.type === 'proceedings-article'
    ? 'inproceedings'
    : work.type === 'book-chapter'
      ? 'incollection'
      : work.type === 'book' || work.type === 'monograph'
        ? 'book'
        : 'article'

  const firstFamily = (work.authorFamilies?.[0] ?? work.authors?.[0]?.split(',')[0] ?? 'Anon').replace(/[^\p{L}\p{N}]/gu, '') || 'Anon'
  const firstWord = (work.title ?? 'Untitled').split(/\s+/)[0].replace(/[^\p{L}\p{N}]/gu, '') || 'Untitled'
  const key = `${firstFamily.toLowerCase()}${work.year ?? 'nd'}${firstWord.toLowerCase()}`

  return { type, key, fields, line: 0 }
}
