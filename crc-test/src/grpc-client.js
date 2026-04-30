'use strict';
const EventEmitter = require('events');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const PROTO_ROOT = process.env.DCS_GRPC_PROTO_PATH ||
  path.join(__dirname, '../protos');
const DCS_HOST  = process.env.DCS_GRPC_HOST || 'server.sourcedcs.page:50051';
const POLL_RATE = parseInt(process.env.DCS_GRPC_POLL_RATE) || 0;

// GroupCategory numeric values to include (AIRPLANE=1, HELICOPTER=2, GROUND=3, SHIP=4)
const ALLOWED_CATS = new Set([1, 2, 3, 4]);

const PROTO_OPTS = { keepCase: true, includeDirs: [PROTO_ROOT] };

// Keep the HTTP/2 connection alive between reconnects
const CHANNEL_OPTS = {
  'grpc.keepalive_time_ms': 10000,
  'grpc.keepalive_timeout_ms': 5000,
  'grpc.keepalive_permit_without_calls': 1,
  'grpc.http2.max_pings_without_data': 0,
};

function loadSvc(protoFile) {
  const pkg = protoLoader.loadSync(path.join(PROTO_ROOT, protoFile), PROTO_OPTS);
  return grpc.loadPackageDefinition(pkg);
}

class GrpcClient extends EventEmitter {
  constructor() {
    super();
    this._state        = 'disconnected';
    this._missionSvc   = null;
    this._coalSvc      = null;
    this._worldSvc     = null;
    this._customSvc    = null;
    this._unitStream   = null; // current live unit stream reference
    this._eventStream  = null; // current live event stream reference
    this._unitTimer    = null;
    this._eventTimer   = null;
    this._statusTimer        = null; // debounce for 'reconnecting' broadcasts
    this._icao               = null;
    this._missionFetchActive = false; // prevents duplicate retry loops
  }

  connect() {
    try {
      const missionPkg = loadSvc('dcs/mission/v0/mission.proto');
      const coalPkg    = loadSvc('dcs/coalition/v0/coalition.proto');
      const worldPkg   = loadSvc('dcs/world/v0/world.proto');
      const customPkg  = loadSvc('dcs/custom/v0/custom.proto');
      const creds      = grpc.credentials.createInsecure();

      this._missionSvc = new missionPkg.dcs.mission.v0.MissionService(DCS_HOST, creds, CHANNEL_OPTS);
      this._coalSvc    = new coalPkg.dcs.coalition.v0.CoalitionService(DCS_HOST, creds, CHANNEL_OPTS);
      this._worldSvc   = new worldPkg.dcs.world.v0.WorldService(DCS_HOST, creds, CHANNEL_OPTS);
      this._customSvc  = new customPkg.dcs.custom.v0.CustomService(DCS_HOST, creds, CHANNEL_OPTS);
      this._icao       = require('../data/icao.json');
    } catch (e) {
      console.error('[grpc] proto load failed:', e.message);
      this._setState('disconnected');
      return;
    }

    this._startUnitStream();
    this._startEventStream();

    this._fetchMissionWithRetry();
  }

  // Start a mission-data retry loop if one isn't already running.
  // Safe to call multiple times (e.g. on each new WS client connect).
  triggerMissionFetch() {
    if (this._missionFetchActive) return;
    this._fetchMissionWithRetry();
  }

  // Retry fetchMissionData every 5 s until airports are non-empty.
  // Always logs errors — airports are vital for CRC operation.
  _fetchMissionWithRetry(attempt = 0) {
    this._missionFetchActive = true;
    this.fetchMissionData()
      .then(data => {
        if (data.airports.length === 0) {
          console.warn(`[grpc] mission fetch returned no airports (attempt ${attempt + 1}), retrying in 5s`);
          setTimeout(() => this._fetchMissionWithRetry(attempt + 1), 5000);
          return;
        }
        this._missionFetchActive = false;
        console.log(`[grpc] mission data ready — ${data.airports.length} airports, ${data.waypoints.length} navpoints, ${data.drawings.length} drawings`);
        this.emit('mission-load', data);
      })
      .catch(err => {
        console.error(`[grpc] mission fetch error (attempt ${attempt + 1}): ${err.message}, retrying in 5s`);
        setTimeout(() => this._fetchMissionWithRetry(attempt + 1), 5000);
      });
  }

