#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
usage: infra/gcp/provision.sh --project <id> --backup-project <id> --admin-ip <ip> [options]

Creates Bault's Google Cloud resources, or finds them if they exist, and writes
the values production needs to a local file (mode 600). Run it from your own
machine, logged in with `gcloud auth login`.

  --project <id>          the project for the server, the database and the images
  --backup-project <id>   a second project, for the backups bucket only
  --admin-ip <ip>         your public IP; SSH admits nobody else
  --region <region>       default us-east4
  --zone <zone>           default <region>-a
  --ssh-key <file>        a public key for the server's first login (user bault-admin)
  --out <file>            default ./bault-gcp.env
  --dry-run               print every command, run none
EOF
}

PROJECT=""
BACKUP_PROJECT=""
ADMIN_IP=""
REGION="us-east4"
ZONE=""
SSH_KEY=""
OUT="./bault-gcp.env"
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="${2:-}"; shift 2 ;;
    --backup-project) BACKUP_PROJECT="${2:-}"; shift 2 ;;
    --admin-ip) ADMIN_IP="${2:-}"; shift 2 ;;
    --region) REGION="${2:-}"; shift 2 ;;
    --zone) ZONE="${2:-}"; shift 2 ;;
    --ssh-key) SSH_KEY="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }

[ -n "$PROJECT" ] || die "--project is required"
[ -n "$BACKUP_PROJECT" ] || die "--backup-project is required"
[ "$PROJECT" != "$BACKUP_PROJECT" ] || die "the backups belong in a second project, so a key to one cannot delete the other"
[ -n "$ADMIN_IP" ] || die "--admin-ip is required"
[[ "$ADMIN_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}(/[0-9]{1,2})?$ ]] || die "--admin-ip '$ADMIN_IP' is not an IPv4 address or CIDR"
[[ "$ADMIN_IP" == */* ]] || ADMIN_IP="$ADMIN_IP/32"
ZONE="${ZONE:-${REGION}-a}"
if [ -n "$SSH_KEY" ]; then
  [ -s "$SSH_KEY" ] || die "no key in $SSH_KEY"
  grep -q '^ssh-' "$SSH_KEY" || grep -q '^ecdsa-' "$SSH_KEY" || die "$SSH_KEY is not a public key (it should start with ssh- or ecdsa-)"
fi

NAME=bault
NETWORK="${NAME}-net"
SUBNET="${NAME}-subnet"
SUBNET_RANGE="10.20.0.0/24"
PSA_RANGE="google-managed-services-${NETWORK}"
IP_NAME="${NAME}-ip"
VM="${NAME}-vm"
SQL="${NAME}-db"
DB=bault
TAG="$NAME"
VM_SA="${NAME}-vm@${PROJECT}.iam.gserviceaccount.com"
IMAGES_SA="${NAME}-images@${PROJECT}.iam.gserviceaccount.com"
BACKUPS_SA="${NAME}-backups@${BACKUP_PROJECT}.iam.gserviceaccount.com"
IMAGES_BUCKET="${PROJECT}-${NAME}-images"
BACKUPS_BUCKET="${BACKUP_PROJECT}-${NAME}-backups"
PUT_GET_ROLE="baultObjectPutGet"
case "$REGION" in
  us-*|northamerica-*) BACKUP_LOCATION=US ;;
  europe-*) BACKUP_LOCATION=EU ;;
  asia-*) BACKUP_LOCATION=ASIA ;;
  *) BACKUP_LOCATION="$REGION" ;;
esac

SECRETS=()
shown() {
  local out="$*" s
  for s in "${SECRETS[@]+"${SECRETS[@]}"}"; do
    [ -n "$s" ] && out="${out//"$s"/<secret>}"
  done
  printf '%s' "$out"
}

run() {
  printf '+ %s\n' "$(shown "$@")"
  [ "$DRY_RUN" -eq 1 ] && return 0
  "$@"
}

exists() {
  [ "$DRY_RUN" -eq 1 ] && return 1
  "$@" > /dev/null 2>&1
}

value() {
  [ "$DRY_RUN" -eq 1 ] && { printf '<%s>' "$1"; return 0; }
  shift
  "$@"
}

new_password() {
  openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-32
}

saved() {
  [ -r "$OUT" ] || return 0
  grep -E "^$1=" "$OUT" | tail -n 1 | cut -d= -f2- || true
}

command -v gcloud > /dev/null || die "gcloud is not installed: https://cloud.google.com/sdk/docs/install"
command -v openssl > /dev/null || die "openssl is not installed"
if [ "$DRY_RUN" -eq 0 ]; then
  account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -n 1)"
  [ -n "$account" ] || die "no active gcloud login: run gcloud auth login"
  echo "gcloud account: $account"
  gcloud projects describe "$PROJECT" > /dev/null || die "cannot read project $PROJECT"
  gcloud projects describe "$BACKUP_PROJECT" > /dev/null || die "cannot read project $BACKUP_PROJECT"
fi

step "1/9 APIs"
run gcloud services enable compute.googleapis.com sqladmin.googleapis.com servicenetworking.googleapis.com \
  storage.googleapis.com iam.googleapis.com cloudresourcemanager.googleapis.com --project="$PROJECT"
run gcloud services enable storage.googleapis.com iam.googleapis.com --project="$BACKUP_PROJECT"

step "2/9 network: ${NETWORK}, firewall, private access for Cloud SQL"
exists gcloud compute networks describe "$NETWORK" --project="$PROJECT" \
  || run gcloud compute networks create "$NETWORK" --project="$PROJECT" --subnet-mode=custom --mtu=1500
exists gcloud compute networks subnets describe "$SUBNET" --region="$REGION" --project="$PROJECT" \
  || run gcloud compute networks subnets create "$SUBNET" --project="$PROJECT" --network="$NETWORK" \
       --region="$REGION" --range="$SUBNET_RANGE" --enable-private-ip-google-access
exists gcloud compute firewall-rules describe "${NAME}-allow-web" --project="$PROJECT" \
  || run gcloud compute firewall-rules create "${NAME}-allow-web" --project="$PROJECT" --network="$NETWORK" \
       --direction=INGRESS --action=ALLOW --rules=tcp:80,tcp:443,udp:443 --source-ranges=0.0.0.0/0 \
       --target-tags="$TAG"
if exists gcloud compute firewall-rules describe "${NAME}-allow-ssh" --project="$PROJECT"; then
  run gcloud compute firewall-rules update "${NAME}-allow-ssh" --project="$PROJECT" --source-ranges="$ADMIN_IP"
else
  run gcloud compute firewall-rules create "${NAME}-allow-ssh" --project="$PROJECT" --network="$NETWORK" \
    --direction=INGRESS --action=ALLOW --rules=tcp:22 --source-ranges="$ADMIN_IP" --target-tags="$TAG"
fi
exists gcloud compute addresses describe "$PSA_RANGE" --global --project="$PROJECT" \
  || run gcloud compute addresses create "$PSA_RANGE" --project="$PROJECT" --global --purpose=VPC_PEERING \
       --prefix-length=20 --network="$NETWORK"
if [ "$DRY_RUN" -eq 1 ] || ! gcloud services vpc-peerings list --network="$NETWORK" --project="$PROJECT" \
     --format='value(peering)' 2>/dev/null | grep -q servicenetworking; then
  run gcloud services vpc-peerings connect --project="$PROJECT" --service=servicenetworking.googleapis.com \
    --ranges="$PSA_RANGE" --network="$NETWORK"
fi

step "3/9 service accounts"
exists gcloud iam service-accounts describe "$VM_SA" --project="$PROJECT" \
  || run gcloud iam service-accounts create "${NAME}-vm" --project="$PROJECT" \
       --display-name="Bault server: connects to Cloud SQL, nothing else"
exists gcloud iam service-accounts describe "$IMAGES_SA" --project="$PROJECT" \
  || run gcloud iam service-accounts create "${NAME}-images" --project="$PROJECT" \
       --display-name="Bault images: puts and gets objects in one bucket"
exists gcloud iam service-accounts describe "$BACKUPS_SA" --project="$BACKUP_PROJECT" \
  || run gcloud iam service-accounts create "${NAME}-backups" --project="$BACKUP_PROJECT" \
       --display-name="Bault backups: adds objects to one bucket, reads and deletes none"
run gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${VM_SA}" \
  --role=roles/cloudsql.client --condition=None --quiet --format=none
exists gcloud iam roles describe "$PUT_GET_ROLE" --project="$PROJECT" \
  || run gcloud iam roles create "$PUT_GET_ROLE" --project="$PROJECT" --title="Bault object put and get" \
       --permissions=storage.objects.create,storage.objects.get --stage=GA

step "4/9 buckets: ${IMAGES_BUCKET}, and ${BACKUPS_BUCKET} in ${BACKUP_PROJECT}"
exists gcloud storage buckets describe "gs://${IMAGES_BUCKET}" --project="$PROJECT" \
  || run gcloud storage buckets create "gs://${IMAGES_BUCKET}" --project="$PROJECT" --location="$REGION" \
       --default-storage-class=STANDARD --uniform-bucket-level-access --public-access-prevention
run gcloud storage buckets add-iam-policy-binding "gs://${IMAGES_BUCKET}" --member="serviceAccount:${IMAGES_SA}" \
  --role="projects/${PROJECT}/roles/${PUT_GET_ROLE}" --format=none
if ! exists gcloud storage buckets describe "gs://${BACKUPS_BUCKET}" --project="$BACKUP_PROJECT"; then
  run gcloud storage buckets create "gs://${BACKUPS_BUCKET}" --project="$BACKUP_PROJECT" --location="$BACKUP_LOCATION" \
    --default-storage-class=STANDARD --uniform-bucket-level-access --public-access-prevention --retention-period=30d
  lifecycle="$(mktemp)"
  printf '%s\n' '{"rule":[{"action":{"type":"Delete"},"condition":{"age":120}}]}' > "$lifecycle"
  run gcloud storage buckets update "gs://${BACKUPS_BUCKET}" --project="$BACKUP_PROJECT" --lifecycle-file="$lifecycle"
  rm -f "$lifecycle"
fi
run gcloud storage buckets add-iam-policy-binding "gs://${BACKUPS_BUCKET}" --member="serviceAccount:${BACKUPS_SA}" \
  --role=roles/storage.objectCreator --format=none

step "5/9 Cloud SQL for PostgreSQL 16: ${SQL} (private IP only, TLS required, point-in-time recovery 7 days)"
if ! exists gcloud sql instances describe "$SQL" --project="$PROJECT"; then
  run gcloud sql instances create "$SQL" --project="$PROJECT" --region="$REGION" \
    --database-version=POSTGRES_16 --edition=ENTERPRISE --tier=db-custom-1-3840 --availability-type=zonal \
    --storage-type=SSD --storage-size=20 --storage-auto-increase \
    --network="projects/${PROJECT}/global/networks/${NETWORK}" --no-assign-ip \
    --ssl-mode=ENCRYPTED_ONLY \
    --backup-start-time=03:00 --retained-backups-count=14 \
    --enable-point-in-time-recovery --retained-transaction-log-days=7 \
    --maintenance-window-day=SUN --maintenance-window-hour=7 \
    --deletion-protection
fi
exists gcloud sql databases describe "$DB" --instance="$SQL" --project="$PROJECT" \
  || run gcloud sql databases create "$DB" --instance="$SQL" --project="$PROJECT"

OWNER_PASSWORD="$(saved BAULT_OWNER_PASSWORD)"
APP_PASSWORD="$(saved BAULT_APP_PASSWORD)"
WORKER_PASSWORD="$(saved BAULT_WORKER_PASSWORD)"
[ -n "$APP_PASSWORD" ] || APP_PASSWORD="$(new_password)"
[ -n "$WORKER_PASSWORD" ] || WORKER_PASSWORD="$(new_password)"
owner_exists=0
if [ "$DRY_RUN" -eq 0 ] && gcloud sql users list --instance="$SQL" --project="$PROJECT" --format='value(name)' \
     | grep -qx bault_owner; then
  owner_exists=1
fi
if [ "$owner_exists" -eq 0 ]; then
  [ -n "$OWNER_PASSWORD" ] || OWNER_PASSWORD="$(new_password)"
  SECRETS+=("$OWNER_PASSWORD")
  run gcloud sql users create bault_owner --instance="$SQL" --project="$PROJECT" --password="$OWNER_PASSWORD"
elif [ -z "$OWNER_PASSWORD" ]; then
  OWNER_PASSWORD="$(new_password)"
  SECRETS+=("$OWNER_PASSWORD")
  echo "bault_owner exists but ${OUT} has no password for it: setting a new one"
  run gcloud sql users set-password bault_owner --instance="$SQL" --project="$PROJECT" --password="$OWNER_PASSWORD"
fi
SECRETS+=("$OWNER_PASSWORD" "$APP_PASSWORD" "$WORKER_PASSWORD")

step "6/9 static IP and the server: ${VM} (e2-medium, Ubuntu 24.04)"
exists gcloud compute addresses describe "$IP_NAME" --region="$REGION" --project="$PROJECT" \
  || run gcloud compute addresses create "$IP_NAME" --region="$REGION" --project="$PROJECT"
if ! exists gcloud compute instances describe "$VM" --zone="$ZONE" --project="$PROJECT"; then
  metadata=(--metadata=enable-oslogin=FALSE)
  keyfile=""
  if [ -n "$SSH_KEY" ]; then
    keyfile="$(mktemp)"
    printf 'bault-admin:%s\n' "$(head -n 1 "$SSH_KEY")" > "$keyfile"
    metadata+=(--metadata-from-file=ssh-keys="$keyfile")
  fi
  run gcloud compute instances create "$VM" --project="$PROJECT" --zone="$ZONE" \
    --machine-type=e2-medium --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
    --boot-disk-size=30GB --boot-disk-type=pd-balanced \
    --network="$NETWORK" --subnet="$SUBNET" --address="$IP_NAME" --tags="$TAG" \
    --service-account="$VM_SA" --scopes=cloud-platform \
    --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
    --deletion-protection "${metadata[@]}"
  [ -z "$keyfile" ] || rm -f "$keyfile"
fi

step "7/9 HMAC keys for the two buckets"
IMAGES_KEY="$(saved STORAGE_ACCESS_KEY)"
IMAGES_SECRET="$(saved STORAGE_SECRET_KEY)"
if [ -z "$IMAGES_KEY" ] || [ -z "$IMAGES_SECRET" ]; then
  echo "+ gcloud storage hmac create ${IMAGES_SA} --project=${PROJECT}"
  if [ "$DRY_RUN" -eq 0 ]; then
    pair="$(gcloud storage hmac create "$IMAGES_SA" --project="$PROJECT" --format='value(metadata.accessId,secret)')"
    IMAGES_KEY="$(printf '%s' "$pair" | cut -f1)"
    IMAGES_SECRET="$(printf '%s' "$pair" | cut -f2)"
  fi
fi
BACKUPS_KEY="$(saved RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID)"
BACKUPS_SECRET="$(saved RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY)"
if [ -z "$BACKUPS_KEY" ] || [ -z "$BACKUPS_SECRET" ]; then
  echo "+ gcloud storage hmac create ${BACKUPS_SA} --project=${BACKUP_PROJECT}"
  if [ "$DRY_RUN" -eq 0 ]; then
    pair="$(gcloud storage hmac create "$BACKUPS_SA" --project="$BACKUP_PROJECT" --format='value(metadata.accessId,secret)')"
    BACKUPS_KEY="$(printf '%s' "$pair" | cut -f1)"
    BACKUPS_SECRET="$(printf '%s' "$pair" | cut -f2)"
  fi
fi

step "8/9 read back what was created"
STATIC_IP="$(value static-ip gcloud compute addresses describe "$IP_NAME" --region="$REGION" --project="$PROJECT" --format='value(address)')"
CONNECTION="$(value connection-name gcloud sql instances describe "$SQL" --project="$PROJECT" --format='value(connectionName)')"
PRIVATE_IP="$(value private-ip gcloud sql instances describe "$SQL" --project="$PROJECT" --format='value(ipAddresses[0].ipAddress)')"

step "9/9 ${OUT}"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "+ write ${OUT} (mode 600): the settings for production.env, migrate.env, api.env, worker.env and backup.env"
  exit 0
fi
owner_host="postgres://bault_owner:${OWNER_PASSWORD}@127.0.0.1:5432/${DB}"
umask 077
tmp="$(mktemp "${OUT}.XXXXXX")"
cat > "$tmp" <<EOF
GCP_PROJECT=${PROJECT}
GCP_BACKUP_PROJECT=${BACKUP_PROJECT}
GCP_REGION=${REGION}
GCP_ZONE=${ZONE}
GCP_VM=${VM}
STATIC_IP=${STATIC_IP}
CLOUDSQL_PRIVATE_IP=${PRIVATE_IP}
BAULT_OWNER_PASSWORD=${OWNER_PASSWORD}
BAULT_APP_PASSWORD=${APP_PASSWORD}
BAULT_WORKER_PASSWORD=${WORKER_PASSWORD}

# /etc/bault/production.env
BAULT_COMPOSE_EXTRA=infra/gcp/compose.gcp.yml
BAULT_DB_SIDECAR=cloudsql
CLOUDSQL_INSTANCE=${CONNECTION}
STORAGE_PROVIDER=s3
STORAGE_ENDPOINT=https://storage.googleapis.com
STORAGE_REGION=auto
STORAGE_BUCKET=${IMAGES_BUCKET}
STORAGE_ACCESS_KEY=${IMAGES_KEY}
STORAGE_SECRET_KEY=${IMAGES_SECRET}

# /etc/bault/migrate.env
DATABASE_URL=postgres://bault_owner:${OWNER_PASSWORD}@cloudsql:5432/${DB}
DIRECT_DATABASE_URL=postgres://bault_owner:${OWNER_PASSWORD}@cloudsql:5432/${DB}
HOST_DIRECT_DATABASE_URL=${owner_host}

# /etc/bault/api.env
DATABASE_URL=postgres://bault_app:${APP_PASSWORD}@cloudsql:5432/${DB}
DIRECT_DATABASE_URL=postgres://bault_app:${APP_PASSWORD}@cloudsql:5432/${DB}

# /etc/bault/worker.env
DATABASE_URL=postgres://bault_worker:${WORKER_PASSWORD}@cloudsql:5432/${DB}
DIRECT_DATABASE_URL=postgres://bault_worker:${WORKER_PASSWORD}@cloudsql:5432/${DB}

# /etc/bault/backup.env
DIRECT_DATABASE_URL='${owner_host}'
BACKUP_DIR=/var/backups/bault
BACKUP_RETAIN_DAYS=14
BACKUP_AGE_RECIPIENT=CHANGE_ME_your_age_public_key
BACKUP_UPLOAD=rclone:backup:${BACKUPS_BUCKET}/nightly
RCLONE_CONFIG_BACKUP_TYPE=s3
RCLONE_CONFIG_BACKUP_PROVIDER=Other
RCLONE_CONFIG_BACKUP_ENDPOINT=https://storage.googleapis.com
RCLONE_CONFIG_BACKUP_REGION=auto
RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID=${BACKUPS_KEY}
RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY=${BACKUPS_SECRET}
EOF
chmod 600 "$tmp"
mv "$tmp" "$OUT"

cat <<EOF

Done. ${OUT} (mode 600) holds the passwords and keys: keep it off shared disks,
copy each section into the matching file under /etc/bault on the server, then
delete it or move it into your password manager.

Server: ${STATIC_IP}
  ssh bault-admin@${STATIC_IP}    (with --ssh-key; otherwise gcloud compute ssh ${VM} --zone=${ZONE})
Next: infra/gcp/README.md, step 3.
EOF
