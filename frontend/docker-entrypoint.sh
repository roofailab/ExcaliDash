#!/bin/sh
# Alpine-based image uses /bin/sh (busybox ash), not bash
set -e

# Set default backend URL if not provided (host:port format, no protocol)
export BACKEND_URL="${BACKEND_URL:-backend:8000}"

# Read the DNS resolver from /etc/resolv.conf so nginx uses the correct nameserver.
# IPv6 addresses need brackets in nginx resolver directive: [fd00::1]
RESOLVER_RAW=$(grep '^nameserver' /etc/resolv.conf | awk '{print $2}' | head -1)
if [ -z "$RESOLVER_RAW" ]; then
    echo "WARNING: Could not detect DNS resolver from /etc/resolv.conf, falling back to 8.8.8.8"
    RESOLVER="8.8.8.8"
elif echo "$RESOLVER_RAW" | grep -q ':'; then
    RESOLVER="[${RESOLVER_RAW}]"
else
    RESOLVER="$RESOLVER_RAW"
fi

echo "Configuring nginx with BACKEND_URL: ${BACKEND_URL}, resolver: ${RESOLVER}"

# Replace only our custom placeholders and preserve nginx runtime vars like $http_upgrade
ESCAPED_BACKEND_URL=$(printf '%s\n' "$BACKEND_URL" | sed 's/[\/&]/\\&/g')
sed \
    -e "s/__BACKEND_URL__/${ESCAPED_BACKEND_URL}/g" \
    -e "s/__RESOLVER__/${RESOLVER}/g" \
    /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

# Validate the generated nginx configuration before starting
echo "Validating nginx configuration..."
if ! nginx -t -c /etc/nginx/nginx.conf; then
    echo "ERROR: nginx configuration validation failed" >&2
    exit 1
fi

# Execute the main command (nginx)
exec "$@"
