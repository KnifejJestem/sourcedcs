import { useRef } from 'react'

export default function Header({ ato, theme, onTheme, onPackage }) {
  const fileRef = useRef()

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
    <header>
      <div className="header-title">ATO BRIEF</div>
      <div className="header-meta" id="header-meta">
        {ato && <HeaderMeta ato={ato} />}
      </div>
      <div className="header-right">
        <div className="theme-toggle">
          <button
            className={`theme-btn ${theme === 'pro' ? 'active' : ''}`}
            onClick={() => onTheme('pro')}
          >PROF</button>
          <button
            className={`theme-btn ${theme === 'movie' ? 'active' : ''}`}
            onClick={() => onTheme('movie')}
          >MFD</button>
        </div>
        <button className="load-btn" onClick={() => fileRef.current.click()}>LOAD PACKAGE</button>
        <input
          ref={fileRef}
          type="file"
          accept=".yaml,.yml"
          style={{ display: 'none' }}
          onChange={e => { handleFile(e.target.files[0]); e.target.value = '' }}
        />
      </div>
    </header>
  )
}

function HeaderMeta({ ato }) {
  const items = [
    ['DATE',         ato.irl_date || '—',              ''],
    ['INGAME START', ato.ingame_start_local || '—',    'ingame'],
  ]
  const unit = ato.global_control?.controlling_unit
  if (unit) items.push(['AWACS / GCI', unit, ''])
  return items.map(([label, value, cls]) => (
    <div key={label} className="meta-block">
      <div className="meta-label">{label}</div>
      <div className={`meta-value${cls ? ' ' + cls : ''}`}>{value}</div>
    </div>
  ))
}
