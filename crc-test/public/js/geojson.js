'use strict';

// ── GeoJSON builders ───────────────────────────────────────────────────────
// All functions return FeatureCollections ready for MapLibre setData().

function trackOpacity() {
  if (grpcStatus === 'disconnected') return 0.25;
  if (grpcStatus === 'reconnecting' && lastUpdateMs != null && Date.now() - lastUpdateMs > STALE_MS) return 0.5;
  return 1.0;
}

function trackColor(coalition, category) {
  if (category === 3) return GROUND_COLOR[coalition] || '#7a7a68';
  return COALITION_COLOR[coalition] || '#888888';
}

function buildInfo(track, hist) {
  const { speedKt } = kinematics(hist);
  const fpm         = verticalFpm(hist);
  const fl          = Math.round(track.alt * 3.281 / 100).toString().padStart(3, '0');
  const gs          = Math.round(speedKt).toString().padStart(3, '0');
  let line;
  if (Math.abs(fpm) > 100) {
    const arrow = fpm > 0 ? '↑' : '↓';
    const vv    = Math.min(99, Math.round(Math.abs(fpm) / 100)).toString().padStart(2, '0');
    line = `${fl}${arrow}${vv} G${gs}`;
  } else {
    line = `${fl} G${gs}`;
  }
  return line;
}

// Track dots + fading dots
function buildDots() {
  const features = [];
  const baseOp   = trackOpacity();
  const now      = Date.now();

  for (const [id, t] of tracks) {
    if (!settings.aiEnabled && !t.player) continue;
    if (!settings.shipsEnabled && t.category === 4) continue;
    if (!checkInRange(t)) continue;
    const hist     = history.get(id) || [];
    const { heading } = kinematics(hist);
    const onGround = checkOnGround(t);
    const emType   = squawkEmergency(t.squawk);
    const isIdent  = t.squawkStatus === 2;
    let opacity    = baseOp;
    if (isIdent) opacity = baseOp * (_pulseBright ? 1.0 : 0.3);
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [t.lon, t.lat] },
      properties: {
        id,
        callsign:       resolveCallsign(t),
        color:          trackColor(t.coalition, t.category),
        coalition:      t.coalition,
        category:       t.category,
        opacity,
        onGround,
        heading:        Math.round(heading),
        emergency:      emType || '',
        emergencyColor: emType ? EMERGENCY_COLOR[emType] : '',
      },
    });
  }

  for (const [, f] of fading) {
    const t  = f.track;
    const op = Math.max(0, 1 - (now - f.goneAt) / FADE_DURATION_MS) * 0.45;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [t.lon, t.lat] },
      properties: {
        callsign:       t.callsign,
        color:          trackColor(t.coalition, t.category),
        coalition:      t.coalition,
        category:       t.category,
        opacity:        op,
        onGround:       false,
        heading:        0,
        emergency:      '',
        emergencyColor: '',
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

// Trail dots
function buildTrails() {
  if (!settings.trailEnabled) return { type: 'FeatureCollection', features: [] };
  const features = [];
  const baseOp   = trackOpacity();

  const addDots = (hist, coalition, category, extraScale) => {
    const color = trackColor(coalition, category);
    for (let i = 0; i < hist.length - 1; i++) {
      const age     = hist.length - 1 - i;
      const trailMax = (settings.trailLength ?? HISTORY_MAX) || 1;
      const opacity = (1 - age / trailMax) * 0.55 * baseOp * extraScale;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [hist[i].lon, hist[i].lat] },
        properties: { color, opacity: Math.max(0, opacity) },
      });
    }
  };

  for (const [id, t] of tracks) {
    if (!settings.aiEnabled && !t.player) continue;
    if (!settings.shipsEnabled && t.category === 4) continue;
    if (!checkInRange(t)) continue;
    const hist = history.get(id);
    if (hist && hist.length > 1) addDots(hist, t.coalition, t.category, 1);
  }
  for (const [, f] of fading) {
    if (f.lastHist && f.lastHist.length > 1) addDots(f.lastHist, f.track.coalition, f.track.category, 0.4);
  }

  return { type: 'FeatureCollection', features };
}

