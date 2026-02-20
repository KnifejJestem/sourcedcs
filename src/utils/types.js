export const KNOWN_TYPES = ['CAP', 'BAI', 'CAS', 'SEAD', 'STRIKE']

export function typeKey(t) {
  return KNOWN_TYPES.includes((t || '').toUpperCase()) ? t.toUpperCase() : 'OTHER'
}

export const TYPE_COLORS_PRO = {
  CAP: '#1a5c2e', BAI: '#7c3500', CAS: '#003d6b',
  SEAD: '#4a1a6b', STRIKE: '#6b0f1a', OTHER: '#3d3400',
}
export const TYPE_COLORS_MFD = {
  CAP: '#39ff7a', BAI: '#ff8c00', CAS: '#4fc3f7',
  SEAD: '#c084fc', STRIKE: '#ff4444', OTHER: '#ffb020',
}

export function typeColor(t, theme) {
  return (theme === 'movie' ? TYPE_COLORS_MFD : TYPE_COLORS_PRO)[typeKey(t)]
}
