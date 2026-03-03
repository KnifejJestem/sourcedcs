#!/bin/sh
if [ ! -f /conf/app.conf ]; then
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
fi

/server