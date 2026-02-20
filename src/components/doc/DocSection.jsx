export default function DocSection({ title, children }) {
  return (
    <div className="doc-section">
      <div className="doc-section-title">{title}</div>
      {children}
    </div>
  )
}
