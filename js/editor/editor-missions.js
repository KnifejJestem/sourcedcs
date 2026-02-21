// ═══════════════════════════════════════════════════════════
// editor-missions.js — Mission CRUD editor
//
// Add, edit, and delete missions from the ATO.
// Each mission is edited through a multi-section form that
// covers identification, aircraft, target, timing, control,
// refuel, and steer points.
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Open mission editor for an existing mission ──────────────
function editMission(index) {
  var ato = editorEnsureSection('ato');
  if (!ato.missions) ato.missions = [];
  var m = ato.missions[index];
  if (!m) return;

  _openMissionForm('EDIT MISSION — ' + (m.callsign || '#' + index), m, function (updated) {
    ato.missions[index] = updated;
    editorReRender();
  });
}

// ── Add a new mission ────────────────────────────────────────
function addMission() {
  var ato = editorEnsureSection('ato');
  if (!ato.missions) ato.missions = [];

  _openMissionForm('ADD MISSION', {}, function (updated) {
    ato.missions.push(updated);
    editorReRender();
  });
}

// ── Delete a mission ─────────────────────────────────────────
function deleteMission(index) {
  var ato = STATE.pkg && STATE.pkg.ato;
  if (!ato || !ato.missions) return;
  var m = ato.missions[index];
  if (!confirm('Delete mission ' + (m.callsign || '#' + index) + '?')) return;

  ato.missions.splice(index, 1);
  editorReRender();
}