// PPL: projected position lines
function buildPPL() {
  if (!settings.pplEnabled) return { type: 'FeatureCollection', features: [] };
  const features = [];
  const durS     = settings.pplDuration;

  for (const [id, t] of tracks) {
    if (!settings.aiEnabled && !t.player) continue;
    if (!settings.shipsEnabled && t.category === 4) continue;
    if (!checkInRange(t)) continue;
    const hist = history.get(id) || [];
    const { heading, speedMs, speedKt } = kinematics(hist);
    if (speedKt < MIN_SPD_KT_PPL) continue;
    const [lat2, lon2] = projectPos(t.lat, t.lon, heading, speedMs * durS);
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[t.lon, t.lat], [lon2, lat2]] },
      properties: { color: trackColor(t.coalition, t.category) },
    });
  }

  return { type: 'FeatureCollection', features };
}

// Leader lines connecting each icon to its label.
// labelOffsets stores a relative [dLat, dLon] from the track's current position.
// Default (no drag) labels use the em-based TEXT_OFFSET_EM pixel offset.
function buildLeaders() {
  if (!mapReady) return { type: 'FeatureCollection', features: [] };
  const features   = [];
  const baseOp     = trackOpacity();
  const textSizePx = getTextSizePx();
  const iconGap    = getLeaderIconGap();
  const halfW      = getLabelHalfW();
  const halfH      = getLabelHalfH();

  const allTracks = [
    ...tracks.entries(),
    ...[...fading.entries()].map(([, f]) => [f.track.id, f.track]),
  ];

  for (const [id, t] of allTracks) {
    if (!settings.shipsEnabled && t.category === 4) continue;

    const iconPx = map.project([t.lon, t.lat]);

    // Pixel offset from icon to label centre
    let offX, offY;
    const relOff = labelOffsets.get(id);
    if (relOff) {
      // Dragged: label is at track position + stored relative geo offset
      const labelPx = map.project([t.lon + relOff[1], t.lat + relOff[0]]);
      offX = labelPx.x - iconPx.x;
      offY = labelPx.y - iconPx.y;
    } else {
      // Default: fixed em offset (scales with text size)
      offX = TEXT_OFFSET_EM[0] * textSizePx;
      offY = TEXT_OFFSET_EM[1] * textSizePx;
    }

    const offLen = Math.sqrt(offX * offX + offY * offY);
    if (offLen < 1) continue;

    const nx = offX / offLen, ny = offY / offLen;
    const startRelX = nx * iconGap;
    const startRelY = ny * iconGap;

    const tX       = Math.abs(nx) > 0.0001 ? halfW / Math.abs(nx) : Infinity;
    const tY       = Math.abs(ny) > 0.0001 ? halfH / Math.abs(ny) : Infinity;
    const labelGap = Math.min(tX, tY) + LABEL_EDGE_MARGIN;
    const endRelX  = offX - nx * labelGap;
    const endRelY  = offY - ny * labelGap;

    const lineLen = Math.sqrt((endRelX - startRelX)**2 + (endRelY - startRelY)**2);
    if (lineLen < 2) continue;

    const startGeo = map.unproject([iconPx.x + startRelX, iconPx.y + startRelY]);
    const endGeo   = map.unproject([iconPx.x + endRelX,   iconPx.y + endRelY]);

    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[startGeo.lng, startGeo.lat], [endGeo.lng, endGeo.lat]] },
      properties: { color: trackColor(t.coalition, t.category), opacity: baseOp },
    });
  }

  return { type: 'FeatureCollection', features };
}

