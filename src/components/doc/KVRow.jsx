export default function KVRow({ label, value, cls }) {
  return (
    <div className="kv-row">
      <span className="kv-key">{label}</span>
      <span className={`kv-val${cls ? ' ' + cls : ''}`}>{value || '—'}</span>
    </div>
  )
}
