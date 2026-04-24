#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Droplet Bootstrap Script
# Run once on a fresh Fedora droplet to deploy the full stack
# ─────────────────────────────────────────────────────────────
set -e

echo "==> Installing Docker..."
sudo dnf -y install dnf-plugins-core
sudo dnf-3 config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker

echo "==> Installing firewalld..."
sudo dnf install -y firewalld
sudo systemctl enable --now firewalld
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --reload

echo "==> Cloning infra repo..."
# Replace with your actual git repo
# git clone https://github.com/youruser/infra.git /opt/infra
# cd /opt/infra

echo "==> Setting up .env..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "  !! Edit .env with your real values before continuing !!"
  echo "  Run: nano .env"
  echo "  Then re-run this script or: docker compose up -d"
  exit 0
fi

# Load .env variables
if [ -f .env ]; then
  # Use a subshell to avoid issues with export and complex .env files
  set -a
  source .env
  set +a
fi

# Ensure mandatory variables have defaults if not set in .env
export WIKI_DB_USER=${WIKI_DB_USER:-wikiuser}
export WIKI_DB_PASSWORD=${WIKI_DB_PASSWORD:-wiki_pass}
export CASDOOR_DB_USER=${CASDOOR_DB_USER:-casdoor}
export CASDOOR_DB_PASSWORD=${CASDOOR_DB_PASSWORD:-casdoor_pass}

echo "==> Pulling images..."
docker compose pull

echo "==> Creating dummy certificates if they don't exist..."
# This prevents Nginx from crashing on the first run before Certbot issues real certificates.
# We create a self-signed dummy certificate for each domain if it's missing.

DOMAINS=("$DOMAIN" "$WIKI_DOMAIN" "$AUTH_DOMAIN" "$ATOBRIEF_DOMAIN" "$ASACS_DOMAIN")

# Ensure volumes are created
docker compose up --no-start nginx

for domain in "${DOMAINS[@]}"; do
  if [ -z "$domain" ]; then continue; fi
  
  docker run --rm -v "infra_certbot-certs:/etc/letsencrypt" alpine sh -c "
    apk add --no-cache openssl > /dev/null
    if [ ! -f /etc/letsencrypt/live/$domain/fullchain.pem ]; then
      echo \"  Creating dummy certificate for $domain...\"
      mkdir -p /etc/letsencrypt/archive/dummy
      if [ ! -f /etc/letsencrypt/archive/dummy/privkey.pem ]; then
        openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
          -keyout /etc/letsencrypt/archive/dummy/privkey.pem \
          -out /etc/letsencrypt/archive/dummy/fullchain.pem \
          -subj \"/CN=localhost\"
      fi
      mkdir -p /etc/letsencrypt/live/$domain
      ln -sf ../../archive/dummy/fullchain.pem /etc/letsencrypt/live/$domain/fullchain.pem
      ln -sf ../../archive/dummy/privkey.pem /etc/letsencrypt/live/$domain/privkey.pem
      # Certbot also expects these to exist usually
      ln -sf ../../archive/dummy/fullchain.pem /etc/letsencrypt/live/$domain/cert.pem
      ln -sf ../../archive/dummy/fullchain.pem /etc/letsencrypt/live/$domain/chain.pem
    fi
  "
done

echo "==> Starting stack (HTTP only first, for certbot)..."
docker compose up -d nginx mariadb mediawiki casdoor atobrief asacs-link

echo ""
echo "==> Issuing SSL certificates..."
echo "  Make sure DNS A records point to this server first!"
echo ""
if [ -z "$LE_EMAIL" ]; then
  read -p "Enter your email for Let's Encrypt: " LE_EMAIL
fi

# To ensure certbot can issue certificates even if dummy ones exist, 
# we need to make sure it doesn't fail due to pre-existing directories.
# We only remove directories that contain dummy symlinks.
# If it's a real directory (managed by certbot), we leave it alone.

echo "==> Issuing SSL certificates..."
# Remove dummy certificates so Certbot can create real ones without conflict
for domain in "${DOMAINS[@]}"; do
  if [ -z "$domain" ]; then continue; fi
  docker run --rm -v "infra_certbot-certs:/etc/letsencrypt" alpine sh -c "
    if [ -L /etc/letsencrypt/live/$domain/fullchain.pem ]; then
      # If it's a symlink, it's likely our dummy one. Check if it points to archive/dummy
      target=\$(readlink /etc/letsencrypt/live/$domain/fullchain.pem)
      if echo \"\$target\" | grep -q \"archive/dummy\"; then
        echo \"  Removing dummy certificate for \$domain before running Certbot...\"
        rm -rf \"/etc/letsencrypt/live/\$domain\"
      fi
    fi
  "
done

# Issue certificates one by one to ensure they are saved in domain-specific folders
# matching our Nginx configuration.
for domain in "${DOMAINS[@]}"; do
  if [ -z "$domain" ]; then continue; fi
  echo "  Issuing certificate for $domain..."
  docker compose run --rm --entrypoint certbot certbot certonly \
    --webroot -w /var/www/certbot \
    --email "$LE_EMAIL" \
    --agree-tos --no-eff-email \
    -d "$domain"
done

echo "==> Reloading nginx with SSL..."
docker compose exec nginx nginx -s reload

echo "==> Starting certbot auto-renew..."
docker compose up -d certbot

echo "==> Reloading nginx with SSL..."
docker compose exec nginx nginx -s reload

echo ""
echo "✅ Stack is up!"
echo "   Main:     https://$DOMAIN"
echo "   Wiki:     https://wiki.$DOMAIN"
echo "   Auth:     https://auth.$DOMAIN"
echo "   ATO:      https://ato.$DOMAIN"
echo "   ASACS:    https://asacs.$DOMAIN"
echo ""
echo "Next steps:"
echo "  1. Visit https://wiki.$DOMAIN to run MediaWiki web installer"
echo "  2. Upload LocalSettings.php to ./mediawiki/LocalSettings.php"
echo "  3. Uncomment the LocalSettings volume in docker-compose.yml"
echo "  4. docker compose restart mediawiki"
