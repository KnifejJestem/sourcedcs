export default function IntelStrip({ gc, ato }) {
  const sections = []

  sections.push([
    ['IRL START',    `${ato.irl_date || '—'} ${ato.irl_time_zulu || ''}`.trim()],
    ['INGAME START', ato.ingame_start_local || '—', 'ingame'],
  ])
  sections.push([
    ['PFREQ', gc.primary_freq_mhz ? gc.primary_freq_mhz + ' MHz' : '—', 'freq'],
  ])
  sections.push([
    ['AWACS / GCI', gc.controlling_unit || '—'],
    ['PLATFORM',    gc.aircraft_type    || '—'],
  ])
  if (gc.bullseye) {
    sections.push([
      ['BULLSEYE', gc.bullseye.name   || '—'],
      ['COORDS',   gc.bullseye.coords || '—', 'coords'],
    ])
  }

  return (
    <div className="intel-row" id="intel-row">
      {sections.map((items, si) => (
        <div key={si} className="intel-section">
          {items.map(([lbl, val, cls]) => (
            <div key={lbl} className="intel-item">
              <span className="intel-lbl">{lbl}</span>
              <span className={`intel-val${cls ? ' ' + cls : ''}`}>{val || '—'}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
