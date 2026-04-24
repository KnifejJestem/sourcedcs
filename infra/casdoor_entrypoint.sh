#!/bin/sh
set -e

echo "Starting Casdoor Entrypoint..."

# Create directory if it doesn't exist
mkdir -p /conf

# Generate the config
echo "Generating /conf/app.conf..."
cat > /conf/app.conf <<EOF
appname = casdoor
httpport = 8000
runmode = prod
SessionOn = true
copyrequestbody = true
driverName = mysql
dataSourceName = ${CASDOOR_DB_USER}:${CASDOOR_DB_PASSWORD}@tcp(mariadb:3306)/casdoor
showSql = false
logPostOnly = true
origin = https://${AUTH_DOMAIN}
staticBaseUrl = https://cdn.casbin.org
EOF

# Also try putting it in /app/conf/app.conf or ./conf/app.conf
# Casdoor often looks for it relative to the binary
mkdir -p /conf
cp /conf/app.conf /app.conf

echo "Starting Casdoor server..."
exec /server