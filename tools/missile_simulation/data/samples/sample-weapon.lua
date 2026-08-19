-- Synthetic sample weapon table for testing the Missile Flyout Scope's
-- Lua loader (Weapon > Load .lua file, or paste it into "Or paste table
-- text"). Not a real Eagle Dynamics weapon definition -- the numbers are
-- plausible but invented -- and it's shaped to exercise a few code paths
-- the built-in AIM-120C doesn't:
--   * the guidance sub-table named "ap" instead of "autopilot"
--   * no loft flag anywhere, so it should load with no loft phase
--   * D_max present with no active_radar_lock_dist, so the seeker-active
--     range should fall back to D_max (and say so in "Values in use")
--   * wrapped one level deep in matching client/server copies, so it
--     should load as a single weapon with a "shown once" note

weapons =
{
  ["AIM_9M_sample"] =
  {
    ["client"] =
    {
      ["class_name"] = "AIM_9M_sample",
      ["display_name"] = "AIM-9M Sidewinder (sample)",
      ["M"] = 85.3,
      ["Mach_max"] = 2.5,
      ["v_min"] = 130,
      ["Life_Time"] = 60,
      ["D_max"] = 8000,
      ["Range_max"] = 18520,
      ["fm"] =
      {
        ["S"] = 0.0175,
        ["table_scale"] = 0.2,
        ["Cx0"] =
        {
          [1] = 0.42, [2] = 0.42, [3] = 0.45, [4] = 0.58, [5] = 0.71,
          [6] = 0.69, [7] = 0.64, [8] = 0.60, [9] = 0.56, [10] = 0.53,
          [11] = 0.50, [12] = 0.48,
        },
      },
      ["boost"] = { ["impulse"] = 0, ["fuel_mass"] = 0, ["work_time"] = 0.1 },
      ["march"] = { ["impulse"] = 210, ["fuel_mass"] = 9.4, ["work_time"] = 2.2 },
      ["ap"] =
      {
        ["gload_limit"] = 25,
        ["Tc"] = 0.08,
        ["Knav"] = 3,
      },
      ["sensor"] = { ["sens_far_dist"] = 10000, ["delay"] = 0.8 },
      ["proximity_fuze"] = { ["radius"] = 6 },
    },
    ["server"] =
    {
      ["class_name"] = "AIM_9M_sample",
      ["display_name"] = "AIM-9M Sidewinder (sample)",
      ["M"] = 85.3,
      ["Mach_max"] = 2.5,
      ["v_min"] = 130,
      ["Life_Time"] = 60,
      ["D_max"] = 8000,
      ["Range_max"] = 18520,
      ["fm"] =
      {
        ["S"] = 0.0175,
        ["table_scale"] = 0.2,
        ["Cx0"] =
        {
          [1] = 0.42, [2] = 0.42, [3] = 0.45, [4] = 0.58, [5] = 0.71,
          [6] = 0.69, [7] = 0.64, [8] = 0.60, [9] = 0.56, [10] = 0.53,
          [11] = 0.50, [12] = 0.48,
        },
      },
      ["boost"] = { ["impulse"] = 0, ["fuel_mass"] = 0, ["work_time"] = 0.1 },
      ["march"] = { ["impulse"] = 210, ["fuel_mass"] = 9.4, ["work_time"] = 2.2 },
      ["ap"] =
      {
        ["gload_limit"] = 25,
        ["Tc"] = 0.08,
        ["Knav"] = 3,
      },
      ["sensor"] = { ["sens_far_dist"] = 10000, ["delay"] = 0.8 },
      ["proximity_fuze"] = { ["radius"] = 6 },
    },
  },
}
