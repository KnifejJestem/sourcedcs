import { parseLoadout, foxColor, weaponColor } from '../utils/loadout'

export default function LoadoutChip({ raw, theme }) {
  const parsed = parseLoadout(raw)
  if (!parsed) return null

  return (
    <div className="lo-chip">
      {parsed.aa.filter(s => s.count > 0).map(slot => (
        <span
          key={slot.cat}
          className="lo-badge lo-fox"
          style={{ background: foxColor(slot.cat, theme) }}
          title={`${slot.count}× ${slot.full}`}
        >
          {slot.count}×{slot.name.replace(' ', '')}
        </span>
      ))}
      {parsed.gun && (
        <span className="lo-badge lo-gun" title="Gun / cannon ammo loaded">+</span>
      )}
      {parsed.weapons.map((w, i) => (
        <span
          key={i}
          className="lo-badge lo-wpn"
          style={{ background: weaponColor(w.info.cat, theme) }}
          title={`${w.qty}× ${w.info.full}`}
        >
          {w.qty}×{w.info.name}
        </span>
      ))}
    </div>
  )
}
