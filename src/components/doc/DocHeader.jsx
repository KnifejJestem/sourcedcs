export default function DocHeader({ items }) {
  return (
    <div className="doc-header">
      {items.map(([label, value]) => (
        <div key={label} className="doc-hitem">
          <div className="doc-hlbl">{label}</div>
          <div className="doc-hval">{value || '—'}</div>
        </div>
      ))}
    </div>
  )
}
