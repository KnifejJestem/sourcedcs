import { typeKey } from '../../utils/types'
import { fmtZ } from '../../utils/time'
import LoadoutChip from '../../loadout/LoadoutChip'

export default function MissionCard({ mission, index, selected, onSelect, theme }) {
  const m  = mission
  const tk = typeKey(m.mission_type)

  return (
    <div
      className={`mission-card card-${tk}${selected ? ' selected' : ''}`}
      onClick={() => onSelect(index)}
    >
      <div className="card-top">
        <div>
          <div className="card-callsign">{m.callsign || '—'}</div>
          <div className="card-msn">{m.mission_number || ''}</div>
        </div>
        <div className={`card-type-badge type-${tk}`}>{m.mission_type || '?'}</div>
      </div>
      <div className="card-body">
        <CardRow k="ACFT"   v={m.aircraft ? m.aircraft.count + '× ' + m.aircraft.type : '?'} cls="acft" />
        <CardRow k="TARGET" v={m.target?.location || '—'} />
        <CardRow k="WINDOW" v={`${fmtZ(m.target?.not_earlier_than)} → ${fmtZ(m.target?.not_later_than)}`} cls="time" />
        {m.control?.primary_freq_mhz && (
          <CardRow k="PFREQ" v={m.control.primary_freq_mhz + ' MHz'} cls="freq" />
        )}
        {m.refuel && (
          <CardRow k="TANKER" v={`${m.refuel.tanker_callsign} ${m.refuel.altitude}`} cls="tanker" />
        )}
      </div>
      {m.aircraft?.loadout && <LoadoutChip raw={m.aircraft.loadout} theme={theme} />}
    </div>
  )
}

function CardRow({ k, v, cls }) {
  return (
    <div className="card-row">
      <span className="ck">{k}</span>
      <span className={`cv${cls ? ' ' + cls : ''}`}>{v}</span>
    </div>
  )
}
