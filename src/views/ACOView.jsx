import DocHeader from '../components/doc/DocHeader'
import DocTable from '../components/doc/DocTable'

export default function ACOView({ aco }) {
  if (!aco) {
    return <div className="doc-scroll"><div className="empty-state">NO ACO — add an <code>aco:</code> section to your package.yaml</div></div>
  }

  return (
    <div className="doc-scroll" id="aco-content">
      <DocHeader items={[
        ['ACO ID',    aco.id],
        ['OPERATION', aco.operation],
        ['ATO DAY',   aco.ato_day],
        ['TIMEZONE',  aco.timezone],
        ['CLASS',     aco.classification],
      ]} />
      {!aco.acms?.length
        ? <div className="empty-state">NO ACMs DEFINED</div>
        : (
          <DocTable headers={['NAME','TYPE','GEOMETRY','MISSIONS','ALTITUDE','WINDOW (Z)','CONTROL AGENCY','FREQ','NOTES']}>
            {aco.acms.map((acm, i) => {
              const tk = (acm.type || 'OTHER').toUpperCase()
              let geo = ''
              if (acm.anchor_point) {
                geo += `ANCHOR: ${acm.anchor_point}`
                if (acm.heading_deg != null) geo += `\nHDG: ${acm.heading_deg}°`
                if (acm.leg_length_nm) geo += ` · LEG: ${acm.leg_length_nm} NM`
                if (acm.direction) geo += ` · ${acm.direction.toUpperCase()}`
              } else if (acm.center_coords) {
                geo += `CENTER: ${acm.center_coords}`
                if (acm.radius_nm) geo += `\nRADIUS: ${acm.radius_nm} NM`
              }
              if (acm.boundary?.length) {
                geo += (geo ? '\n' : '') + `POLYGON: ${acm.boundary.length} pts`
                acm.boundary.forEach((c, bi) => { geo += `\n  ${bi + 1}. ${c}` })
              }
              return (
                <tr key={i}>
                  <td><strong>{acm.name || '—'}</strong></td>
                  <td><span className={`acm-badge ${tk}`}>{tk}</span></td>
                  <td style={{ fontSize: '9px', color: 'var(--text-3)', whiteSpace: 'pre-line' }}>{geo || '—'}</td>
                  <td style={{ fontSize: '10px', color: 'var(--text-3)' }}>{(acm.missions || []).join(', ') || '—'}</td>
                  <td style={{ fontSize: '11px' }}>{acm.alt_lower || '?'} → {acm.alt_upper || '?'}</td>
                  <td style={{ color: 'var(--amber)', fontSize: '11px' }}>{acm.time_from || '—'} – {acm.time_to || '—'}</td>
                  <td style={{ color: 'var(--blue)', fontSize: '11px' }}>{acm.control_agency || '—'}</td>
                  <td style={{ color: 'var(--blue)', fontSize: '11px' }}>{acm.control_freq_mhz ? acm.control_freq_mhz + ' MHz' : '—'}</td>
                  <td style={{ fontSize: '9px', color: 'var(--text-3)', fontStyle: 'italic' }}>{acm.notes || '—'}</td>
                </tr>
              )
            })}
          </DocTable>
        )
      }
    </div>
  )
}