// Labels.
// - Default (not dragged): placed at track's geo position; TEXT_OFFSET_EM (em)
//   moves the rendered text a fixed pixel distance from the icon at any zoom.
// - Dragged: labelOffsets stores a relative [dLat, dLon] from the track.
//   The label is placed at track + relOff so it follows the track as it moves.
function buildLabels() {
  if (!mapReady) return { type: 'FeatureCollection', features: [] };
  const features = [];
  const baseOp   = trackOpacity();
  const now      = Date.now();

  for (const [id, t] of tracks) {
    if (!settings.aiEnabled && !t.player) continue;
    if (!settings.shipsEnabled && t.category === 4) continue;
    if (!checkInRange(t)) continue;
    const hist   = history.get(id) || [];
    const relOff = labelOffsets.get(id);
    // Relative offset: label placed at track position + [dLon, dLat]
    const coords     = relOff ? [t.lon + relOff[1], t.lat + relOff[0]] : [t.lon, t.lat];
    const textOffset = relOff ? [0, 0] : TEXT_OFFSET_EM;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords },
      properties: {
        id,
        callsign:   resolveCallsign(t),
        info:       t._csOnly ? '' : buildInfo(t, hist),
        color:      trackColor(t.coalition, t.category),
        opacity:    baseOp,
        textOffset,
      },
    });
  }

  for (const [id, f] of fading) {
    const t  = f.track;
    const op = Math.max(0, 1 - (now - f.goneAt) / FADE_DURATION_MS) * 0.45;
    const relOff     = labelOffsets.get(id);
    const coords     = relOff ? [t.lon + relOff[1], t.lat + relOff[0]] : [t.lon, t.lat];
    const textOffset = relOff ? [0, 0] : TEXT_OFFSET_EM;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords },
      properties: {
        id,
        callsign:   resolveCallsign(t),
        info:       'LOST',
        color:      trackColor(t.coalition, t.category),
        opacity:    op,
        textOffset,
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

// ── Navpoints ─────────────────────────────────────────────────────────────

function buildNavpoints() {
  if (!missionData || !missionData.waypoints || !missionData.waypoints.length)
    return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: missionData.waypoints
      .filter(w => w.lat && w.lon)
      .map(w => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [w.lon, w.lat] },
        properties: { name: w.name || '' },
      })),
  };
}

// ── Drawings ──────────────────────────────────────────────────────────────

// DCS colorString is "0xAARRGGBB" (alpha first); returns CSS rgba() or null if transparent.
function dcsColorToCss(colorStr) {
  if (!colorStr) return null;
  const hex = colorStr.replace(/^0x/i, '').padStart(8, '0');
  const a = parseInt(hex.slice(0, 2), 16) / 255;
  const r = parseInt(hex.slice(2, 4), 16);
  const g = parseInt(hex.slice(4, 6), 16);
  const b = parseInt(hex.slice(6, 8), 16);
  if (a < 0.01) return null;
  return `rgba(${r},${g},${b},${a.toFixed(2)})`;
}

function buildDrawings() {
  if (!missionData || !missionData.drawings || !missionData.drawings.length)
    return { type: 'FeatureCollection', features: [] };

  const features = [];

  for (const d of missionData.drawings) {
    if (d.primitiveType === 'TextBox') continue;

    const color     = settings.lightMode ? 'rgba(40,40,40,0.85)' : 'rgba(255,255,255,0.75)';
    const fillColor = 'rgba(0,0,0,0)';
    const props     = { color, fillColor };

    if (d.polygonMode === 'circle' && d.lat != null && d.radius) {
      // Approximate circle as closed polygon
      const coords = [];
      for (let i = 0; i <= 64; i++) {
        const [lat, lon] = projectPos(d.lat, d.lon, (i / 64) * 360, d.radius);
        coords.push([lon, lat]);
      }
      features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: props });

    } else if (d.points && d.points.length >= 2) {
      const coords = d.points.map(p => [p.lon, p.lat]);
      // Closed if explicitly flagged or it's a polygon primitive (not a plain line)
      const closed = d.closed || d.primitiveType === 'Polygon';

      if (closed && coords.length >= 3) {
        const ring = [...coords];
        if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
          ring.push(ring[0]);
        }
        features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: props });
      } else {
        features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: props });
      }
    }
  }

  return { type: 'FeatureCollection', features };
}