  // ── Unit stream ───────────────────────────────────────────────────────────

  _startUnitStream() {
    // Cancel previous stream — its events will be ignored via the closure guard below
    if (this._unitStream) { try { this._unitStream.cancel(); } catch (_) {} }

    const stream = this._missionSvc.StreamUnits({ poll_rate: POLL_RATE });
    this._unitStream = stream;

    stream.on('data', (res) => {
      if (stream !== this._unitStream) return; // stale — ignore

      if (this._state !== 'connected') this._setState('connected');

      if (res.unit) {
        const u      = res.unit;
        const catNum = this._catNum(u.group && u.group.category);
        if (!ALLOWED_CATS.has(catNum)) return;

        this.emit('unit', {
          id:        u.id,
          callsign:  u.callsign || u.name,
          coalition: this._coalNum(u.coalition),
          type:      u.type || '',
          lat:       u.position ? u.position.lat : 0,
          lon:       u.position ? u.position.lon : 0,
          alt:       u.position ? Math.round(u.position.alt) : 0,
          player:    u.player_name || null,
          category:  catNum, // 1=airplane 2=helicopter 4=ship
        });
      }

      if (res.gone) this.emit('gone', res.gone.id);
    });

    stream.on('error', (err) => {
      if (stream !== this._unitStream) return; // stale — ignore
      console.error('[grpc] unit stream error:', err.message);
      this._setState('reconnecting');
      this._scheduleUnit();
    });

    stream.on('end', () => {
      if (stream !== this._unitStream) return; // stale — ignore
      console.log('[grpc] unit stream ended, reconnecting');
      this._setState('reconnecting');
      this._scheduleUnit();
    });
  }

  _scheduleUnit() {
    if (this._unitTimer) return;
    this._unitTimer = setTimeout(() => {
      this._unitTimer = null;
      this._startUnitStream();
    }, 1000);
  }

  // ── Event stream ──────────────────────────────────────────────────────────

  _startEventStream() {
    if (this._eventStream) { try { this._eventStream.cancel(); } catch (_) {} }

    const stream = this._missionSvc.StreamEvents({});
    this._eventStream = stream;

    stream.on('data', (event) => {
      if (stream !== this._eventStream) return; // stale — ignore
      if (event.mission_start) {
        console.log('[grpc] mission_start event');
        this._fetchMissionWithRetry();
      }
    });

    stream.on('error', (err) => {
      if (stream !== this._eventStream) return; // stale — ignore
      console.warn('[grpc] event stream error:', err.message);
      this._scheduleEvent();
    });

    stream.on('end', () => {
      if (stream !== this._eventStream) return; // stale — ignore
      this._scheduleEvent();
    });
  }

  _scheduleEvent() {
    if (this._eventTimer) return;
    this._eventTimer = setTimeout(() => {
      this._eventTimer = null;
      this._startEventStream();
    }, 3000);
  }

  // ── Mission data ──────────────────────────────────────────────────────────

  async fetchMissionData() {
    const [blue, red, airbases, waypoints, drawings] = await Promise.allSettled([
      this._getBullseye(3), // COALITION_BLUE
      this._getBullseye(2), // COALITION_RED
      this._getAirbases(),
      this._getNavpoints(),
      this._getDrawings(),
    ]);

    return {
      bullseye: {
        blue: blue.status === 'fulfilled' ? blue.value : null,
        red:  red.status  === 'fulfilled' ? red.value  : null,
      },
      airports:  airbases.status  === 'fulfilled' ? airbases.value  : [],
      waypoints: waypoints.status === 'fulfilled' ? waypoints.value : [],
      drawings:  drawings.status  === 'fulfilled' ? drawings.value  : [],
    };
  }

  _getBullseye(coalitionNum) {
    return new Promise((resolve, reject) => {
      this._coalSvc.GetBullseye({ coalition: coalitionNum }, (err, res) => {
        if (err || !res || !res.position) return reject(err || new Error('no position'));
        resolve({ lat: res.position.lat, lon: res.position.lon });
      });
    });
  }

