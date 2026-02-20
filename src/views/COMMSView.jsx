import DocHeader from '../components/doc/DocHeader'
import DocTable from '../components/doc/DocTable'

export default function COMMSView({ comms: cm }) {
  if (!cm) {
    return <div className="doc-scroll"><div className="empty-state">NO COMMS — add a <code>comms:</code> section to your package.yaml</div></div>
  }

  return (
    <div className="doc-scroll" id="comms-content">
      <DocHeader items={[
        ['OPERATION', cm.operation],
        ['ATO DAY',   cm.ato_day],
        ['WING LEAD', cm.wing_lead],
        ['CLASS',     cm.classification],
      ]} />
      <div className="comms-grid">
        <RadioBlock title="RADIO 1 — UHF  (225–400 MHz)" presets={cm.uhf_presets} />
        <RadioBlock title="RADIO 2 — VHF  (108–174 MHz)" presets={cm.vhf_presets} />
      </div>
    </div>
  )
}

function RadioBlock({ title, presets }) {
  if (!presets) return null
  const keys = Object.keys(presets).sort((a, b) => parseInt(a) - parseInt(b))
  return (
    <div className="radio-block">
      <div className="radio-title">{title}</div>
      <DocTable headers={['CH', 'CALLSIGN', 'MHz', 'ROLE']}>
        {keys.map(ch => {
          const p = presets[ch]
          const isEmpty = !p.freq_mhz
          return (
            <tr key={ch} className={isEmpty ? 'freq-empty' : ''}>
              <td><span className="freq-ch">{ch}</span></td>
              <td><span className="freq-cs">{p.callsign || '—'}</span></td>
              <td>
                {p.freq_mhz
                  ? <span className="freq-mhz">{p.freq_mhz}</span>
                  : <span style={{ color: 'var(--text-3)' }}>—</span>}
              </td>
              <td><span className="freq-role">{p.role || ''}</span></td>
            </tr>
          )
        })}
      </DocTable>
    </div>
  )
}
