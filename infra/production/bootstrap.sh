#!/usr/bin/env bash
# =============================================================================
# Turn a clean Ubuntu server (24.04 LTS) into a Bault host.
#
#   sudo ./bootstrap.sh <ADMIN_IP> [<ssh-public-key-file>]
#
#   ADMIN_IP   the one address allowed to reach SSH (yours, or your VPN's).
#              Everything else gets 80 and 443 and nothing more.
#   key file   installed for the `deploy` user. Defaults to the keys already
#              authorised for the user running sudo, then for root.
#
# Safe to run again: every step checks before it changes anything, and running
# it with a new ADMIN_IP moves SSH access to that address.
#
# What it does:
#   - installs Docker Engine + the compose plugin (Docker's own apt repository),
#     ufw, age, rclone, and the PostgreSQL client that infra/ops/backup.sh and
#     roles.sql run on the host (PG_MAJOR, default 16 — match the database
#     server's major version)
#   - creates the `deploy` user (member of `docker`) and the directories
#       /opt/bault           the checkout deploy.sh runs from, and CURRENT_TAG
#       /etc/bault           the env files and db-ca.crt       (mode 700)
#       /var/backups/bault   database dumps                    (mode 700)
#       /var/log/bault       the nightly backup's log          (mode 700)
#   - firewall: deny all incoming, allow 80/tcp, 443/tcp, 443/udp, and 22/tcp
#     from ADMIN_IP only
#   - SSH: keys only, no passwords, root by key only
#
# Membership of `docker` is root on this machine in all but name (it can start
# a privileged container). That is why only `deploy` has it, and why SSH is
# limited to one address.
# =============================================================================
set -euo pipefail

ADMIN_IP="${1:-}"
KEY_FILE="${2:-}"
PG_MAJOR="${PG_MAJOR:-16}"
# Ubuntu 24.04's rclone. The upstream version is pinned; the distribution's
# security updates to it still apply. Another release names its own.
RCLONE_VERSION="${RCLONE_VERSION:-1.60.1+dfsg-*}"
DEPLOY_USER=deploy

die() { echo "error: $*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo $0 …)"
[ -n "$ADMIN_IP" ] || die "usage: $0 <ADMIN_IP> [<ssh-public-key-file>]"
# An address or a CIDR, v4 or v6. Anything else would make ufw fail half-way.
[[ "$ADMIN_IP" =~ ^[0-9A-Fa-f:.]+(/[0-9]{1,3})?$ ]] || die "ADMIN_IP '$ADMIN_IP' is not an IP address or CIDR"
# shellcheck disable=SC1091
. /etc/os-release
[ "${ID:-}" = ubuntu ] || die "this script is written for Ubuntu (found ${ID:-unknown})"

export DEBIAN_FRONTEND=noninteractive

# -----------------------------------------------------------------------------
step "packages: Docker, ufw, age, rclone, PostgreSQL ${PG_MAJOR} client"
# -----------------------------------------------------------------------------
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg git ufw

install -m 0755 -d /etc/apt/keyrings
if [ ! -s /etc/apt/keyrings/docker.asc ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

# Ubuntu's own archive carries one PostgreSQL major per release. Any other
# major comes from the PostgreSQL project's repository.
if ! apt-cache show "postgresql-client-${PG_MAJOR}" >/dev/null 2>&1; then
  if [ ! -s /etc/apt/keyrings/postgresql.asc ]; then
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /etc/apt/keyrings/postgresql.asc
    chmod a+r /etc/apt/keyrings/postgresql.asc
  fi
  echo "deb [signed-by=/etc/apt/keyrings/postgresql.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
fi

apt-get update -q
# age: infra/ops/backup.sh encrypts dumps with it when given a recipient.
# rclone: backup.sh uploads with it (BACKUP_UPLOAD=rclone:…). Without it a
# configured upload fails the whole nightly backup before the dump starts. The
# aws cli that `s3://` uses is not in Ubuntu 24.04's archive, so the documented
# set-up is rclone (infra/ops/crontab.example).
apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
  "postgresql-client-${PG_MAJOR}" age "rclone=${RCLONE_VERSION}"
systemctl enable --now docker

# -----------------------------------------------------------------------------
step "user ${DEPLOY_USER} and directories"
# -----------------------------------------------------------------------------
id -u "$DEPLOY_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"

install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /etc/bault /var/backups/bault /var/log/bault
install -d -m 0755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /opt/bault
# `install -d` leaves an existing directory's mode alone; make sure.
chmod 0700 /etc/bault /var/backups/bault /var/log/bault
chown "$DEPLOY_USER:$DEPLOY_USER" /etc/bault /var/backups/bault /var/log/bault
# The env files hold every credential: owner only. The database CA is public,
# and is read inside the containers by uid 10001, so it must be world-readable
# (the 700 directory still keeps other host users out).
find /etc/bault -maxdepth 1 -type f -name '*.env' -exec chmod 0600 {} + -exec chown "$DEPLOY_USER:$DEPLOY_USER" {} +
[ ! -f /etc/bault/db-ca.crt ] || chmod 0644 /etc/bault/db-ca.crt

# The deploy user's SSH key: the file given, else whoever ran sudo, else root.
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

# -----------------------------------------------------------------------------
step "firewall: 80, 443 open; 22 from ${ADMIN_IP} only"
# -----------------------------------------------------------------------------
# SSH from one address is also why .github/workflows/deploy.yml cannot run from
# a GitHub-hosted runner: deploy by hand from ADMIN_IP (README, section 5).
# Docker publishes ports with its own iptables rules, which ufw never sees.
# Only Caddy publishes anything (compose.yml), and only 80 and 443; a port
# published by anything else is open to the internet whatever ufw says.
ufw default deny incoming
ufw default allow outgoing
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw allow from "$ADMIN_IP" to any port 22 proto tcp
# Remove every other rule that opens SSH: an `OpenSSH` or `22` from anywhere,
# or the address an earlier run allowed. Highest number first, so deleting one
# does not renumber the rest.
# A line reads `[ 3] 22/tcp   ALLOW IN   203.0.113.5` (or `… (v6) … Anywhere
# (v6)`): the target is the first field after the number, the source the last.
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

# -----------------------------------------------------------------------------
step "SSH: keys only"
# -----------------------------------------------------------------------------
# Refuse to lock the door before somebody has a key to it.
if [ ! -s "$keys" ] && [ ! -s /root/.ssh/authorized_keys ]; then
  die "no SSH key is installed for ${DEPLOY_USER} or root; refusing to disable password login (pass a key file)"
fi
# sshd keeps the FIRST value it reads for each option, and reads
# sshd_config.d/*.conf in name order before sshd_config itself. Cloud images
# ship 50-cloud-init.conf with PasswordAuthentication yes; 00- comes first.
cat > /etc/ssh/sshd_config.d/00-bault.conf <<'EOF'
# Written by infra/production/bootstrap.sh
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