  _getAirbases() {
    return new Promise((resolve, reject) => {
      this._worldSvc.GetAirbases({ coalition: 0 }, (err, res) => {
        if (err) return reject(err);
        const airports = (res.airbases || [])
          .filter(a => this._airbaseCatNum(a.category) === 1) // AIRDROME only
          .map(a => {
            const name = a.display_name || a.name;
            return {
              name,
              icao: this._icao[name] || this._icao[a.name] || null,
              lat:  a.position ? a.position.lat  : 0,
              lon:  a.position ? a.position.lon  : 0,
              elev: a.position ? Math.round(a.position.alt) : 0,
            };
          });
        resolve(airports);
      });
    });
  }

  // Fetch nav points for both coalitions via DCS-gRPC Eval (CustomService).
  // The mission Lua table uses DCS flat-earth coords; coord.LOtoLL converts them.
  // Note: nav_point.y is the east axis (DCS z), not altitude.
  _getNavpoints() {
    const query = (coalition, coalitionNum) => new Promise((resolve) => {
      const lua = `
local pts = {}
local ok, navpnts = pcall(function() return env.mission.coalition.${coalition}.nav_points or {} end)
if ok and navpnts then
  for _,p in ipairs(navpnts) do
    local lat,lon = coord.LOtoLL({x=p.x, y=0, z=p.y})
    local name = p.callsignStr or p.name or ""
    table.insert(pts, {name=name, lat=lat, lon=lon, coalition=${coalitionNum}})
  end
end
return net.lua2json(pts)
      `.trim();

      this._customSvc.Eval({ lua }, (err, res) => {
        if (err || !res) {
          console.warn(`[grpc] navpoints fetch failed (${coalition}):`, err && err.message);
          return resolve([]);
        }
        console.log(`[grpc] navpoints raw (${coalition}):`, res.json && res.json.slice(0, 200));
        try {
          const parsed = JSON.parse(JSON.parse(res.json));
          resolve(Array.isArray(parsed) ? parsed : []);
        } catch (e) {
          console.warn(`[grpc] navpoints parse failed (${coalition}):`, e.message, 'raw:', res.json && res.json.slice(0, 200));
          resolve([]);
        }
      });
    });

    return Promise.all([query('blue', 3), query('red', 2)])
      .then(([blueWps, redWps]) => [...blueWps, ...redWps]);
  }

