import { useRef, useState } from 'react'

export default function UploadScreen({ onPackage }) {
  const fileRef = useRef()
  const [over, setOver] = useState(false)

  function handleFile(f) {
    if (!f) return
    const r = new FileReader()
    r.onload = e => {
      try {
        const data = window.jsyaml.load(e.target.result)
        onPackage(data)
      } catch (err) {
        alert('YAML parse error: ' + err.message)
      }
    }
    r.readAsText(f)
  }

  return (
    <div className="upload-screen">
      <div
        className={`drop-zone ${over ? 'over' : ''}`}
        onClick={() => fileRef.current.click()}
        onDragOver={e => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={e => {
          e.preventDefault(); setOver(false)
          handleFile(e.dataTransfer.files[0])
        }}
      >
        <div className="drop-icon">⊕</div>
        <div className="drop-label">LOAD ATO PACKAGE</div>
        <div className="drop-sub">
          Drop a <strong>package.yaml</strong> here, or click to browse.<br />
          Top-level keys: <code>ato</code>, <code>aco</code>, <code>spins</code>, <code>comms</code>
        </div>
        <div className="drop-hint">Try: <code>demo-package.yaml</code></div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".yaml,.yml"
        style={{ display: 'none' }}
        onChange={e => { handleFile(e.target.files[0]); e.target.value = '' }}
      />
    </div>
  )
}
