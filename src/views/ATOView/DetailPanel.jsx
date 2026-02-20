import { typeColor } from '../../utils/types'
import { fmtZ } from '../../utils/time'
import LoadoutWidget from '../../loadout/LoadoutWidget'

export default function DetailPanel({ mission, theme, onClose }) {
  if (!mission) return <div className="detail-panel" id="detail-panel" />

  const m     = mission
  const color = typeColor(m.mission_type, theme)

  return (
    <div className="detail-panel open" id="detail-panel">
      <div className="detail-inner" id="detail-inner">
        {/* COL 1 — Identification */}
        <div className="detail-col">
          <div className="detail-section-title">
            IDENTIFICATION
            <button className="close-detail" onClick={onClose}>✕ CLOSE</button>
          </div>
          <div className="detail-field">
            <div className="dk">CALLSIGN</div>
            <div className="dv big" style={{ color }}>{m.callsign || '—'}</div>
          </div>
          <Field k="MISSION NO" v={m.mission_number || '—'} cls="amber" />
          <Field k="TYPE" v={`${m.mission_type || '—'}${m.target?.mission_type_override ? ' / ' + m.target.mission_type_override : ''}`} />
          <Field k="UNIT" v={m.unit || '—'} />
          <Field k="BASE → DEPLOY" v={`${m.home_base_icao || '?'} → ${m.deploy_location_icao || '?'}`} cls="sm" />
          <Field k="AIRCRAFT" v={m.aircraft ? `${m.aircraft.count}× ${m.aircraft.type}` : '—'} />
          <div className="detail-field">
            <div className="dk">LOADOUT</div>
            {m.aircraft?.loadout
              ? <LoadoutWidget raw={m.aircraft.loadout} theme={theme} />
              : <div className="dv sm">—</div>}
          </div>
        </div>

        {/* COL 2 — Target */}
        <div className="detail-col">
          <div className="detail-section-title">TARGET</div>
          <Field k="LOCATION" v={m.target?.location || '—'} cls="amber" />
          <Field k="ALTITUDE" v={m.target?.altitude || '—'} />
          <TimePair label="TIME ON TARGET" net={m.target?.not_earlier_than} nlt={m.target?.not_later_than} />
          {m.target?.aim_points?.length > 0 && (
            <div className="detail-field">
              <div className="dk">AIM POINTS ({m.target.aim_points.length})</div>
              {m.target.aim_points.map((p, i) => {
                if (p && typeof p === 'object') {
                  const ref = p._resolved_target
                  let text = [p.name, p.coords].filter(Boolean).join(' — ')
                  if (p.elevation) text += ` · ${p.elevation}`
                  return (
                    <div key={i} className="dmpi-entry">
                      {ref && <span className="target-type-badge">{ref.type}</span>}
                      {text}
                      {ref && (ref.type === 'SAM' || ref.type === 'EWR') && (
                        <div className="sam-info">
                          {[
                            ref.engagement_range_nm && `ER: ${ref.engagement_range_nm}nm`,
                            ref.max_alt_ft && `Max Alt: ${ref.max_alt_ft}ft`,
                          ].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </div>
                  )
                }
                return <div key={i} className="dmpi-entry">{p}</div>
              })}
            </div>
          )}
        </div>

        {/* COL 3 — Comms */}
        <div className="detail-col">
          <div className="detail-section-title">COMMS</div>
          <Field k="PRIMARY FREQ"   v={m.control?.primary_freq_mhz   ? m.control.primary_freq_mhz   + ' MHz' : '—'} cls="freq" />
          <Field k="SECONDARY FREQ" v={m.control?.secondary_freq_mhz ? m.control.secondary_freq_mhz + ' MHz' : '—'} cls="freq" />
          <Field k="NET"            v={m.control?.net_name || '—'} />
          <Field k="AAR LOCATION"   v={m.aar_location_icao || '—'} />
        </div>

        {/* COL 4 — AAR / Refuel */}
        <div className="detail-col">
          <div className="detail-section-title">AAR / REFUEL</div>
          {!m.refuel
            ? <Field k="STATUS" v="No AAR planned" cls="sm" />
            : <>
                <Field k="TANKER"   v={m.refuel.tanker_callsign || '—'} cls="amber" />
                <Field k="AR TRACK" v={m.refuel.ar_track || '—'} />
                <Field k="ALTITUDE" v={m.refuel.altitude || '—'} />
                <TimePair label="AAR WINDOW" net={m.refuel.not_earlier_than} nlt={m.refuel.not_later_than} />
              </>
          }
        </div>
      </div>
    </div>
  )
}

function Field({ k, v, cls }) {
  return (
    <div className="detail-field">
      <div className="dk">{k}</div>
      <div className={`dv${cls ? ' ' + cls : ''}`}>{v}</div>
    </div>
  )
}

function TimePair({ label, net, nlt }) {
  return (
    <div className="detail-field">
      <div className="dk">{label}</div>
      <div className="time-pair">
        <div className="time-box">
          <div className="time-box-lbl">NET</div>
          <div className="time-box-val">{fmtZ(net)}</div>
        </div>
        <div className="time-arr">→</div>
        <div className="time-box">
          <div className="time-box-lbl">NLT</div>
          <div className="time-box-val">{fmtZ(nlt)}</div>
        </div>
      </div>
    </div>
  )
}
