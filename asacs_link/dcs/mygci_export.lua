-- ============================================================
-- DCS GCI Export Script  |  mygci_export.lua
-- Uses the Export.lua system (LuaExport* callbacks + LoGet* APIs)
-- for real-time unit telemetry — this is the correct DCS method.
--
-- Installation:
--   Copy this file to:
--     %DCS_SAVED_GAMES%/Scripts/mygci_export.lua
--
--   Then add the following line to
--     %DCS_SAVED_GAMES%/Scripts/Export.lua
--   (create the file if it does not exist):
--     dofile(lfs.writedir()..'Scripts\\mygci_export.lua')
--   Note: backslashes are correct — DCS runs on Windows only.
--
--   DCS calls Export.lua every simulation frame so this script
--   receives real-time telemetry data via LoGetWorldObjects().
-- ============================================================

local SERVER_HOST = "127.0.0.1"
local SERVER_PORT = 7788
local UPDATE_RATE = 0.5   -- seconds between unit exports (2 Hz)

local socket = require("socket")
local udp    = socket.udp()
udp:settimeout(0)

local last_update = 0

-- Verbose logging: set VERBOSE = true to enable per-frame diagnostic output.
-- When tracks are missing, flip this to true and check the DCS log file
-- (%DCS_SAVED_GAMES%/Logs/dcs.log) for [MyGCI][VERBOSE] lines.
-- Leave false in production to avoid log spam.
local VERBOSE = false

local function log(msg)
    io.write("[MyGCI] " .. tostring(msg) .. "\n")
end

local function logv(msg)
    if VERBOSE then
        io.write("[MyGCI][VERBOSE] " .. tostring(msg) .. "\n")
    end
end

-- ─── Tiny JSON encoder ─────────────────────────────────────────────────────

local function json_encode(val)
    local t = type(val)
    if t == "nil" then return "null"
    elseif t == "boolean" then return val and "true" or "false"
    elseif t == "number" then
        if val ~= val then return "null" end  -- NaN: only NaN is not equal to itself
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

-- ─── Category mapping ──────────────────────────────────────────────────────
-- LoGetWorldObjects returns Type.level1: 1=Air, 2=Ground, 3=Sea
-- For Air, Type.level2 gives: 1=Airplane, 2=Helicopter

local function get_category(obj_type)
    if not obj_type then return "Unknown" end
    local l1 = obj_type.level1 or 0
    if l1 == 1 then
        if (obj_type.level2 or 0) == 2 then return "Helicopter" end
        return "Airplane"
    elseif l1 == 2 then
        return "Ground"
    elseif l1 == 3 then
        return "Ship"
    end
    return "Unknown"
end

-- ─── Unit extraction via Export.lua API ───────────────────────────────────
-- LoGetWorldObjects() is the correct Export.lua API for iterating all
-- world objects. It does NOT require mission scripting context.

-- Squawk codes are 4-digit octal (0000–7777 = 0–4095 decimal).
-- DCS does not expose the raw transponder code via Export.lua, so we
-- derive a stable pseudo-squawk from the unit ID using modulo 4096
-- (the number of valid 4-digit octal codes, 0–7777 octal = 0–4095 decimal).
local SQUAWK_MODULO = 4096

local function extract_units()
    local objects = LoGetWorldObjects()
    if not objects then
        logv("LoGetWorldObjects() returned nil — no world objects available")
        return {}
    end

    local obj_count = 0
    for _ in pairs(objects) do obj_count = obj_count + 1 end
    logv("LoGetWorldObjects() returned " .. obj_count .. " object(s)")

    local units = {}
    local skipped_no_lla = 0
    for id, obj in pairs(objects) do
        local lla = obj.LatLongAlt
        if lla then
            -- LatLongAlt provides lat/lon/alt directly — no coord conversion needed
            local lat = lla.Lat  or 0
            local lon = lla.Long or 0
            local alt = math.floor(lla.Alt or 0)

            local category = get_category(obj.Type)

            -- Pseudo-squawk derived from unit ID
            -- (DCS does not expose raw transponder code via Export.lua)
            local squawk = id % SQUAWK_MODULO

            -- Pilot field is non-empty string for player-controlled units
            local pilot = obj.Pilot
            if pilot == "" then pilot = nil end

            -- Heading is provided in radians; convert to degrees true (0–360).
            local hdg_rad = obj.Heading or 0
            local hdg_deg = math.deg(hdg_rad)
            if hdg_deg < 0 then hdg_deg = hdg_deg + 360 end

            units[#units + 1] = {
                id        = id,
                lat       = lat,
                lon       = lon,
                alt       = alt,
                hdg       = math.floor(hdg_deg), -- degrees true, from obj.Heading
                coalition = obj.CoalitionID or 0,
                category  = category,
                typeName  = obj.Name or "Unknown",
                type      = obj.Name or "Unknown",
                squawk    = squawk,
                unitName  = obj.UnitName  or "",
                groupName = obj.GroupName or "",
                pilotName = pilot,
                -- Ground speed is not exposed by LoGetWorldObjects.
                spd = 0,
            }
        else
            skipped_no_lla = skipped_no_lla + 1
        end
    end
    logv("Extracted " .. #units .. " unit(s) with position data" ..
         (skipped_no_lla > 0 and (", skipped " .. skipped_no_lla .. " without LatLongAlt") or ""))
    return units
end

-- ─── Export.lua Callbacks ──────────────────────────────────────────────────
-- DCS calls these automatically every simulation frame when the script
-- is loaded via Export.lua. No manual registration is needed.

function LuaExportStart()
    log("MyGCI Export started — sending to " .. SERVER_HOST .. ":" .. SERVER_PORT)
end

function LuaExportStop()
    send_json({ type = "sim_stop" })
    log("MyGCI Export stopped")
end

function LuaExportAfterNextFrame()
    local now = LoGetModelTime()
    if now - last_update >= UPDATE_RATE then
        last_update = now
        local ok, units = pcall(extract_units)
        if ok and units then
            logv("Sending " .. #units .. " unit(s) via UDP to " .. SERVER_HOST .. ":" .. SERVER_PORT)
            local sent_ok, send_err = pcall(send_json, { type = "units", units = units })
            if not sent_ok then
                log("ERROR sending units packet: " .. tostring(send_err))
            end
        else
            log("ERROR in extract_units: " .. tostring(units))
        end
    end
end

log("MyGCI Export script loaded — awaiting LuaExportStart()")
