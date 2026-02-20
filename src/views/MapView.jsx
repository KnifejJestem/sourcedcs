import { useRef, useEffect } from 'react'

export default function MapView({ ato, aco, theme, active }) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (!active || !ato || !containerRef.current) return
    window.STATE = window.STATE || {}
    window.STATE.theme = theme
    window.STATE.pkg   = { ato, aco }
    containerRef.current.innerHTML = ''
    if (typeof window.renderMAP === 'function') {
      window.renderMAP(ato)
    } else {
      console.error('Map rendering not available — map scripts may not have loaded')
    }
  }, [active, ato, aco, theme])

  return (
    <div className="map-wrap">
      <div className="map-container" ref={containerRef} id="map-container">
        <div className="empty-state">
          Load a package with aim_points or bullseye.coords to plot them here.
        </div>
      </div>
    </div>
  )
}
