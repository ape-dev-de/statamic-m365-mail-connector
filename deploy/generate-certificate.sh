#!/usr/bin/env bash
#
# Generate a self-signed signing certificate for the M365 connector app registration.
# Runs entirely on your own infra; the private key never leaves it.
#
# Usage: ./generate-certificate.sh [name] [days]
#   name  base filename (default: ape-dev-m365-<YYYYMMDD>)
#   days  validity in days (default: 3650 = ~10 years)
#
# Outputs:
#   <name>.key  private key            (SECRET — store in your secret manager)
#   <name>.crt  public certificate     (paste into Terraform var "certificates")
#   <name>.pem  key + cert combined    (SECRET — mount into the container, M365_CERTIFICATE_PATH)
#
set -euo pipefail

NAME="${1:-ape-dev-m365-$(date +%Y%m%d)}"
DAYS="${2:-3650}"

openssl req -x509 -newkey rsa:2048 -sha256 -nodes \
  -keyout "${NAME}.key" -out "${NAME}.crt" \
  -days "${DAYS}" -subj "/CN=${NAME}"

cat "${NAME}.key" "${NAME}.crt" > "${NAME}.pem"
chmod 600 "${NAME}.key" "${NAME}.pem"

echo
echo "Public certificate -> Terraform var 'certificates' (paste this block):"
echo "------------------------------------------------------------------"
cat "${NAME}.crt"
echo "------------------------------------------------------------------"
echo
echo "Private key (${NAME}.pem / ${NAME}.key): deploy ONLY to the RELAY's secret store."
echo "Never put it on customer sites — they authenticate to the relay with a per-tenant token."
