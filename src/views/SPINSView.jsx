import DocHeader from '../components/doc/DocHeader'
import DocSection from '../components/doc/DocSection'
import KVRow from '../components/doc/KVRow'
import DocTable from '../components/doc/DocTable'

export default function SPINSView({ spins: sp }) {
  if (!sp) {
    return <div className="doc-scroll"><div className="empty-state">NO SPINS — add a <code>spins:</code> section to your package.yaml</div></div>
  }

  const c1 = sp.c1_command_control || {}
  const c3 = sp.c3_iff || {}
  const c4 = sp.c4_roe || {}
  const c5 = sp.c5_execution || []
  const c7 = sp.c7_lost_comms || {}

  return (
    <div className="doc-scroll" id="spins-content">
      <DocHeader items={[
        ['OPERATION', sp.operation],
        ['ATO DAY',   sp.ato_day],
        ['VERSION',   sp.version],
        ['CLASS',     sp.classification],
      ]} />

      {/* C1 — Command & Control */}
      <DocSection title="C1 — COMMAND & CONTROL">
        {c1.tactical_control?.primary_awacs && (
          <KVRow label="PRIMARY AWACS"
            value={`${c1.tactical_control.primary_awacs.callsign || '—'} / ${c1.tactical_control.primary_awacs.freq_mhz || '—'} MHz`}
            cls="green" />
        )}
        {c1.tactical_control?.secondary_awacs && (
          <KVRow label="SECONDARY AWACS"
            value={`${c1.tactical_control.secondary_awacs.callsign || '—'} / ${c1.tactical_control.secondary_awacs.freq_mhz || '—'} MHz`} />
        )}
        {c1.airspace_control && <KVRow label="AIRSPACE CTRL" value={c1.airspace_control} />}
        {c1.package_lead     && <KVRow label="PACKAGE LEAD"  value={c1.package_lead} cls="amber" />}
        {c1.strike_lead      && <KVRow label="STRIKE LEAD"   value={c1.strike_lead}  cls="amber" />}
      </DocSection>

      {/* C3 — IFF */}
      <DocSection title="C3 — IFF / SIF">
        {c3.note && <div className="spins-sub">{c3.note}</div>}
        {c3.assignments?.length > 0 && (
          <DocTable headers={['MSN', 'MODE', 'CODE']}>
            {c3.assignments.map((a, i) => (
              <tr key={i}>
                <td>{a.mission}</td>
                <td>{c3.mode || '3'}</td>
                <td><span className="iff-code">{a.code || '—'}</span></td>
              </tr>
            ))}
          </DocTable>
        )}
      </DocSection>

      {/* C4 — ROE */}
      <DocSection title="C4 — RULES OF ENGAGEMENT">
        {c4.pid && <>
          <KVRow label="PID REQUIRED"
            value={c4.pid.required ? 'YES — required before weapons release' : 'NO'}
            cls="red" />
          {(c4.pid.valid_sources || []).map((src, i) => (
            <div key={i} className="spins-sub">• {src}</div>
          ))}
          {c4.pid.caveat && (
            <div className="spins-sub" style={{ color: 'var(--amber)' }}>{c4.pid.caveat}</div>
          )}
        </>}
        {c4.bvr && (
          <KVRow label="BVR"
            value={c4.bvr.authorized ? 'AUTHORIZED — after PID or controller declaration' : 'NOT AUTHORIZED'}
            cls="amber" />
        )}
        {c4.surface_attack && <>
          <KVRow label="SFC ATTACK"  value={c4.surface_attack.authorized_targets || '—'} />
          <KVRow label="DYNAMIC TGT" value={c4.surface_attack.dynamic_targeting  || '—'} />
          {c4.surface_attack.collateral_damage && (
            <KVRow label="COLLATERAL DAM."
              value={`Levels ${c4.surface_attack.collateral_damage.delegated_levels} delegated; higher → ${c4.surface_attack.collateral_damage.higher_requires}`} />
          )}
        </>}
        {c4.civilian_traffic && <KVRow label="CIVILIAN TRAFFIC" value={String(c4.civilian_traffic)} />}
      </DocSection>

      {/* C5 — Execution */}
      <DocSection title="C5 — EXECUTION OBJECTIVES">
        {c5.map((e, i) => (
          <div key={i} className="spins-mission-block">
            <div className="spins-mission-id">MSN {e.mission}</div>
            {e.objective && <div className="spins-mission-obj">{e.objective}</div>}
            {e.secondary_objective && <div className="spins-sub">Secondary: {e.secondary_objective}</div>}
            {(e.priority_of_effort || []).map((p, j) => <div key={j} className="spins-sub">{p}</div>)}
            {e.orbit && <div className="spins-sub" style={{ color: 'var(--blue)' }}>ORBIT: {e.orbit}</div>}
            {e.targeting_range_nm && <div className="spins-sub">Targeting range: {e.targeting_range_nm}nm</div>}
            {e.notes && <div className="spins-sub">{e.notes}</div>}
          </div>
        ))}
      </DocSection>

      {/* C7 — Lost Comms */}
      <DocSection title="C7 — LOST COMMS">
        {c7.loss_awacs && <>
          <KVRow label="LOSS AWACS — ACTION" value={c7.loss_awacs.action || '—'} />
          <KVRow label="LOSS AWACS — ABORT"  value={c7.loss_awacs.abort_condition || '—'} cls="red" />
        </>}
        {c7.loss_package && <>
          <KVRow label="LOSS PACKAGE — ACTION" value={c7.loss_package.action || '—'} />
          <KVRow label="LOSS PACKAGE — ABORT"  value={c7.loss_package.abort_condition || '—'} cls="red" />
        </>}
        {c7.loss_intraflight && <>
          <KVRow label="LOSS INTRAFLIGHT" value={c7.loss_intraflight.action || '—'} />
          {c7.loss_intraflight.abort_condition && (
            <KVRow label="ABORT" value={c7.loss_intraflight.abort_condition} cls="red" />
          )}
        </>}
      </DocSection>

      {/* C8 — Abort Criteria */}
      <DocSection title="C8 — ABORT CRITERIA">
        {(sp.c8_abort_criteria || []).map((a, i) => (
          <div key={i} className="spins-sub">• {a}</div>
        ))}
      </DocSection>

      {/* C9 — SAR */}
      {sp.c9_sar && (
        <DocSection title="C9 — SEARCH AND RESCUE">
          <KVRow label="STATUS" value={sp.c9_sar.status || '—'} />
        </DocSection>
      )}

      {/* C11 — Safety */}
      {sp.c11_safety && (
        <DocSection title="C11 — SAFETY">
          <KVRow label="MIN SEPARATION" value={sp.c11_safety.minimum_separation || '—'} cls="amber" />
        </DocSection>
      )}
    </div>
  )
}
