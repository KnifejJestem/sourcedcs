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

  // Path to the DCS Saved Games folder where the DCS scripts write their output files.
  // Set ASACS_DCS_FILES_PATH to e.g. 'C:\\Users\\you\\Saved Games\\DCS\\'
  // (include the trailing backslash).  The server polls four files from this directory:
  //   mygci_units.json   — unit telemetry (written by mygci_export.lua at 2 Hz)
  //   mygci_status.json  — export status events (written by mygci_export.lua)
  //   mygci_mission.json — mission metadata (written by mygci_events.lua on mission load)
  //   mygci_event.json   — player events (written by mygci_events.lua)
  // Must be accessible from the machine running this server (use a network share
  // or Docker volume if needed).
  dcsFilesPath: process.env.ASACS_DCS_FILES_PATH || '',

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
