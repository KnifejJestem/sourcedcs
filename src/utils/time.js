export function toMins(v) {
  if (!v) return null
  const s = String(v).replace('Z', '').padStart(4, '0')
  return parseInt(s.slice(0, 2)) * 60 + parseInt(s.slice(2, 4))
}

export function fmtZ(v) {
  if (!v) return '—'
  return String(v).replace('Z', '').padStart(4, '0') + 'Z'
}
