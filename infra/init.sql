-- Runs once on first container start
-- Creates all databases and users for the stack

-- MediaWiki
CREATE DATABASE IF NOT EXISTS wiki CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'wikiuser'@'%' IDENTIFIED BY 'change_me_wiki';
GRANT ALL PRIVILEGES ON wiki.* TO 'wikiuser'@'%';

-- Casdoor
CREATE DATABASE IF NOT EXISTS casdoor CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'casdoor'@'%' IDENTIFIED BY 'change_me_casdoor';
GRANT ALL PRIVILEGES ON casdoor.* TO 'casdoor'@'%';

FLUSH PRIVILEGES;
