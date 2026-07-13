#!/bin/bash
set -euo pipefail

# ───────────────────────────────────────────────
# MediaWiki + MariaDB backup script
# Run this from the /infra directory (where docker-compose.yml lives)
# ───────────────────────────────────────────────

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="mediawiki_backup_${TIMESTAMP}"
mkdir -p "${BACKUP_DIR}"

echo "==> Loading DB credentials from .env"
if [ ! -f .env ]; then
  echo "ERROR: .env not found in current directory. Run this from the infra/ folder."
  exit 1
fi
# shellcheck disable=SC1091
source .env

if [ -z "${MYSQL_ROOT_PASSWORD:-}" ]; then
  echo "ERROR: MYSQL_ROOT_PASSWORD not set in .env"
  exit 1
fi

echo "==> Dumping all databases from mariadb container (includes wiki + casdoor)"
docker exec mariadb sh -c "mariadb-dump -u root -p'${MYSQL_ROOT_PASSWORD}' --all-databases" > "${BACKUP_DIR}/all_databases.sql"

echo "==> Archiving mediawiki-images volume"
docker run --rm \
  -v mediawiki-images:/data \
  -v "$(pwd)/${BACKUP_DIR}":/backup \
  alpine tar czf /backup/mediawiki_images.tar.gz -C /data .

echo "==> Copying LocalSettings.php"
cp ./mediawiki/LocalSettings.php "${BACKUP_DIR}/LocalSettings.php"

echo "==> Copying docker-compose.yml and .env (for reference on restore)"
cp docker-compose.yml "${BACKUP_DIR}/docker-compose.yml"
cp .env "${BACKUP_DIR}/.env.backup"

echo "==> Compressing everything into a single archive"
tar czf "${BACKUP_DIR}.tar.gz" "${BACKUP_DIR}"
rm -rf "${BACKUP_DIR}"

echo ""
echo "Backup complete: ${BACKUP_DIR}.tar.gz"
echo "Transfer it with, e.g.:"
echo "  scp ${BACKUP_DIR}.tar.gz user@other-pc:/path/to/destination/"
