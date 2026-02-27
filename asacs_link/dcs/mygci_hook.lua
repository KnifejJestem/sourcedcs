-- ============================================================
-- MyGCI Hook Loader
-- Place at: %DCS_SAVED_GAMES%/Scripts/Hooks/mygci_hook.lua
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
