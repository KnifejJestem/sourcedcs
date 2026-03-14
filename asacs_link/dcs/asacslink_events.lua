-- ============================================================
-- DCS GCI Hook Events  |  asacslink_events.lua
-- Handles mission-level and player events via the DCS hook API.
-- Place this file at:
--   %DCS_SAVED_GAMES%/Mods/services/AsacsLink/lua/asacslink_events.lua
-- The hook loader goes to:
--   %DCS_SAVED_GAMES%/Scripts/Hooks/asacslink_hook.lua
--
-- NOTE: Real-time unit data (positions, telemetry) is handled by
-- the Export.lua script (asacslink_export.lua), NOT here.
-- world.searchObjects() is a mission-scripting API and is NOT
-- available in the hook environment — use LoGetWorldObjects()
-- in Export.lua instead.
--
-- Output files (written to DCS Saved Games folder):
--   asacslink_mission.json — mission metadata on mission load
--   asacslink_event.json   — player events (connect/disconnect/slot)
-- Files are written atomically via a .tmp rename to prevent
-- the server from reading a partially-written file.
-- Logging uses log.write('ASACSLINK.HOOK', ...) — search dcs.log for ASACSLINK.HOOK.
-- ============================================================

-- lfs is available in the hook environment but we require it explicitly
-- so the dependency is declared and the local is always defined.
local lfs = require('lfs')

-- Capture the DCS log global before we define a local 'log' function.
local dcslog = log

local function log(msg)
    dcslog.write('ASACSLINK.HOOK', dcslog.INFO, tostring(msg))
end

-- File paths for atomic output (same Saved Games folder used by asacslink_export.lua)
local MISSION_PATH = lfs.writedir() .. "asacslink_mission.json"
local MISSION_TMP  = lfs.writedir() .. "asacslink_mission.tmp"
local EVENT_PATH   = lfs.writedir() .. "asacslink_event.json"
local EVENT_TMP    = lfs.writedir() .. "asacslink_event.tmp"

-- ─── Atomic file writer ────────────────────────────────────────────────────
-- Writes content to a .tmp file then renames it to the final path.
-- On Windows, os.rename() atomically replaces the destination so the
-- server never reads a partially-written file.

local function write_file_atomic(path, tmp_path, content)
    local f = io.open(tmp_path, "w")
    if not f then
        log("ERROR: cannot open " .. tmp_path .. " for writing")
        return
    end
    f:write(content)
    f:close()
    local ok, err = os.rename(tmp_path, path)
    if not ok then
        log("ERROR: cannot rename " .. tmp_path .. " to " .. path .. ": " .. tostring(err))
    end
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
        -- Escape backslash + double-quote first, then all remaining control chars
        return '"' .. val:gsub('[\\"]', function(c)
                return '\\' .. c
            end):gsub('%c', function(c)
                local b = string.byte(c)
                if b == 8  then return '\\b'
                elseif b == 9  then return '\\t'
                elseif b == 10 then return '\\n'
                elseif b == 12 then return '\\f'
                elseif b == 13 then return '\\r'
                else return string.format('\\u%04x', b)
                end
            end) .. '"'
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

local function write_mission(data)
    write_file_atomic(MISSION_PATH, MISSION_TMP, json_encode(data))
end

local function write_event(data)
    write_file_atomic(EVENT_PATH, EVENT_TMP, json_encode(data))
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
-- Unit telemetry is sent by asacslink_export.lua via Export.lua callbacks.

local callbacks = {}

function callbacks.onMissionLoadEnd()
    local ok, mission = pcall(extract_mission)
    if ok and mission then
        write_mission({ type = "mission", data = mission })
    end
    log("Mission loaded, GCI active")
end

function callbacks.onSimulationStop()
    -- sim_stop is also written by asacslink_export.lua LuaExportStop(),
    -- but we write it here too for robustness in case Export is not installed.
    write_event({ type = "sim_stop" })
    log("Simulation stopped")
end

function callbacks.onPlayerConnect(id)
    local info = net.get_player_info(id)
    if info then
        write_event({
            type   = "player_connect",
            id     = id,
            name   = info.name,
            ipaddr = info.ipaddr or "",
        })
    end
end

function callbacks.onPlayerDisconnect(id, err_code)
    write_event({ type = "player_disconnect", id = id })
end

function callbacks.onPlayerChangeSlot(id)
    local info = net.get_player_info(id)
    if info then
        write_event({
            type = "slot_change",
            id   = id,
            slot = info.slot or "",
            side = info.side or 0,
        })
    end
end

DCS.setUserCallbacks(callbacks)
log("AsacsLink hook events loaded — writing to " .. MISSION_PATH)
