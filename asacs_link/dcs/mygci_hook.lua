-- ============================================================
-- MyGCI Hook Loader
-- Place at: %DCS_SAVED_GAMES%/Scripts/Hooks/mygci_hook.lua
--
-- This hook handles mission metadata and player events.
-- Real-time unit telemetry is provided separately by
-- mygci_export.lua, which must be loaded from Export.lua:
--   %DCS_SAVED_GAMES%/Scripts/Export.lua
-- ============================================================

net.log('[MyGCI] GameGUI loading...')

do
    local mod_path = lfs.writedir() .. 'Mods\\services\\MyGCI\\'
    local f = io.open(mod_path .. 'lua\\myatc.lua', 'r')
    if f then
        net.log('[MyGCI] Mod found, loading...')
        f:close()
        dofile(mod_path .. 'lua\\myatc.lua')
    else
        net.log('[MyGCI] ERROR: Could not find ' .. mod_path .. 'lua\\myatc.lua')
    end
end
