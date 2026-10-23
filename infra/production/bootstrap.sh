#!/usr/bin/env bash
set -euo pipefail

ADMIN_IP="${1:-}"
KEY_FILE="${2:-}"
PG_MAJOR="${PG_MAJOR:-16}"
RCLONE_VERSION="${RCLONE_VERSION:-1.60.1+dfsg-*}"
DEPLOY_USER=deploy

die() { echo "error: $*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo $0 …)"
[ -n "$ADMIN_IP" ] || die "usage: $0 <ADMIN_IP> [<ssh-public-key-file>]"
[[ "$ADMIN_IP" =~ ^[0-9A-Fa-f:.]+(/[0-9]{1,3})?$ ]] || die "ADMIN_IP '$ADMIN_IP' is not an IP address or CIDR"
# shellcheck disable=SC1091
. /etc/os-release
[ "${ID:-}" = ubuntu ] || die "this script is written for Ubuntu (found ${ID:-unknown})"

export DEBIAN_FRONTEND=noninteractive

step "packages: Docker, ufw, age, rclone, PostgreSQL ${PG_MAJOR} client"
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg git ufw

install -m 0755 -d /etc/apt/keyrings
if [ ! -s /etc/apt/keyrings/docker.asc ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

if ! apt-cache show "postgresql-client-${PG_MAJOR}" >/dev/null 2>&1; then
  if [ ! -s /etc/apt/keyrings/postgresql.asc ]; then
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /etc/apt/keyrings/postgresql.asc
    chmod a+r /etc/apt/keyrings/postgresql.asc
  fi
  echo "deb [signed-by=/etc/apt/keyrings/postgresql.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
fi

apt-get update -q
apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
  "postgresql-client-${PG_MAJOR}" age "rclone=${RCLONE_VERSION}"
systemctl enable --now docker

step "user ${DEPLOY_USER} and directories"
id -u "$DEPLOY_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"

install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /etc/bault /var/backups/bault /var/log/bault
install -d -m 0755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /opt/bault
chmod 0700 /etc/bault /var/backups/bault /var/log/bault
chown "$DEPLOY_USER:$DEPLOY_USER" /etc/bault /var/backups/bault /var/log/bault
find /etc/bault -maxdepth 1 -type f -name '*.env' -exec chmod 0600 {} + -exec chown "$DEPLOY_USER:$DEPLOY_USER" {} +
[ ! -f /etc/bault/db-ca.crt ] || chmod 0644 /etc/bault/db-ca.crt

home="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$home/.ssh"
keys="$home/.ssh/authorized_keys"
touch "$keys"
if [ -z "$KEY_FILE" ]; then
  for candidate in "$(getent passwd "${SUDO_USER:-root}" | cut -d: -f6)/.ssh/authorized_keys" /root/.ssh/authorized_keys; do
    if [ -s "$candidate" ]; then KEY_FILE="$candidate"; break; fi
  done
fi
if [ -n "$KEY_FILE" ]; then
  [ -s "$KEY_FILE" ] || die "no key in $KEY_FILE"
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    grep -qxF "$key" "$keys" || printf '%s\n' "$key" >> "$keys"
  done < "$KEY_FILE"
fi
chown "$DEPLOY_USER:$DEPLOY_USER" "$keys"
chmod 0600 "$keys"

step "firewall: 80, 443 open; 22 from ${ADMIN_IP} only"
ufw default deny incoming
ufw default allow outgoing
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw allow from "$ADMIN_IP" to any port 22 proto tcp
for n in $(ufw status numbered | awk -v ip="$ADMIN_IP" '
    match($0, /^\[ *[0-9]+\]/) {
      num = substr($0, 2, RLENGTH - 2); gsub(/ /, "", num)
      nf = split(substr($0, RLENGTH + 1), f, " ")
      if ((f[1] == "22" || f[1] == "22/tcp" || f[1] == "OpenSSH") && f[nf] != ip) print num
    }' | sort -rn); do
  ufw --force delete "$n"
done
ufw --force enable
ufw status verbose

step "SSH: keys only"
if [ ! -s "$keys" ] && [ ! -s /root/.ssh/authorized_keys ]; then
  die "no SSH key is installed for ${DEPLOY_USER} or root; refusing to disable password login (pass a key file)"
fi
cat > /etc/ssh/sshd_config.d/00-bault.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
EOF
sshd -t
systemctl reload ssh 2>/dev/null || systemctl restart ssh

step "done"
cat <<EOF
Next, as ${DEPLOY_USER} (from ${ADMIN_IP}):
  git clone <repository> /opt/bault && git -C /opt/bault checkout <tag>
  fill in /etc/bault/{production,api,worker,migrate}.env and db-ca.crt
  cd /opt/bault && ./infra/production/deploy.sh <tag>
See infra/production/README.md.
EOF
