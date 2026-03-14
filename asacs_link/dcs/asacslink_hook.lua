-- ============================================================
-- AsacsLink Hook Loader
-- Place at: %DCS_SAVED_GAMES%/Scripts/Hooks/asacslink_hook.lua
--
-- This hook loader finds and runs asacslink_events.lua, which handles
-- mission metadata and player events.
-- Real-time unit telemetry is provided separately by
-- asacslink_export.lua, which must be loaded from Export.lua:
--   %DCS_SAVED_GAMES%/Scripts/Export.lua
-- Logging uses log.write('ASACSLINK.HOOK', ...) — search dcs.log for ASACSLINK.HOOK.
-- ============================================================

-- lfs is pre-loaded by DCS for hook scripts, but we require it
-- explicitly so the dependency is clear.
local lfs = require('lfs')

log.write('ASACSLINK.HOOK', log.INFO, 'GameGUI loading...')

do
    local mod_path = lfs.writedir() .. 'Mods\\services\\AsacsLink\\'
    local events_file = mod_path .. 'lua\\asacslink_events.lua'
    local f = io.open(events_file, 'r')
    if f then
        log.write('ASACSLINK.HOOK', log.INFO, 'Mod found, loading ' .. events_file)
        f:close()
        dofile(events_file)
    else
        log.write('ASACSLINK.HOOK', log.WARNING, 'Could not find ' .. events_file)
    end
end
