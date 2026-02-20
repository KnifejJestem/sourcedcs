import { toMins, fmtZ } from '../../utils/time'
import { typeColor } from '../../utils/types'

const STEP = 15
const TW   = 800

function hhmm(t) {
  return String(Math.floor(t / 60)).padStart(2, '0') + String(t % 60).padStart(2, '0')
}

export default function Timeline({ missions, theme, onSelect }) {
  let minT = Infinity, maxT = -Infinity
  missions.forEach(m => {
    [
      toMins(m.target?.not_earlier_than), toMins(m.target?.not_later_than),
      toMins(m.refuel?.not_earlier_than), toMins(m.refuel?.not_later_than),
    ].forEach(t => {
      if (t != null) { minT = Math.min(minT, t); maxT = Math.max(maxT, t) }
    })
  })

  if (!isFinite(minT)) {
    return (
      <div className="timeline-row">
        <div className="tl-header-bar">
          <span className="tl-lbl">TIMELINE — ZULU · ▓ MISSION WINDOW · ▒ AAR WINDOW</span>
          <span className="tl-lbl">—</span>
        </div>
        <div className="tl-scroll">
          <div className="tl-canvas">
            <div className="empty-state">NO TIME DATA</div>
          </div>
        </div>
      </div>
    )
  }

  minT = Math.floor((minT - 15) / STEP) * STEP
  maxT = Math.ceil ((maxT + 15) / STEP) * STEP
  const span = maxT - minT

  const ticks = []
  for (let t = minT; t <= maxT; t += STEP) ticks.push(t)

  return (
    <div className="timeline-row">
      <div className="tl-header-bar">
        <span className="tl-lbl">TIMELINE — ZULU · ▓ MISSION WINDOW · ▒ AAR WINDOW</span>
        <span className="tl-lbl">{hhmm(minT)}Z – {hhmm(maxT)}Z</span>
      </div>
      <div className="tl-scroll">
        <div className="tl-canvas">
          {/* Tick header */}
          <div className="tl-ticks">
            {ticks.map(t => (
              <div key={t} className="tl-tick" style={{ width: (STEP / span * TW) + 'px' }}>
                {hhmm(t)}Z
              </div>
            ))}
          </div>
          {/* Mission rows */}
          {missions.map((m, i) => {
            const color = typeColor(m.mission_type, theme)
            const net   = toMins(m.target?.not_earlier_than)
            const nlt   = toMins(m.target?.not_later_than)
            const rnet  = toMins(m.refuel?.not_earlier_than)
            const rnlt  = toMins(m.refuel?.not_later_than)
            return (
              <div key={i} className="tl-row">
                <div className="tl-label">
                  <div className="tl-label-callsign" style={{ color }}>{m.callsign || '—'}</div>
                  <div className="tl-label-type">{m.mission_type || ''} · {m.mission_number || ''}</div>
                </div>
                <div className="tl-track" style={{ width: TW + 'px' }}>
                  {ticks.map(t => (
                    <div key={t} className="tl-grid-line" style={{ left: ((t - minT) / span * 100) + '%' }} />
                  ))}
                  {net != null && nlt != null && (
                    <div
                      className="tl-bar"
                      style={{
                        background: color,
                        left: ((net - minT) / span * 100) + '%',
                        width: Math.max(2, (nlt - net) / span * 100) + '%',
                      }}
                      title={`${m.callsign} · ${fmtZ(m.target.not_earlier_than)} – ${fmtZ(m.target.not_later_than)}`}
                      onClick={() => onSelect(i)}
                    >
                      {m.callsign || ''}
                    </div>
                  )}
                  {rnet != null && rnlt != null && (
                    <div
                      className="tl-bar refuel"
                      style={{
                        left: ((rnet - minT) / span * 100) + '%',
                        width: Math.max(2, (rnlt - rnet) / span * 100) + '%',
                      }}
                      title={`${m.refuel?.tanker_callsign} ${m.refuel?.altitude} · ${fmtZ(rnet)} – ${fmtZ(rnlt)}`}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
