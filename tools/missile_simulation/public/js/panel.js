/* Generates both aircraft panels (weapon row + heading + phase table) from
   one schema, instead of two hand-written ~90-line copies of the same
   markup that only differed by an s_/t_ id prefix and a handful of values.
   This is the single source of truth for "what fields exist, in what
   order, with what bounds" -- main.js's wiring (wirePhaseFields,
   setPhaseRowEnabled, refreshInputsFromState, applyPresetToAircraft) all
   iterate the same PHASES array rather than keeping a second, hand-synced
   description.

   Everything renders as compact square number fields -- there's no
   separate "dense" mode to keep in sync with a roomier one. */

import { state } from './state.js';

// The only place the two aircraft's asymmetric identity (label, color,
// legacy data-acft value) is spelled out -- everything else about them is
// driven symmetrically off `state`/PHASES below, parameterized by key.
export const AIRCRAFT = {
  s: { role: 'shooter', label: 'Friendly', swatch: 's-cyan' },
  t: { role: 'target', label: 'Hostile', swatch: 's-red' }
};

export function acftState(acftKey) { return acftKey === 's' ? state.shooter : state.target; }

// A field's min/max/hint can be a single value shared by both aircraft, or
// {s, t} when they genuinely differ (only Intercept's angle range and hint
// text do, since the target's default is pure pursuit/hot rather than
// flying straight).
function resolve(v, acftKey) {
  return (v && typeof v === 'object') ? v[acftKey] : v;
}

// One row schema drives the table markup, the input wiring, and the
// enabled/disabled sync. `enableKey` is the state key its own checkbox
// writes to (null = always active, like Intercept and Cold -- Cold's
// enabled state instead tracks Out's, handled separately since it isn't
// its own toggle). `hasTrigger` marks Crank and Out, whose own trigger
// row follows (see triggerRowHtml below).
// Every phase's last field carries a `kind` -- what that column actually
// means for this row (Angle / Rate / Range) -- since it's the one column
// whose meaning isn't constant down the table, unlike Acc/Spd/Clb/Alt.
export const PHASES = [
  {
    name: 'intercept', label: 'Intercept', enableKey: null,
    fields: [
      { suffix: 'accel', key: 'accel', min: 0, max: 20, step: 0.5 },
      { suffix: 'spd', key: 'desiredSpeed', min: 100, max: 1000, step: 1 },
      { suffix: 'climb', key: 'climbAngle', min: 0, max: 45, step: 1 },
      { suffix: 'alt', key: 'desiredAlt', min: 1000, max: 55000, step: 100 },
      {
        suffix: 'angle', key: 'offsetAngle', kind: 'Angle', min: { s: -90, t: -180 }, max: { s: 90, t: 180 }, step: 1,
        hint: { s: '0°=pure pursuit, + lead / − lag', t: '0°=pure/hot, ±90°=beam, 180°=cold, ±=lead/lag near 0' }
      }
    ]
  },
  {
    name: 'crank', label: 'Crank', enableKey: 'crank', hasTrigger: true,
    fields: [
      { suffix: 'accel', key: 'accel', min: 0, max: 20, step: 0.5 },
      { suffix: 'spd', key: 'desiredSpeed', min: 100, max: 1000, step: 1 },
      { suffix: 'climb', key: 'climbAngle', min: 0, max: 45, step: 1 },
      { suffix: 'alt', key: 'desiredAlt', min: 1000, max: 55000, step: 100 },
      { suffix: 'angle', key: 'crankAngle', kind: 'Angle', min: 10, max: 90, step: 1, hint: 'To own right only' }
    ]
  },
  {
    name: 'out', label: 'Out', enableKey: 'out', hasTrigger: true,
    fields: [
      { suffix: 'accel', key: 'accel', min: 0, max: 20, step: 0.5 },
      { suffix: 'spd', key: 'desiredSpeed', min: 100, max: 1000, step: 1 },
      { suffix: 'climb', key: 'climbAngle', min: 0, max: 45, step: 1 },
      { suffix: 'alt', key: 'desiredAlt', min: 1000, max: 55000, step: 100 },
      { suffix: 'rate', key: 'turnRate', kind: 'Rate', min: 1, max: 30, step: 0.5, hint: 'Always points away' }
    ]
  },
  {
    name: 'cold', label: 'Cold', enableKey: null,
    fields: [
      { suffix: 'accel', key: 'accel', min: 0, max: 20, step: 0.5 },
      { suffix: 'spd', key: 'desiredSpeed', min: 100, max: 1000, step: 1 },
      { suffix: 'climb', key: 'climbAngle', min: 0, max: 45, step: 1 },
      { suffix: 'alt', key: 'desiredAlt', min: 1000, max: 55000, step: 100 },
      { suffix: 'angle', key: 'offsetAngle', kind: 'Angle', min: -180, max: 180, step: 1, hint: '0°=cold, ±90°=beam, 180°=hot' }
    ]
  }
];

