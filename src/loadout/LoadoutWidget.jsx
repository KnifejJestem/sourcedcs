import { parseLoadout, foxColor, weaponColor } from '../utils/loadout'

export default function LoadoutWidget({ raw, theme }) {
  const parsed = parseLoadout(raw)
  if (!parsed) return <div className="dv sm">—</div>

  return (
    <div className="lo-widget">
      <div className="lo-raw">{parsed.raw}</div>

      <div className="lo-section">
        <div className="lo-section-lbl">AIR-TO-AIR</div>
        <div className="lo-aa-grid">
          {parsed.aa.map(slot => (
            <div key={slot.cat} className={`lo-aa-cell${slot.count === 0 ? ' lo-zero' : ''}`} title={slot.full}>
              <div className="lo-aa-count" style={{ color: slot.count > 0 ? foxColor(slot.cat, theme) : 'var(--text-3)' }}>
                {slot.count}
              </div>
              <div className="lo-aa-name">{slot.name}</div>
              <div className="lo-aa-full">{slot.full}</div>
            </div>
          ))}
          <div className={`lo-aa-cell${parsed.gun ? '' : ' lo-zero'}`}>
            <div className="lo-aa-count" style={{ color: parsed.gun ? 'var(--amber)' : 'var(--text-3)' }}>
              {parsed.gun ? '✓' : '—'}
            </div>
            <div className="lo-aa-name">GUN</div>
            <div className="lo-aa-full">{parsed.gun ? 'Gun ammo loaded' : 'No gun ammo'}</div>
          </div>
        </div>
      </div>

      {parsed.weapons.length > 0 && (
        <div className="lo-section">
          <div className="lo-section-lbl">STORES</div>
          {parsed.weapons.map((w, i) => (
            <div key={i} className="lo-wpn-row">
              <span className="lo-wpn-badge" style={{ background: weaponColor(w.info.cat, theme) }}>
                {w.info.name}
              </span>
              <span className="lo-wpn-qty">{w.qty}×</span>
              <span className="lo-wpn-full">{w.info.full}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
