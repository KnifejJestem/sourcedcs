-- ============================================================
-- DCS Export.lua — MyGCI integration
-- Place this file at:
--   %DCS_SAVED_GAMES%\Scripts\Export.lua
--   (usually C:\Users\<you>\Saved Games\DCS\Scripts\Export.lua)
--
-- If you already have an Export.lua (e.g. from Tacview or DCS-BIOS),
-- append only the dofile() line at the BOTTOM of your existing file.
-- mygci_export.lua uses callback chaining and will coexist correctly.
--
-- lfs.writedir() returns the DCS Saved Games path (e.g.
--   C:\Users\<you>\Saved Games\DCS\) and IS required — it is a
--   standard DCS global available in Export.lua.
-- ============================================================

dofile(lfs.writedir()..'Scripts\\mygci_export.lua')