function numField(id, value, min, max, step, disabled) {
  return `<input type="number" class="numfield" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"${disabled ? ' disabled' : ''}>`;
}

// Every row has 4 uniformly-meaning columns (Acc/Spd/Clb/Alt) plus a final
// pair -- a small "kind" label cell explaining what the value next to it
// actually is, since that one column means something different per row
// (angle, turn rate, range...) instead of a fixed "Angle" header that's
// wrong for Out and Start alike.
function lastCellsHtml(id, kind, value, min, max, step, hint, disabled) {
  return `<td class="kind">${kind || ''}</td>` +
    `<td><div class="pcell">${numField(id, value, min, max, step, disabled)}</div>${hint ? `<p class="hint">${hint}</p>` : ''}</td>`;
}

function phaseRowHtml(acftKey, phase) {
  const acft = acftState(acftKey);
  const enableHtml = phase.enableKey
    ? `<div class="enable"><label><input type="checkbox" id="${acftKey}_${phase.name}_enabled"${acft[phase.enableKey].enabled ? ' checked' : ''}>Enable</label></div>`
    : '';
  const disabled = phase.enableKey ? !acft[phase.enableKey].enabled : (phase.name === 'cold' && !acft.out.enabled);
  const regular = phase.fields.slice(0, -1).map((f) => {
    const id = `${acftKey}_${phase.name}_${f.suffix}`;
    const min = resolve(f.min, acftKey), max = resolve(f.max, acftKey);
    const value = acft[phase.name][f.key];
    return `<td><div class="pcell">${numField(id, value, min, max, f.step, disabled)}</div></td>`;
  }).join('');
  const last = phase.fields[phase.fields.length - 1];
  const lastId = `${acftKey}_${phase.name}_${last.suffix}`;
  const min = resolve(last.min, acftKey), max = resolve(last.max, acftKey), hint = resolve(last.hint, acftKey);
  const lastCells = lastCellsHtml(lastId, last.kind, acft[phase.name][last.key], min, max, last.step, hint, disabled);
  return `<tr><th>${phase.label}${enableHtml}</th>${regular}${lastCells}</tr>`;
}

// A maneuver's own trigger row: Range vs. a second option specific to that
// maneuver (Out: "my own missile went active"; Crank: "my own missile just
// launched" -- the default, and the reason Crank needs a trigger at all,
// since a launch-triggered Crank must never be active AT the launch
// instant itself, only starting the step after). Only shown once the
// maneuver's own Enable is checked -- a trigger for a maneuver that isn't
// happening is just clutter -- and toggled by syncLabels() the same way.
// No explanatory text: the two buttons say what they do.
function triggerRowHtml(acftKey, phaseName, cfg, secondVal, secondLabel) {
  const label = AIRCRAFT[acftKey].label;
  const id = `${acftKey}_${phaseName}`;
  return `<tr class="trigger-row" id="${id}_triggerRow"${cfg.enabled ? '' : ' hidden'}><td colspan="7">
    <div class="seg" role="group" aria-label="${label} ${phaseName} trigger" id="${id}_triggerTypeSeg">
      <button type="button" data-val="range" aria-pressed="${cfg.triggerType === 'range'}">Range</button>
      <button type="button" data-val="${secondVal}" aria-pressed="${cfg.triggerType === secondVal}">${secondLabel}</button>
    </div>
    <div class="field sq-field" id="${id}_triggerRangeField"${cfg.triggerType !== 'range' ? ' hidden' : ''}>
      <label for="${id}_triggerRange">Rng</label>
      ${numField(id + '_triggerRange', cfg.triggerRange, 1, 60, 0.5)}
    </div>
  </td></tr>`;
}

