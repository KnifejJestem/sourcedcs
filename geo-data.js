// ═══════════════════════════════════════════════════════════
// geo-data.js  —  Country outlines + city database
// Fetches Natural Earth 1:110m GeoJSON on first call, caches result.
// Exposes loadGeoData() globally for plain <script> tag usage.
// ═══════════════════════════════════════════════════════════

const GEO_CDN = 'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_admin_0_countries.geojson';

// ── City database ─────────────────────────────────────────
const CITIES = [
  {"n":"Tehran","lat":35.69,"lon":51.39,"pop":3},
  {"n":"Baghdad","lat":33.34,"lon":44.40,"pop":3},
  {"n":"Damascus","lat":33.51,"lon":36.29,"pop":2},
  {"n":"Beirut","lat":33.89,"lon":35.50,"pop":2},
  {"n":"Amman","lat":31.95,"lon":35.93,"pop":2},
  {"n":"Jerusalem","lat":31.77,"lon":35.22,"pop":2},
  {"n":"Riyadh","lat":24.69,"lon":46.72,"pop":3},
  {"n":"Jeddah","lat":21.54,"lon":39.17,"pop":2},
  {"n":"Sanaa","lat":15.35,"lon":44.21,"pop":2},
  {"n":"Muscat","lat":23.61,"lon":58.59,"pop":2},
  {"n":"Dubai","lat":25.20,"lon":55.27,"pop":2},
  {"n":"Abu Dhabi","lat":24.47,"lon":54.37,"pop":2},
  {"n":"Doha","lat":25.29,"lon":51.53,"pop":2},
  {"n":"Kuwait City","lat":29.37,"lon":47.98,"pop":2},
  {"n":"Manama","lat":26.22,"lon":50.59,"pop":1},
  {"n":"Kabul","lat":34.52,"lon":69.18,"pop":2},
  {"n":"Islamabad","lat":33.72,"lon":73.06,"pop":2},
  {"n":"Karachi","lat":24.86,"lon":67.01,"pop":3},
  {"n":"Aden","lat":12.78,"lon":45.04,"pop":1},
  {"n":"Bandar Abbas","lat":27.19,"lon":56.27,"pop":2},
  {"n":"Khasab","lat":26.19,"lon":56.24,"pop":1},
  {"n":"Jask","lat":25.64,"lon":57.77,"pop":1},
  {"n":"Isfahan","lat":32.66,"lon":51.68,"pop":2},
  {"n":"Shiraz","lat":29.61,"lon":52.53,"pop":2},
  {"n":"Mosul","lat":36.34,"lon":43.13,"pop":2},
  {"n":"Basra","lat":30.51,"lon":47.78,"pop":2},
  {"n":"Aleppo","lat":36.20,"lon":37.16,"pop":2},
  {"n":"Ankara","lat":39.93,"lon":32.86,"pop":2},
  {"n":"Istanbul","lat":41.01,"lon":28.95,"pop":3},
  {"n":"Izmir","lat":38.42,"lon":27.14,"pop":2},
  {"n":"Cairo","lat":30.06,"lon":31.25,"pop":3},
  {"n":"Alexandria","lat":31.20,"lon":29.92,"pop":2},
  {"n":"Tripoli","lat":32.90,"lon":13.18,"pop":2},
  {"n":"Tunis","lat":36.82,"lon":10.17,"pop":2},
  {"n":"Athens","lat":37.98,"lon":23.73,"pop":2},
  {"n":"Nicosia","lat":35.17,"lon":33.36,"pop":1},
  {"n":"Naples","lat":40.84,"lon":14.25,"pop":2},
  {"n":"Rome","lat":41.90,"lon":12.49,"pop":2},
  {"n":"Incirlik AB","lat":37.00,"lon":35.42,"pop":1},
  {"n":"Djibouti","lat":11.59,"lon":43.15,"pop":1},
  {"n":"Al Dhafra","lat":24.25,"lon":54.55,"pop":1},
  {"n":"Al Udeid","lat":25.12,"lon":51.31,"pop":1},
  {"n":"Ali Al Salem","lat":29.53,"lon":47.52,"pop":1},
];

// ── GeoJSON → ring conversion ──────────────────────────────
function geometryToRings(geometry) {
  const rings = [];
  if (geometry.type === 'Polygon') {
    const outer = geometry.coordinates[0];
    if (outer && outer.length > 2) rings.push(outer);
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach(polygon => {
      const outer = polygon[0];
      if (outer && outer.length > 2) rings.push(outer);
    });
  }
  return rings;
}

// ── Cache ─────────────────────────────────────────────────
let _cache = null;

// ── Main exported function ────────────────────────────────
async function loadGeoData() {
  if (_cache) return _cache;

  let countries = {};
  try {
    const res = await fetch(GEO_CDN);
    if (!res.ok) throw new Error(`Failed to fetch geo data from ${GEO_CDN}: ${res.status} ${res.statusText}`);
    const geojson = await res.json();
    geojson.features.forEach(feature => {
      const name = (feature.properties && (feature.properties.name || feature.properties.NAME)) || 'Unknown';
      const rings = geometryToRings(feature.geometry);
      rings.forEach((ring, i) => {
        const key = i === 0 ? name : `${name}_${i}`;
        countries[key] = ring;
      });
    });
  } catch (err) {
    console.warn('geo-data.js: failed to fetch country outlines, falling back to empty.', err);
    countries = {};
  }

  _cache = { countries, cities: CITIES };
  return _cache;
}

window.loadGeoData = loadGeoData;
