function index(entries) {
  const map = new Map()
  for (const entry of entries) map.set(entry.key, entry)
  return map
}

export function diffEntries(before, after) {
  const left = index(before)
  const right = index(after)

  const added = [...right.keys()].filter((key) => !left.has(key)).sort()
  const removed = [...left.keys()].filter((key) => !right.has(key)).sort()

  const changed = []
  for (const [key, next] of right) {
    const previous = left.get(key)
    if (!previous) continue
    const fields = []
    if (previous.type !== next.type) {
      fields.push({ field: 'type', from: previous.type, to: next.type })
    }
    const names = new Set([...Object.keys(previous.fields), ...Object.keys(next.fields)])
    for (const field of [...names].sort()) {
      const from = previous.fields[field] ?? ''
      const to = next.fields[field] ?? ''
      if (from !== to) fields.push({ field, from, to })
    }
    if (fields.length) changed.push({ key, fields })
  }

  changed.sort((a, b) => a.key.localeCompare(b.key))
  return { added, removed, changed }
}
