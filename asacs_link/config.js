/**
 * GCI Server Configuration
 * Edit this file to change passwords, ports, and behavior.
 */

const config = {
  // WebSocket / HTTP port (clients connect here)
  wsPort: 3000,

  // UDP port (DCS Lua hook sends data here)
  udpHost: '127.0.0.1',
  udpPort: 7788,

  // Coalition passwords — change these before deployment
  passwords: {
    blue:    'blue_pass',
    red:     'red_pass',
    neutral: 'neutral_pass',
    admin:   'admin_pass',  // sees all units, all coalitions
  },

  // Realism rules
  realism: {
    // Hostile tracks: what data is visible without IFF resolution
    hostile: {
      showPosition:  true,   // lat/lon always visible on radar
      showAltitude:  true,   // altitude visible on radar
      showSpeed:     false,  // speed NOT visible (no datalink)
      showHeading:   false,  // heading NOT visible
      showType:      false,  // type UNKNOWN unless IFF resolved
      showSquawk:    true,   // Mode 3 squawk visible if transponder active
      iffResolved:   false,  // mark as unresolved IFF
    },
    // Friendly tracks: full datalink picture
    friendly: {
      showPosition:  true,
      showAltitude:  true,
      showSpeed:     true,
      showHeading:   true,
      showType:      true,
      showSquawk:    true,
      iffResolved:   true,
    },
    // Neutral tracks: position/alt only (like hostile but flagged neutral)
    neutral: {
      showPosition:  true,
      showAltitude:  true,
      showSpeed:     false,
      showHeading:   false,
      showType:      false,
      showSquawk:    true,
      iffResolved:   false,
    },
  },
};

export default config;
