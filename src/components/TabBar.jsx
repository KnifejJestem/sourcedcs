const ALL_TABS = ['ato', 'aco', 'spins', 'comms', 'map']

export default function TabBar({ pkg, activeTab, onTab }) {
  return (
    <div className="tab-bar">
      {ALL_TABS.map(tab => {
        const available = tab === 'map' ? !!pkg?.ato : !!pkg?.[tab]
        return (
          <button
            key={tab}
            className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
            data-tab={tab}
            disabled={!available}
            onClick={() => onTab(tab)}
          >
            {tab.toUpperCase()}
          </button>
        )
      })}
    </div>
  )
}