  // Fetch DCS mission-editor drawings via CustomService.Eval.
  // Each drawing is returned with pre-converted lat/lon points (coord.LOtoLL).
  // Circles are returned as {lat, lon, radius}; polyline/polygon types as {points:[{lat,lon}]}.
  _getDrawings() {
    return new Promise((resolve) => {
      const lua = `
local result = {}
local ok, layers = pcall(function() return env.mission.drawings.layers end)
if ok and layers then
  for _, layer in pairs(layers) do
    local objs = type(layer) == "table" and layer.objects or nil
    if objs then
      for _, obj in pairs(objs) do
        if type(obj) == "table" then
          local ptype = obj.primitiveType or ""
          local pmode = obj.polygonMode or ""
          local ox = obj.mapX or 0
          local oy = obj.mapY or 0
          local d = {
            primitiveType = ptype,
            polygonMode   = pmode,
            coalition     = obj.coalition,
            color         = obj.colorString,
            lineColor     = obj.lineColorString,
            fillColor     = obj.fillColorString,
            closed        = obj.closed,
          }
          -- Origin lat/lon for circle center or anchor
          if ox ~= 0 or oy ~= 0 then
            local lat, lon = coord.LOtoLL({x=ox, y=0, z=oy})
            d.lat = lat
            d.lon = lon
          end
          if pmode == "circle" then
            d.radius = obj.radius
          elseif pmode == "rect" or pmode == "oval" or pmode == "triangle" then
            local hw = (obj.width  or 0) / 2
            local hh = (obj.height or obj.width or 0) / 2
            local a  = -(obj.angle or 0) * math.pi / 180
            local ca, sa = math.cos(a), math.sin(a)
            local pts = {}
            if pmode == "oval" then
              for i = 0, 63 do
                local t  = i * 2 * math.pi / 64
                local lx = hw * math.cos(t)
                local ly = hh * math.sin(t)
                local rx = lx * ca - ly * sa
                local ry = lx * sa + ly * ca
                local lat, lon = coord.LOtoLL({x=ox+ry, y=0, z=oy+rx})
                table.insert(pts, {lat=lat, lon=lon})
              end
            else
              local corners
              if pmode == "rect" then
                corners = {{hw,hh},{-hw,hh},{-hw,-hh},{hw,-hh}}
              else
                corners = {{0,hh},{-hw,-hh},{hw,-hh}}
              end
              for _, c in ipairs(corners) do
                local rx = c[1]*ca - c[2]*sa
                local ry = c[1]*sa + c[2]*ca
                local lat, lon = coord.LOtoLL({x=ox+ry, y=0, z=oy+rx})
                table.insert(pts, {lat=lat, lon=lon})
              end
            end
            if #pts > 0 then d.points = pts d.closed = true end
          elseif obj.points and #obj.points > 0 then
            -- Free polygon or Line: points are relative offsets from mapX/mapY
            local pts = {}
            for _, pt in ipairs(obj.points) do
              local lat, lon = coord.LOtoLL({x=ox + pt.x, y=0, z=oy + pt.y})
              table.insert(pts, {lat=lat, lon=lon})
            end
            d.points = pts
          end
          table.insert(result, d)
        end
      end
    end
  end
end
return net.lua2json(result)
      `.trim();

      this._customSvc.Eval({ lua }, (err, res) => {
        if (err || !res) {
          console.warn('[grpc] drawings fetch failed:', err && err.message);
          return resolve([]);
        }
        try {
          const parsed = JSON.parse(JSON.parse(res.json));
          resolve(Array.isArray(parsed) ? parsed : []);
        } catch (e) {
          console.warn('[grpc] drawings parse failed:', e.message, 'raw:', res.json && res.json.slice(0, 200));
          resolve([]);
        }
      });
    });
  }

  // ── Enum helpers ──────────────────────────────────────────────────────────

  _catNum(cat) {
    if (typeof cat === 'number') return cat;
    const map = {
      GROUP_CATEGORY_UNSPECIFIED: 0, GROUP_CATEGORY_AIRPLANE: 1,
      GROUP_CATEGORY_HELICOPTER:  2, GROUP_CATEGORY_GROUND:   3,
      GROUP_CATEGORY_SHIP:        4, GROUP_CATEGORY_TRAIN:    5,
    };
    return map[cat] ?? 0;
  }

  _coalNum(coal) {
    if (typeof coal === 'number') return coal;
    const map = {
      COALITION_ALL: 0, COALITION_NEUTRAL: 1, COALITION_RED: 2, COALITION_BLUE: 3,
    };
    return map[coal] ?? 0;
  }

  _airbaseCatNum(cat) {
    if (typeof cat === 'number') return cat;
    const map = {
      AIRBASE_CATEGORY_UNSPECIFIED: 0, AIRBASE_CATEGORY_AIRDROME: 1,
      AIRBASE_CATEGORY_HELIPAD:     2, AIRBASE_CATEGORY_SHIP:     3,
    };
    return map[cat] ?? 0;
  }

  _setState(state) {
    if (this._state === state) return;
    this._state = state;

    if (state === 'reconnecting') {
      // Brief reconnects (stream ended + restarted within 4 s) are invisible to
      // WS clients. Only emit if the reconnect is still in progress after 4 s.
      clearTimeout(this._statusTimer);
      this._statusTimer = setTimeout(() => {
        if (this._state === 'reconnecting') {
          console.log('[grpc] reconnecting (prolonged)');
          this.emit('status', 'reconnecting');
        }
      }, 4000);
    } else {
      clearTimeout(this._statusTimer);
      console.log(`[grpc] ${state}`);
      this.emit('status', state);
    }
  }

  getStatus() { return this._state; }
}

module.exports = GrpcClient;
