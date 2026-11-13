function block(text) {
  return { type: 'text', text }
}

const SEVERITY_TAG = { error: 'ERROR', warning: 'WARN', info: 'INFO' }

export function renderAudit(result) {
  const lines = []
  const scope = result.attempted > 0
    ? `${result.entries} entries, ${result.attempted} Crossref lookups, ${result.verified} verified`
    : `${result.entries} entries, no network verification`
  lines.push(`${result.file}: ${scope}`)
  lines.push(
    `${result.summary.errors} errors · ${result.summary.warnings} warnings · ${result.summary.infos} infos`,
  )

  if (!result.issues.length) {
    lines.push('', 'No issues found.')
    return [block(lines.join('\n'))]
  }

  let current = ''
  for (const issue of result.issues) {
    if (issue.severity !== current) {
      current = issue.severity
      lines.push('', SEVERITY_TAG[current] ?? current.toUpperCase())
    }
    const where = issue.field ? `${issue.key || '·'} · ${issue.field}` : issue.key || '·'
    lines.push(`- [${issue.code}] ${where}: ${issue.message}`)
  }
  if (result.truncated > 0) {
    lines.push('', `${result.truncated} further issues were not shown.`)
  }
  return [block(lines.join('\n'))]
}

export function renderFormat(result) {
  if (!result.references.length) {
    return [block(`No entries could be formatted (${result.style}).`)]
  }
  const head = `${result.count} references, ${result.style}`
  const body = result.references.join('\n')
  const tail = result.missing.length
    ? `\n\nSkipped (no title): ${result.missing.join(', ')}`
    : ''
  return [block(`${head}\n\n${body}${tail}`)]
}

export function renderDiff(result) {
  const lines = [
    `${result.before} → ${result.after}`,
    `${result.added.length} added · ${result.removed.length} removed · ${result.changed.length} changed`,
  ]
  if (result.added.length) lines.push('', `Added: ${result.added.join(', ')}`)
  if (result.removed.length) lines.push('', `Removed: ${result.removed.join(', ')}`)
  if (result.changed.length) {
    lines.push('', 'Changed:')
    for (const item of result.changed) {
      const fields = item.fields.map((field) => field.field).join(', ')
      lines.push(`- ${item.key}: ${fields}`)
      for (const field of item.fields) {
        const from = field.from ? `"${field.from}"` : '(empty)'
        const to = field.to ? `"${field.to}"` : '(empty)'
        lines.push(`    ${field.field}: ${from} → ${to}`)
      }
    }
  }
  if (!result.added.length && !result.removed.length && !result.changed.length) {
    lines.push('', 'Identical set of entries.')
  }
  return [block(lines.join('\n'))]
}

export function renderLookup(result) {
  if (!result.found) return [block(result.message || `No Crossref record for ${result.doi}`)]
  const lines = [
    result.title,
    result.authors.join('; ') || '(no authors)',
    `${result.container || '(no venue)'} · ${result.year || 'n.d.'} · ${result.type}`,
    '',
    result.bibtex,
  ]
  return [block(lines.join('\n'))]
}
