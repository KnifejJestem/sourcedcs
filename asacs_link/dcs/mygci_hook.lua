-- ============================================================
-- MyGCI Hook Loader
-- Place at: %DCS_SAVED_GAMES%/Scripts/Hooks/mygci_hook.lua
--
-- This hook loader finds and runs mygci_events.lua, which handles
-- mission metadata and player events.
-- Real-time unit telemetry is provided separately by
-- mygci_export.lua, which must be loaded from Export.lua:
--   %DCS_SAVED_GAMES%/Scripts/Export.lua
-- Logging uses log.write('MYGCI.HOOK', ...) — search dcs.log for MYGCI.HOOK.
-- ============================================================

-- lfs is pre-loaded by DCS for hook scripts, but we require it
-- explicitly so the dependency is clear.
local lfs = require('lfs')

log.write('MYGCI.HOOK', log.INFO, 'GameGUI loading...')

do
    local mod_path = lfs.writedir() .. 'Mods\\services\\MyGCI\\'
    local events_file = mod_path .. 'lua\\mygci_events.lua'
    local f = io.open(events_file, 'r')
    if f then
        log.write('MYGCI.HOOK', log.INFO, 'Mod found, loading ' .. events_file)
        f:close()
        dofile(events_file)
    else
        log.write('MYGCI.HOOK', log.WARNING, 'Could not find ' .. events_file)
    end
end
