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
--   This script uses callback chaining, so it coexists correctly with
--   Tacview, DCS-BIOS, and other Export.lua scripts. Load it LAST
--   (append the dofile() line at the end of Export.lua) so that it
--   can capture and chain any previously-defined callbacks.
--
-- Periodic telemetry uses LuaExportActivityNextEvent(t), the same
-- timer-scheduled callback that Tacview uses. It receives the current
-- sim time and returns the next desired call time (t + UPDATE_RATE),
-- making it more reliable than LuaExportAfterNextFrame.
--   It uses LoGetWorldObjects() to enumerate all world objects and
--   LoGetObjectById() for per-unit data (speed, heading) — the correct
--   Export.lua APIs per https://wiki.hoggitworld.com/view/DCS_export
--
-- Output is written to files in the DCS Saved Games folder:
--   mygci_units.json  — current unit snapshot (updated at UPDATE_RATE)
--   mygci_status.json — status events (export_loaded, sim_stop)
-- Files are written atomically: first to a .tmp file, then renamed,
-- so the server never reads a partially-written file.
-- ============================================================

local UPDATE_RATE = 0.5   -- seconds between unit exports (2 Hz)

-- Output files are written to the DCS Saved Games directory.
-- lfs.writedir() returns e.g. C:\Users\you\Saved Games\DCS\
local OUTPUT_PATH = lfs.writedir() .. "mygci_units.json"
local OUTPUT_TMP  = lfs.writedir() .. "mygci_units.tmp"
local STATUS_PATH = lfs.writedir() .. "mygci_status.json"
local STATUS_TMP  = lfs.writedir() .. "mygci_status.tmp"

-- Verbose logging: set VERBOSE = true to enable per-call diagnostic output.
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

-- ─── Atomic file writer ────────────────────────────────────────────────────
-- Writes content to a .tmp file then renames it to the final path.
-- On Windows, os.rename() atomically replaces the destination, so the
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

-- encode_array forces a Lua table to encode as a JSON array even when empty.
local function json_encode(val, force_array)
    local t = type(val)
    if t == "nil" then return "null"
    elseif t == "boolean" then return val and "true" or "false"
    elseif t == "number" then
        if val ~= val then return "null" end  -- NaN: only NaN is not equal to itself
        return tostring(val)
    elseif t == "string" then
        -- Escape all ASCII control characters (0x00–0x1F) to produce valid JSON
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
        -- A table is treated as a JSON array if it is non-empty with integer
        -- keys starting at 1 (Lua sequence), OR if force_array is true.
        local is_array = force_array or #val > 0
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

local function write_units_json(units)
    -- Build the JSON manually so that the units field is always an array
    -- (even when empty), matching the format the server expects.
    local units_json = json_encode(units, true)  -- force_array=true
    local content = '{"type":"units","units":' .. units_json .. '}'
    write_file_atomic(OUTPUT_PATH, OUTPUT_TMP, content)
end

local function write_status(data)
    write_file_atomic(STATUS_PATH, STATUS_TMP, json_encode(data))
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
-- LoGetWorldObjects() enumerates all active world objects.
-- LoGetObjectById(id) returns enriched per-unit data including velocity.
-- Both are documented at https://wiki.hoggitworld.com/view/DCS_export

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

            -- Heading: provided in radians by LoGetWorldObjects; convert to degrees true (0–360).
            local hdg_rad = obj.Heading or 0
            local hdg_deg = math.deg(hdg_rad)
            if hdg_deg < 0 then hdg_deg = hdg_deg + 360 end

            -- Speed: LoGetWorldObjects does not include velocity.
            -- LoGetObjectById(id) returns a Velocity table with x/y/z components
            -- in the DCS world frame (metres per second). Ground speed is the
            -- horizontal magnitude: sqrt(vx^2 + vz^2).
            local spd = 0
            local detail = LoGetObjectById(id)
            if detail then
                local vel = detail.Velocity
                if vel then
                    -- vx and vz are horizontal; vy is vertical
                    spd = math.floor(math.sqrt((vel.x or 0)^2 + (vel.z or 0)^2) + 0.5)
                end
                -- LoGetObjectById may also provide a more accurate Heading
                if detail.Heading then
                    hdg_rad = detail.Heading
                    hdg_deg = math.deg(hdg_rad)
                    if hdg_deg < 0 then hdg_deg = hdg_deg + 360 end
                end
            end

            units[#units + 1] = {
                id        = id,
                lat       = lat,
                lon       = lon,
                alt       = alt,
                hdg       = math.floor(hdg_deg),
                spd       = spd,
                coalition = obj.CoalitionID or 0,
                category  = category,
                typeName  = obj.Name or "Unknown",
                type      = obj.Name or "Unknown",
                squawk    = squawk,
                unitName  = obj.UnitName  or "",
                groupName = obj.GroupName or "",
                pilotName = pilot,
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
-- DCS calls LuaExport* callbacks automatically when the script is loaded
-- via Export.lua. No manual registration is needed.
--
-- Callback chaining: preserve any previously-defined callbacks (e.g. from
-- Tacview or DCS-BIOS) so that multiple export scripts coexist correctly.

local _prev_LuaExportStart              = LuaExportStart
local _prev_LuaExportStop               = LuaExportStop
local _prev_LuaExportActivityNextEvent  = LuaExportActivityNextEvent

function LuaExportStart()
    if _prev_LuaExportStart then
        local ok, err = pcall(_prev_LuaExportStart)
        if not ok then log("Chained LuaExportStart error: " .. tostring(err)) end
    end
    log("MyGCI Export started — writing to " .. OUTPUT_PATH)
end

function LuaExportStop()
    if _prev_LuaExportStop then
        local ok, err = pcall(_prev_LuaExportStop)
        if not ok then log("Chained LuaExportStop error: " .. tostring(err)) end
    end
    write_status({ type = "sim_stop" })
    log("MyGCI Export stopped")
end

-- LuaExportActivityNextEvent(t) is a timer-scheduled callback: DCS passes the
-- current sim time and the function returns when it next wants to be called.
-- This is more reliable than LuaExportAfterNextFrame and is the same mechanism
-- used by Tacview. Chaining preserves the previous script's schedule by taking
-- the earlier of the two desired next-call times.
function LuaExportActivityNextEvent(t)
    local tNext = t + UPDATE_RATE

    -- Chain previous callback and honour its requested schedule too
    if _prev_LuaExportActivityNextEvent then
        local ok, prevNext = pcall(_prev_LuaExportActivityNextEvent, t)
        if ok and type(prevNext) == "number" and prevNext < tNext then
            tNext = prevNext
        end
    end

    local ok, units = pcall(extract_units)
    if ok and units then
        logv("Writing " .. #units .. " unit(s) to " .. OUTPUT_PATH)
        local sent_ok, send_err = pcall(write_units_json, units)
        if not sent_ok then
            log("ERROR writing units file: " .. tostring(send_err))
        end
    else
        log("ERROR in extract_units: " .. tostring(units))
    end

    return tNext
end

-- Write a status file so the server can confirm that Export.lua has loaded
-- this script, even before the first mission starts.
-- Check /api/raw on the server: "Export script: loaded" confirms this line ran.
write_status({ type = "export_loaded" })
log("MyGCI Export script loaded — awaiting LuaExportStart()")