function outTriggerRowHtml(acftKey) {
  return triggerRowHtml(acftKey, 'out', acftState(acftKey).out, 'activation', 'Missile activation');
}

function crankTriggerRowHtml(acftKey) {
  return triggerRowHtml(acftKey, 'crank', acftState(acftKey).crank, 'launch', 'Missile launch');
}

// Which weapon this aircraft fires -- Friendly's is the main weapon
// (app.missile, wired up in main.js); Hostile's is the return-fire
// selection, and only matters once "Fires back" is checked, so it
// disables right along with the rest of that row's setup.
function weaponRowHtml(acftKey) {
  const isFriendly = acftKey === 's';
  const selId = isFriendly ? 'weaponSel' : 'returnFireWeaponSel';
  const label = isFriendly ? 'Weapon' : 'Return fire weapon';
  const disabled = !isFriendly && !state.returnFireEnabled;
  return `<tr class="trigger-row"><td colspan="7">
    <div class="field"><label for="${selId}">${label}</label>
      <select id="${selId}" aria-label="${label}"${disabled ? ' disabled' : ''}></select>
    </div>
  </td></tr>`;
}

// The leading row: same shape as an optional maneuver row (Enable checkbox
// in the label cell, values in the ordinary grid) rather than a bespoke
// full-width block -- Accel/Climb are blank (Start has no such concept),
// Speed/Altitude sit in their normal columns. Both sides' own launch is a
// range trigger, exactly symmetric: Friendly's shot fires once
// shooter-target range closes to its own trigger (not unconditionally at
// T+0), the hostile's return shot fires at its own -- each takes the
// kind/value pair the way Out repurposes it for turn rate, and disables
// with its own row's Enable like any other row. The friendly-hostile
// START separation is a different thing (where the engagement begins, not
// when either shot fires) and lives above both tables instead -- see
// index.html.
function setupRowHtml(acftKey) {
  const acft = acftState(acftKey);
  const spdCell = `<td><div class="pcell">${numField(acftKey + '_start_spd', acft.spd0, 100, 1000, 1)}</div></td>`;
  const altCell = `<td><div class="pcell">${numField(acftKey + '_start_alt', acft.alt0, 1000, 55000, 100)}</div></td>`;

  if (acftKey === 's') {
    const enableHtml = `<div class="enable"><label><input type="checkbox" id="shooterFireEnabled"${state.shooterFireEnabled ? ' checked' : ''}>Fires</label></div>`;
    const rngCells = lastCellsHtml('shooterFireTrigRange', 'Range', state.shooterFireTrigRange, 1, 60, 0.5, null, !state.shooterFireEnabled);
    return `<tr><th>Start${enableHtml}</th><td></td>${spdCell}<td></td>${altCell}${rngCells}</tr>`;
  }

  const enableHtml = `<div class="enable"><label><input type="checkbox" id="returnFireEnabled"${state.returnFireEnabled ? ' checked' : ''}>Fires back</label></div>`;
  const rngCells = lastCellsHtml('returnFireTrigRange', 'Range', state.returnFireTrigRange, 1, 60, 0.5, null, !state.returnFireEnabled);
  return `<tr><th>Start${enableHtml}</th><td></td>${spdCell}<td></td>${altCell}${rngCells}</tr>`;
}

const THEAD = '<thead><tr><th>Phase</th><th>Acc</th><th>Spd</th><th>Clb</th><th>Alt</th><th></th><th></th></tr></thead>';

const TRIGGER_ROW_HTML = { crank: crankTriggerRowHtml, out: outTriggerRowHtml };

export function renderAcftPanel(acftKey) {
  const meta = AIRCRAFT[acftKey];
  const rows = [weaponRowHtml(acftKey), setupRowHtml(acftKey)];
  for (const phase of PHASES) {
    rows.push(phaseRowHtml(acftKey, phase));
    if (phase.hasTrigger) rows.push(TRIGGER_ROW_HTML[phase.name](acftKey));
  }
  return `<section class="acft-panel" data-acft="${meta.role}">
    <div class="acft-head"><span class="swatch ${meta.swatch}"></span><h2>${meta.label}</h2></div>
    <div class="table-scroll">
      <table class="phase-table">${THEAD}<tbody>${rows.join('')}</tbody></table>
    </div>
  </section>`;
}
