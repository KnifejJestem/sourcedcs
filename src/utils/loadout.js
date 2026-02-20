// ── Weapon database ──────────────────────────────────────────
export const WEAPON_DB = {
  // ── Air-to-Ground Missiles (AGM) ────────────────────────
  '62':  { name: 'AGM-62',  full: 'AGM-62 Walleye',                 cat: 'agm' },
  '65':  { name: 'AGM-65',  full: 'AGM-65 Maverick',                cat: 'agm' },
  '88':  { name: 'AGM-88',  full: 'AGM-88 HARM (Anti-Radiation)',    cat: 'agm' },
  '114': { name: 'AGM-114', full: 'AGM-114 Hellfire',                cat: 'agm' },
  '122': { name: 'AGM-122', full: 'AGM-122 Sidearm (Anti-Radiation)',cat: 'agm' },
  '130': { name: 'AGM-130', full: 'AGM-130 (Powered Bomb)',          cat: 'agm' },
  '141': { name: 'ADM-141', full: 'ADM-141 TALD (Decoy)',            cat: 'agm' },
  '154': { name: 'AGM-154', full: 'AGM-154 JSOW',                   cat: 'agm' },
  '158': { name: 'AGM-158', full: 'AGM-158 JASSM',                  cat: 'agm' },
  '179': { name: 'AGM-179', full: 'AGM-179 JAGM (Joint Air-Ground)', cat: 'agm' },
  // ── Guided Bombs (GBU) ───────────────────────────────────
  '10':  { name: 'GBU-10',  full: 'GBU-10 Paveway II (2000lb LGB)', cat: 'gbu' },
  '12':  { name: 'GBU-12',  full: 'GBU-12 Paveway II (500lb LGB)',  cat: 'gbu' },
  '16':  { name: 'GBU-16',  full: 'GBU-16 Paveway II (1000lb LGB)', cat: 'gbu' },
  '24':  { name: 'GBU-24',  full: 'GBU-24 Paveway III (2000lb)',    cat: 'gbu' },
  '27':  { name: 'GBU-27',  full: 'GBU-27 Paveway III (Bunker)',    cat: 'gbu' },
  '28':  { name: 'GBU-28',  full: 'GBU-28 Bunker Buster (5000lb)',  cat: 'gbu' },
  '31':  { name: 'GBU-31',  full: 'GBU-31 JDAM (2000lb GPS)',       cat: 'gbu' },
  '32':  { name: 'GBU-32',  full: 'GBU-32 JDAM (1000lb GPS)',       cat: 'gbu' },
  '38':  { name: 'GBU-38',  full: 'GBU-38 JDAM (500lb GPS)',        cat: 'gbu' },
  '39':  { name: 'GBU-39',  full: 'GBU-39 SDB (250lb Small Diam.)', cat: 'gbu' },
  '54':  { name: 'GBU-54',  full: 'GBU-54 Laser JDAM (500lb)',      cat: 'gbu' },
  // ── Cluster Bombs (CBU) ──────────────────────────────────
  '87':  { name: 'CBU-87',  full: 'CBU-87 CEM Cluster Bomb',        cat: 'cbu' },
  '97':  { name: 'CBU-97',  full: 'CBU-97 SFW Cluster Bomb',        cat: 'cbu' },
  '99':  { name: 'CBU-99',  full: 'CBU-99 Rockeye (Anti-Armor)',     cat: 'cbu' },
  '103': { name: 'CBU-103', full: 'CBU-103 WCMD CEM Cluster',        cat: 'cbu' },
  '105': { name: 'CBU-105', full: 'CBU-105 WCMD SFW Cluster',        cat: 'cbu' },
  // ── Unguided Bombs (Mk) ──────────────────────────────────
  '82':  { name: 'Mk 82',   full: 'Mk 82 (500lb Dumb Bomb)',        cat: 'mk'  },
  '83':  { name: 'Mk 83',   full: 'Mk 83 (1000lb Dumb Bomb)',       cat: 'mk'  },
  '84':  { name: 'Mk 84',   full: 'Mk 84 (2000lb Dumb Bomb)',       cat: 'mk'  },
  '20':  { name: 'Mk 20',   full: 'Mk 20 Rockeye (Cluster)',        cat: 'mk'  },
  // ── Rockets (LAU pods) ───────────────────────────────────
  '3':   { name: 'LAU-3',   full: 'LAU-3 (19× Hydra 70mm)',        cat: 'rkt' },
  '61':  { name: 'LAU-61',  full: 'LAU-61 (19× Hydra 70mm)',        cat: 'rkt' },
  '68':  { name: 'LAU-68',  full: 'LAU-68 (7× Hydra 70mm)',         cat: 'rkt' },
  '131': { name: 'LAU-131', full: 'LAU-131 (7× Hydra 70mm)',        cat: 'rkt' },
}

export const WEAPON_COLORS_PRO = {
  agm: '#4a1a6b', gbu: '#1a3a6b', cbu: '#9b1c1c', mk: '#4a4845', rkt: '#7c5000',
}
export const WEAPON_COLORS_MFD = {
  agm: '#c084fc', gbu: '#4fc3f7', cbu: '#ff4444', mk: '#7a7875', rkt: '#ffb020',
}

export function weaponColor(cat, theme) {
  return (theme === 'movie' ? WEAPON_COLORS_MFD : WEAPON_COLORS_PRO)[cat] || '#7a7875'
}

export const AA_SLOTS = [
  { fox: 3, name: 'Fox 3', full: 'AIM-120 AMRAAM (Active Radar)',     cat: 'fox3' },
  { fox: 1, name: 'Fox 1', full: 'AIM-7 Sparrow (Semi-Active Radar)', cat: 'fox1' },
  { fox: 2, name: 'Fox 2', full: 'AIM-9 Sidewinder (IR)',             cat: 'fox2' },
]

export const FOX_COLORS_PRO = { fox3: '#003d6b', fox1: '#4a1a6b', fox2: '#1a5c2e' }
export const FOX_COLORS_MFD = { fox3: '#4fc3f7', fox1: '#c084fc', fox2: '#39ff7a' }

export function foxColor(cat, theme) {
  return (theme === 'movie' ? FOX_COLORS_MFD : FOX_COLORS_PRO)[cat]
}

export function parseLoadout(raw) {
  if (!raw) return null
  const str = String(raw).trim()
  const plusIdx = str.indexOf('+')
  const hasGun  = plusIdx !== -1
  const aaStr   = hasGun ? str.slice(0, plusIdx) : str.slice(0, 3)
  const agStr   = hasGun ? str.slice(plusIdx + 1) : str.slice(3)

  const aa = AA_SLOTS.map((slot, i) => ({
    ...slot,
    count: parseInt(aaStr[i] || '0', 10) || 0,
  }))

  const weapons = []
  if (agStr.length > 0) {
    const splitPoints = []
    for (let i = 0; i < agStr.length - 1; i++) {
      if (/\d/.test(agStr[i]) && agStr[i + 1] === 'X') splitPoints.push(i)
    }
    splitPoints.forEach((start, idx) => {
      const end   = idx + 1 < splitPoints.length ? splitPoints[idx + 1] : agStr.length
      const token = agStr.slice(start, end)
      const xPos  = token.indexOf('X')
      if (xPos < 0) return
      const qty  = parseInt(token.slice(0, xPos), 10)
      const code = token.slice(xPos + 1)
      weapons.push({
        qty,
        code,
        info: WEAPON_DB[code] || { name: code, full: `Unknown (code ${code})`, cat: 'unknown' },
      })
    })
  }

  return { aa, gun: hasGun, weapons, raw: str }
}