// ── Mission form builder ─────────────────────────────────────
function _openMissionForm(title, m, onSave) {
  openEditorDialog(title, function (body) {
    var f = {};

    // ── IDENTIFICATION ───────────────────────────────────────
    editorSectionTitle(body, 'IDENTIFICATION');
    f.mission_number = editorField(body, 'Mission Number', m.mission_number, { placeholder: 'e.g. MSN3266' });
    f.callsign       = editorField(body, 'Callsign',       m.callsign,       { placeholder: 'e.g. FALCON5' });
    f.mission_type   = editorField(body, 'Mission Type',    m.mission_type,   {
      type: 'select',
      options: ['CAP', 'BAI', 'CAS', 'SEAD', 'STRIKE', 'OTHER'],
    });
    if (m.mission_type) f.mission_type.value = m.mission_type;
    f.unit             = editorField(body, 'Unit',              m.unit, { placeholder: 'e.g. 510vFS' });
    f.home_base_icao   = editorField(body, 'Home Base ICAO',    m.home_base_icao, { placeholder: 'OMAM' });
    f.deploy_location  = editorField(body, 'Deploy Location',   m.deploy_location_icao, { placeholder: 'OMAM' });
    f.aar_location     = editorField(body, 'AAR Location ICAO', m.aar_location_icao, { placeholder: 'OMAM' });

    // ── AIRCRAFT ─────────────────────────────────────────────
    editorSectionTitle(body, 'AIRCRAFT');
    var ac = m.aircraft || {};
    f.ac_count  = editorField(body, 'Count',   ac.count,  { type: 'number', placeholder: '2' });
    f.ac_type   = editorField(body, 'Type',    ac.type,   { placeholder: 'e.g. F16C' });
    f.ac_loadout = editorField(body, 'Loadout', ac.loadout, { placeholder: 'e.g. 501+' });

    // ── TIMING ───────────────────────────────────────────────
    editorSectionTitle(body, 'TIMING');
    f.takeoff_time  = editorField(body, 'Takeoff Time',  m.takeoff_time,  { placeholder: '2000Z' });
    f.recovery_time = editorField(body, 'Recovery Time', m.recovery_time, { placeholder: '2300Z' });
    f.vul_start     = editorField(body, 'VUL Start',     m.vul_start,     { placeholder: '2040Z' });
    f.vul_end       = editorField(body, 'VUL End',       m.vul_end,       { placeholder: '2115Z' });

    // ── TARGET ───────────────────────────────────────────────
    editorSectionTitle(body, 'TARGET');
    var tgt = m.target || {};
    f.tgt_location = editorField(body, 'Location',  tgt.location,   { placeholder: 'e.g. KHASAB' });
    f.tgt_altitude = editorField(body, 'Altitude',  tgt.altitude,   { placeholder: 'e.g. E73FT' });
    f.tgt_target_id = editorField(body, 'Target ID (registry)', tgt.target_id, {
      placeholder: 'e.g. SAM-1',
      hint: 'References a target in the registry',
    });
    f.tgt_mission_type_override = editorField(body, 'Mission Type Override', tgt.mission_type_override, { placeholder: 'e.g. AIRDEF' });
    f.tgt_tot_net  = editorField(body, 'TOT NET',   tgt.tot_net,    { placeholder: '2046Z' });
    f.tgt_tot_nlt  = editorField(body, 'TOT NLT',   tgt.tot_nlt,    { placeholder: '2111Z' });
    f.tgt_tos      = editorField(body, 'TOS',       tgt.tos,        { placeholder: '2040Z' });
    f.tgt_toffs    = editorField(body, 'TOFFS',     tgt.toffs,      { placeholder: '2230Z' });

    // ── CONTROL ──────────────────────────────────────────────
    editorSectionTitle(body, 'CONTROL');
    var ctrl = m.control || {};
    f.ctrl_agency_id = editorField(body, 'Control Agency ID (registry)', ctrl.agency_id, {
      placeholder: 'e.g. SCREWTOP',
      hint: 'References a control agency in the registry',
    });
    f.ctrl_primary   = editorField(body, 'Primary Freq (MHz)', ctrl.primary_freq_mhz, { placeholder: '260.0' });
    f.ctrl_secondary = editorField(body, 'Secondary Freq (MHz)', ctrl.secondary_freq_mhz, { placeholder: '134.0' });

    // ── REFUEL ───────────────────────────────────────────────
    editorSectionTitle(body, 'REFUEL');
    var ref = m.refuel || {};
    f.ref_tanker_id = editorField(body, 'Tanker ID (registry)', ref.tanker_id, {
      placeholder: 'e.g. ARCO4',
      hint: 'References a tanker in the registry',
    });
    f.ref_net = editorField(body, 'AAR NET', ref.not_earlier_than, { placeholder: '2143Z' });
    f.ref_nlt = editorField(body, 'AAR NLT', ref.not_later_than,  { placeholder: '2150Z' });

    body._msnFields = f;
    body._msnOriginal = m;
  }, function () {
    var body = document.getElementById('editorBody');
    var f = body._msnFields;
    var m = Object.assign({}, body._msnOriginal);

    // Identification
    m.mission_number       = f.mission_number.value || undefined;
    m.callsign             = f.callsign.value || undefined;
    m.mission_type         = f.mission_type.value || undefined;
    m.unit                 = f.unit.value || undefined;
    m.home_base_icao       = f.home_base_icao.value || undefined;
    m.deploy_location_icao = f.deploy_location.value || undefined;
    m.aar_location_icao    = f.aar_location.value || undefined;

    // Aircraft
    var acCount = parseInt(f.ac_count.value);
    if (f.ac_type.value || !isNaN(acCount)) {
      m.aircraft = {
        count:   isNaN(acCount) ? undefined : acCount,
        type:    f.ac_type.value || undefined,
        loadout: f.ac_loadout.value || undefined,
      };
    }

    // Timing
    m.takeoff_time  = f.takeoff_time.value || undefined;
    m.recovery_time = f.recovery_time.value || undefined;
    m.vul_start     = f.vul_start.value || undefined;
    m.vul_end       = f.vul_end.value || undefined;

    // Target
    var hasTgt = f.tgt_location.value || f.tgt_target_id.value ||
                 f.tgt_tot_net.value || f.tgt_tos.value;
    if (hasTgt) {
      m.target = m.target || {};
      m.target.location              = f.tgt_location.value || undefined;
      m.target.altitude              = f.tgt_altitude.value || undefined;
      m.target.target_id             = f.tgt_target_id.value || undefined;
      m.target.mission_type_override = f.tgt_mission_type_override.value || undefined;
      m.target.tot_net               = f.tgt_tot_net.value || undefined;
      m.target.tot_nlt               = f.tgt_tot_nlt.value || undefined;
      m.target.tos                   = f.tgt_tos.value || undefined;
      m.target.toffs                 = f.tgt_toffs.value || undefined;
    }

    // Control
    if (f.ctrl_agency_id.value || f.ctrl_primary.value) {
      m.control = m.control || {};
      m.control.agency_id          = f.ctrl_agency_id.value || undefined;
      m.control.primary_freq_mhz   = f.ctrl_primary.value || undefined;
      m.control.secondary_freq_mhz = f.ctrl_secondary.value || undefined;
    }

    // Refuel
    if (f.ref_tanker_id.value) {
      m.refuel = m.refuel || {};
      m.refuel.tanker_id         = f.ref_tanker_id.value || undefined;
      m.refuel.not_earlier_than  = f.ref_net.value || undefined;
      m.refuel.not_later_than    = f.ref_nlt.value || undefined;
    }

    onSave(m);
  });
}