// Approach vector: 15 nm extended centreline from FAF to threshold
function buildApproachVector() {
  if (activeView !== 'approach' || !selectedApt || approachRwyCourse == null)
    return { type: 'FeatureCollection', features: [] };

  const course     = approachRwyCourse;                    // aircraft heading TO runway
  const reciprocal = (course + 180) % 360;                 // outbound from threshold
  const FAF_M      = 15 * 1852;

  const [fafLat, fafLon] = projectPos(selectedApt.lat, selectedApt.lon, reciprocal, FAF_M);

  const color = settings.lightMode ? 'rgba(40,40,40,0.7)' : 'rgba(255,255,255,0.5)';

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[fafLon, fafLat], [selectedApt.lon, selectedApt.lat]] },
        properties: { color },
      },
    ],
  };
}

function _makeRing(lat, lon, radiusM, ringType) {
  const coords = [];
  for (let i = 0; i <= 72; i++) {
    const [rlat, rlon] = projectPos(lat, lon, (i / 72) * 360, radiusM);
    coords.push([rlon, rlat]);
  }
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords },
    properties: { ring: ringType },
  };
}

// Range ring(s): CRC = 200 nm ring around reference; Airport = 20 nm + 2 nm rings; Approach = 80 nm.
function buildRangeRing() {
  const features = [];
  if (activeView === 'crc' && selectedRef) {
    const ref = tracks.get(selectedRef);
    if (ref) features.push(_makeRing(ref.lat, ref.lon, CRC_RANGE_M, 'range'));
  }
  if (activeView === 'airport' && selectedApt) {
    features.push(_makeRing(selectedApt.lat, selectedApt.lon, 20 * 1852, 'range'));
    features.push(_makeRing(selectedApt.lat, selectedApt.lon,  2 * 1852, 'ground'));
  }
  if (activeView === 'approach' && selectedApt) {
    features.push(_makeRing(selectedApt.lat, selectedApt.lon, 80 * 1852, 'range'));
  }
  return { type: 'FeatureCollection', features };
}

// Small selection ring around the reference track icon
function buildRefDot() {
  if (!selectedRef) return { type: 'FeatureCollection', features: [] };
  const ref = tracks.get(selectedRef);
  if (!ref) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [ref.lon, ref.lat] },
      properties: {},
    }],
  };
}

function buildAirports() {
  if (!missionData || !missionData.airports) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: missionData.airports
      .filter(a => a.lat && a.lon)
      .map(a => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
        properties: { label: a.icao || a.name },
      })),
  };
}

function buildBullseye() {
  const features = [];
  if (!missionData || !missionData.bullseye) return { type: 'FeatureCollection', features };
  const be = missionData.bullseye;
  if (be.blue && be.blue.lat && be.blue.lon) {
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [be.blue.lon, be.blue.lat] }, properties: { coalition: 'blue' } });
  }
  if (be.red && be.red.lat && be.red.lon) {
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [be.red.lon, be.red.lat] }, properties: { coalition: 'red' } });
  }
  return { type: 'FeatureCollection', features };
}

function updateMap() {
  if (!mapReady) return;
  cleanFading();
  map.getSource('range-ring').setData(buildRangeRing());
  map.getSource('ref-dot').setData(buildRefDot());
  map.getSource('trails').setData(buildTrails());
  map.getSource('ppl').setData(buildPPL());
  map.getSource('leaders').setData(buildLeaders());
  map.getSource('units').setData(buildDots());
  map.getSource('labels').setData(buildLabels());
  map.getSource('bullseye').setData(buildBullseye());
  map.getSource('approach-vec').setData(buildApproachVector());
  let visible = 0;
  for (const t of tracks.values()) if (checkInRange(t)) visible++;
  document.getElementById('track-count').textContent =
    `${visible} TRACK${visible !== 1 ? 'S' : ''}`;
  if (activeView === 'approach') updateApproachPanel();
}
