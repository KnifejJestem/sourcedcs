/**
 * GCI Server Configuration
 * Edit this file to change passwords, ports, and behavior.
 * In production, set passwords via environment variables:
 *   ASACS_PASSWORD_BLUE, ASACS_PASSWORD_RED,
 *   ASACS_PASSWORD_NEUTRAL, ASACS_PASSWORD_ADMIN
 */

const config = {
  // WebSocket / HTTP port (clients connect here)
  wsPort: parseInt(process.env.PORT || '3000', 10),

  // UDP port (DCS Lua hook sends data here)
  udpHost: process.env.ASACS_UDP_HOST || '0.0.0.0',
  udpPort: 7788,

  // Coalition passwords — override via env vars before deployment
  passwords: {
    blue:    process.env.ASACS_PASSWORD_BLUE    || 'blue_pass',
    red:     process.env.ASACS_PASSWORD_RED     || 'red_pass',
    neutral: process.env.ASACS_PASSWORD_NEUTRAL || 'neutral_pass',
    admin:   process.env.ASACS_PASSWORD_ADMIN   || 'admin_pass',
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
