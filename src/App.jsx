import { useState, useCallback } from 'react'
import Header from './components/Header'
import TabBar from './components/TabBar'
import UploadScreen from './components/UploadScreen'
import ATOView from './views/ATOView'
import ACOView from './views/ACOView'
import SPINSView from './views/SPINSView'
import COMMSView from './views/COMMSView'
import MapView from './views/MapView'

export default function App() {
  const [pkg,             setPkg]             = useState(null)
  const [theme,           setTheme]           = useState('pro')
  const [activeTab,       setActiveTab]       = useState('ato')
  const [selectedMission, setSelectedMission] = useState(-1)

  const handleTheme = useCallback((t) => {
    setTheme(t)
    document.documentElement.classList.toggle('movie', t === 'movie')
  }, [])

  const handlePackage = useCallback((data) => {
    // Resolve target refs in aim_points
    if (data.ato?.targets && data.ato?.missions) {
      const tgtMap = {}
      data.ato.targets.forEach(t => { if (t.id) tgtMap[t.id] = t })
      data.ato.missions.forEach(m => {
        ;(m.target?.aim_points || []).forEach((ap, i, arr) => {
          if (typeof ap === 'object' && ap.target_ref && tgtMap[ap.target_ref]) {
            const ref = tgtMap[ap.target_ref]
            if (!ap.coords)    ap.coords    = ref.coords
            if (!ap.elevation) ap.elevation = ref.elevation
            if (!ap.name)      ap.name      = ref.name || ref.id
            ap._resolved_target = ref
            arr[i] = ap
          }
        })
      })
    }

    const newPkg = {}
    if (data.ato)   newPkg.ato   = data.ato
    if (data.aco)   newPkg.aco   = data.aco
    if (data.spins) newPkg.spins = data.spins
    if (data.comms) newPkg.comms = data.comms

    if (!newPkg.ato && !newPkg.aco && !newPkg.spins && !newPkg.comms) {
      alert('Unrecognised file — expected top-level keys: ato, aco, spins, and/or comms')
      return
    }
    setPkg(newPkg)
    setSelectedMission(-1)
    const first = ['ato', 'aco', 'spins', 'comms'].find(t => newPkg[t])
    if (first) setActiveTab(first)
  }, [])

  return (
    <div className="app">
      <div className="scanline" />
      <Header ato={pkg?.ato} theme={theme} onTheme={handleTheme} onPackage={handlePackage} />
      {!pkg ? (
        <div className="body">
          <UploadScreen onPackage={handlePackage} />
        </div>
      ) : (
        <div className="body">
          <div className="main-content">
            <TabBar pkg={pkg} activeTab={activeTab} onTab={setActiveTab} />
            <div className={`view${activeTab === 'ato'   ? ' active' : ''}`} id="view-ato">
              <ATOView ato={pkg.ato} theme={theme} selectedMission={selectedMission} onSelect={setSelectedMission} />
            </div>
            <div className={`view${activeTab === 'aco'   ? ' active' : ''}`} id="view-aco">
              <ACOView aco={pkg.aco} />
            </div>
            <div className={`view${activeTab === 'spins' ? ' active' : ''}`} id="view-spins">
              <SPINSView spins={pkg.spins} />
            </div>
            <div className={`view${activeTab === 'comms' ? ' active' : ''}`} id="view-comms">
              <COMMSView comms={pkg.comms} />
            </div>
            <div className={`view${activeTab === 'map'   ? ' active' : ''}`} id="view-map">
              <MapView ato={pkg.ato} aco={pkg.aco} theme={theme} active={activeTab === 'map'} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
