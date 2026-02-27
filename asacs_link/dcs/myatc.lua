-- ============================================================
-- DCS GCI Hook  |  myatc.lua
-- Place this file at:
--   %DCS_SAVED_GAMES%/Mods/services/MyGCI/lua/myatc.lua
-- The hook loader goes to:
--   %DCS_SAVED_GAMES%/Scripts/Hooks/mygci_hook.lua
-- ============================================================

local MyGCI = {}
local UPDATE_RATE = 0.5   -- seconds between unit exports (2 Hz)
local SERVER_HOST = "127.0.0.1"
local SERVER_PORT = 7788

-- ─── Socket setup ──────────────────────────────────────────────────────────

local socket = require("socket")
local udp = socket.udp()
udp:settimeout(0)

local function log(msg)
    net.log("[MyGCI] " .. tostring(msg))
end

local function send_json(data)
    -- Minimal JSON encoder (no external deps needed)
    local ok, err = udp:sendto(json_encode(data), SERVER_HOST, SERVER_PORT)
    if not ok then
        log("UDP send error: " .. tostring(err))
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
        return '"' .. val:gsub('\\', '\\\\'):gsub('"', '\\"'):gsub('\n', '\\n'):gsub('\r', '\\r'):gsub('\t', '\\t') .. '"'
    elseif t == "table" then
        -- Check if array
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

-- ─── Unit extraction ───────────────────────────────────────────────────────

-- DCS coalition IDs
local COALITION_NEUTRAL = 0
local COALITION_RED     = 1
local COALITION_BLUE    = 2

-- Maps DCS category numbers to strings
local CATEGORY_MAP = {
    [0] = "Airplane",
    [1] = "Helicopter",
    [2] = "Ground",
    [3] = "Ship",
    [4] = "Structure",
}

local function extract_units()
    local units = {}

    -- world.getAirsurfaceTargets returns all units visible in the sim
    -- We use world.searchObjects for a broader query
    local all_objects = {}

    -- Search all coalitions
    local function collect(coalition_id)
        -- volume: a huge sphere covering the whole map
        local volume = {
            id = world.VolumeType.SPHERE,
            params = {
                point  = { x = 0, y = 0, z = 0 },
                radius = 9000000,  -- 9000 km — covers any DCS map
            }
        }

        world.searchObjects(coalition_id, volume, function(obj)
            if obj and obj:isExist() then
                local ok, result = pcall(function()
                    local pos3 = obj:getPoint()
                    if not pos3 then return end

                    -- Convert 3D world coords → lat/lon
                    local lat, lon, alt = coord.LOtoLL(pos3)

                    -- Velocity for speed + heading
                    local vel = obj:getVelocity()
                    local spd = 0
                    local hdg = 0
                    if vel then
                        spd = math.sqrt(vel.x^2 + vel.y^2 + vel.z^2)
                        -- Heading: atan2 of x/z in world space
                        if spd > 1 then
                            hdg = math.deg(math.atan2(vel.x, vel.z))
                            if hdg < 0 then hdg = hdg + 360 end
                        end
                    end

                    local desc = obj:getDesc()
                    local category = desc and CATEGORY_MAP[desc.category] or "Unknown"

                    -- Transponder / IFF (available for aircraft)
                    local squawk = nil
                    if obj.getBeacon then
                        -- getBeacon not available on all objects
                        local beacon = obj:getBeacon()
                        if beacon then squawk = beacon end
                    end
                    -- Fallback: use unit ID mod 7777 as a pseudo-squawk
                    -- (real DCS doesn't expose squawk directly in Lua yet)
                    if not squawk then
                        squawk = (obj:getID() % 7778)
                    end

                    local unit_name = obj:getName() or ""
                    local group = obj:getGroup()
                    local group_name = group and group:getName() or ""

                    -- Pilot name for player-controlled units
                    local pilot_name = nil
                    local slot_id = net and net.get_slot and net.get_slot(obj:getID())
                    if slot_id then
                        local info = net.get_player_info(slot_id)
                        if info then pilot_name = info.name end
                    end

                    all_objects[#all_objects + 1] = {
                        id         = obj:getID(),
                        lat        = lat,
                        lon        = lon,
                        alt        = math.floor(alt),    -- meters ASL
                        spd        = math.floor(spd),    -- m/s
                        hdg        = math.floor(hdg),    -- degrees true
                        coalition  = coalition_id,
                        category   = category,
                        typeName   = desc and desc.typeName or "Unknown",
                        type       = desc and desc.displayName or "Unknown",
                        squawk     = squawk,
                        unitName   = unit_name,
                        groupName  = group_name,
                        pilotName  = pilot_name,
                    }
                end)
                if not ok then
                    -- silently skip objects that error
                end
            end
            return true  -- continue search
        end)
    end

    -- Only collect aircraft + helicopters for now (most relevant for GCI)
    -- You can add Ground/Ship later
    collect(COALITION_BLUE)
    collect(COALITION_RED)
    collect(COALITION_NEUTRAL)

    return all_objects
end

-- ─── Mission data extraction ───────────────────────────────────────────────

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

-- ─── Scheduler ─────────────────────────────────────────────────────────────

local last_update = 0

local function tick()
    local now = DCS.getModelTime()
    if now - last_update >= UPDATE_RATE then
        last_update = now
        local ok, units = pcall(extract_units)
        if ok and units then
            send_json({ type = "units", units = units })
        end
    end
end

-- ─── DCS Callbacks ─────────────────────────────────────────────────────────

local callbacks = {}

function callbacks.onMissionLoadEnd()
    local ok, mission = pcall(extract_mission)
    if ok and mission then
        send_json({ type = "mission", data = mission })
    end
    log("Mission loaded, GCI active")
end

function callbacks.onSimulationStop()
    send_json({ type = "sim_stop" })
    log("Simulation stopped")
end

function callbacks.onSimulationFrame()
    tick()
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
            type      = "slot_change",
            id        = id,
            slot      = info.slot or "",
            side      = info.side or 0,
        })
    end
end

DCS.setUserCallbacks(callbacks)
log("MyGCI hook loaded — sending to " .. SERVER_HOST .. ":" .. SERVER_PORT)
