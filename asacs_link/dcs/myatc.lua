-- ============================================================
-- DCS GCI Hook  |  myatc.lua
-- Handles mission-level and player events via the DCS hook API.
-- Place this file at:
--   %DCS_SAVED_GAMES%/Mods/services/MyGCI/lua/myatc.lua
-- The hook loader goes to:
--   %DCS_SAVED_GAMES%/Scripts/Hooks/mygci_hook.lua
--
-- NOTE: Real-time unit data (positions, telemetry) is handled by
-- the Export.lua script (mygci_export.lua), NOT here.
-- world.searchObjects() is a mission-scripting API and is NOT
-- available in the hook environment — use LoGetWorldObjects()
-- in Export.lua instead.
-- ============================================================

local SERVER_HOST = "127.0.0.1"
local SERVER_PORT = 7788

-- ─── Socket setup ──────────────────────────────────────────────────────────

local socket = require("socket")
local udp = socket.udp()
udp:settimeout(0)

local function log(msg)
    net.log("[MyGCI] " .. tostring(msg))
end

-- ─── Tiny JSON encoder ─────────────────────────────────────────────────────
-- DCS doesn't ship with a JSON lib in the hook environment, so we include
-- a minimal one. Replace with require('dkjson') if you add it to Scripts/.

local function json_encode(val)
    local t = type(val)
    if t == "nil" then return "null"
    elseif t == "boolean" then return val and "true" or "false"
    elseif t == "number" then
        if val ~= val then return "null" end  -- NaN guard
        return tostring(val)
    elseif t == "string" then
        return '"' .. val:gsub('\\', '\\\\'):gsub('"', '\\"'):gsub('\n', '\\n'):gsub('\r', '\\r'):gsub('\t', '\\t') .. '"'
    elseif t == "table" then
        local is_array = #val > 0
        if is_array then
            local parts = {}
            for _, v in ipairs(val) do
                parts[#parts + 1] = json_encode(v)
            end
            return "[" .. table.concat(parts, ",") .. "]"
        else
            local parts = {}
            for k, v in pairs(val) do
                parts[#parts + 1] = json_encode(tostring(k)) .. ":" .. json_encode(v)
            end
            return "{" .. table.concat(parts, ",") .. "}"
        end
    end
    return "null"
end

local function send_json(data)
    local ok, err = udp:sendto(json_encode(data), SERVER_HOST, SERVER_PORT)
    if not ok then
        log("UDP send error: " .. tostring(err))
    end
end

-- ─── Mission data extraction ───────────────────────────────────────────────
-- DCS.getCurrentMission() and related APIs are available in the hook
-- environment and correctly return mission metadata.

local function extract_mission()
    local env = DCS.getCurrentMission()
    if not env then return nil end

    local mission = env.mission
    return {
        name      = DCS.getMissionName() or "",
        filename  = DCS.getMissionFilename() or "",
        theatre   = mission.theatre or "",
        startTime = mission.start_time or 0,
        date      = {
            year  = mission.date and mission.date.Year  or 0,
            month = mission.date and mission.date.Month or 0,
            day   = mission.date and mission.date.Day   or 0,
        },
        bullseye  = {
            blue = mission.coalition and mission.coalition.blue and mission.coalition.blue.bullseye or {},
            red  = mission.coalition and mission.coalition.red  and mission.coalition.red.bullseye  or {},
        },
    }
end

-- ─── DCS Hook Callbacks ────────────────────────────────────────────────────
-- These are registered via DCS.setUserCallbacks() and run in the
-- hook (GUI) thread. They handle events, NOT unit polling.
-- Unit telemetry is sent by mygci_export.lua via Export.lua callbacks.

local callbacks = {}

function callbacks.onMissionLoadEnd()
    local ok, mission = pcall(extract_mission)
    if ok and mission then
        send_json({ type = "mission", data = mission })
    end
    log("Mission loaded, GCI active")
end

function callbacks.onSimulationStop()
    -- sim_stop is also sent by mygci_export.lua LuaExportStop(),
    -- but we send it here too for robustness in case Export is not installed.
    send_json({ type = "sim_stop" })
    log("Simulation stopped")
end

function callbacks.onPlayerConnect(id)
    local info = net.get_player_info(id)
    if info then
        send_json({
            type   = "player_connect",
            id     = id,
            name   = info.name,
            ipaddr = info.ipaddr or "",
        })
    end
end

function callbacks.onPlayerDisconnect(id, err_code)
    send_json({ type = "player_disconnect", id = id })
end

function callbacks.onPlayerChangeSlot(id)
    local info = net.get_player_info(id)
    if info then
        send_json({
            type = "slot_change",
            id   = id,
            slot = info.slot or "",
            side = info.side or 0,
        })
    end
end

DCS.setUserCallbacks(callbacks)
log("MyGCI hook loaded — sending to " .. SERVER_HOST .. ":" .. SERVER_PORT)
