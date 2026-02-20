import IntelStrip from './IntelStrip'
import MissionCard from './MissionCard'
import Timeline from './Timeline'
import DetailPanel from './DetailPanel'

export default function ATOView({ ato, theme, selectedMission, onSelect }) {
  if (!ato) {
    return (
      <div className="empty-state">
        NO ATO — add an <code>ato:</code> section to your package.yaml
      </div>
    )
  }

  const gc       = ato.global_control || {}
  const missions = ato.missions || []
  const selected = selectedMission >= 0 ? missions[selectedMission] : null

  function handleSelect(i) {
    if (selectedMission === i) onSelect(-1)
    else onSelect(i)
  }

  return (
    <>
      <IntelStrip gc={gc} ato={ato} />
      <div className="cards-row" id="cards-row">
        {missions.map((m, i) => (
          <MissionCard
            key={i}
            mission={m}
            index={i}
            selected={selectedMission === i}
            onSelect={handleSelect}
            theme={theme}
          />
        ))}
      </div>
      <Timeline missions={missions} theme={theme} onSelect={handleSelect} />
      <DetailPanel mission={selected} theme={theme} onClose={() => onSelect(-1)} />
    </>
  )
}
