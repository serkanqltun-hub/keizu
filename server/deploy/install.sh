#!/usr/bin/env bash
# Keizu Server installer for Ubuntu/Debian (Hetzner Cloud or any Linux box).
#
#   curl -fsSL https://raw.githubusercontent.com/serkanqltun-hub/keizu/main/server/deploy/install.sh | sudo bash
#
# It installs Docker if needed, asks for your domain, and starts Keizu Server
# in /opt/keizu. If ports 80/443 are free it also starts Caddy for automatic
# HTTPS; if something (nginx…) already uses them, Keizu listens on
# 127.0.0.1:8787 only and the script prints (or adds) an nginx site for it.
#
# Options (all optional; the script asks for what it needs):
#   --domain notlar.example.com   address the server will be reached at
#   --email you@example.com       for Let's Encrypt notices (Caddy mode)
#   --mode auto|caddy|proxy       auto: caddy if ports 80/443 are free
#   --port 8787                   local port Keizu listens on
#   --dir /opt/keizu              install folder
#   --build                       build the image from source instead of pulling
#   --ref main                    git branch/tag for files and --build
#   --yes                         don't ask; use defaults
set -euo pipefail

REPO="serkanqltun-hub/keizu"
REF="${KEIZU_REF:-main}"
DIR="/opt/keizu"
DOMAIN=""
EMAIL=""
MODE="auto"
PORT="8787"
BUILD=0
YES=0

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift ;;
    --email) EMAIL="$2"; shift ;;
    --mode) MODE="$2"; shift ;;
    --port) PORT="$2"; shift ;;
    --dir) DIR="$2"; shift ;;
    --ref) REF="$2"; shift ;;
    --build) BUILD=1 ;;
    --yes|-y) YES=1 ;;
    *) echo "Bilinmeyen seçenek: $1" >&2; exit 1 ;;
  esac
  shift
done

RAW="https://raw.githubusercontent.com/$REPO/$REF/server/deploy"
bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
die() { printf '\033[31mHata: %s\033[0m\n' "$*" >&2; exit 1; }

# Read answers from the terminal even when the script itself comes from a pipe.
ask() {
  local prompt="$1" default="${2:-}" answer=""
  if [ "$YES" = 1 ] || [ ! -r /dev/tty ]; then echo "$default"; return; fi
  if [ -n "$default" ]; then printf '%s [%s]: ' "$prompt" "$default" > /dev/tty; else printf '%s: ' "$prompt" > /dev/tty; fi
  read -r answer < /dev/tty || true
  echo "${answer:-$default}"
}
yes_no() { # yes_no "question" default(e/h)
  local a; a="$(ask "$1 (e/h)" "$2")"
  case "$a" in e|E|evet|y|Y|yes) return 0 ;; *) return 1 ;; esac
}

[ "$(id -u)" = 0 ] || die "Root olarak çalıştır: ... | sudo bash"
[ "$(uname -s)" = Linux ] || die "Bu betik Linux içindir."

bold "Keizu Server kurulumu"

# ---------- Docker ----------
if ! command -v docker >/dev/null 2>&1; then
  info "Docker kuruluyor (get.docker.com)…"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || die "Docker Compose eklentisi yok. 'apt install docker-compose-plugin' ile kur."
systemctl enable --now docker >/dev/null 2>&1 || true

# ---------- Domain ----------
EXISTING_ENV="$DIR/.env"
if [ -z "$DOMAIN" ] && [ -f "$EXISTING_ENV" ]; then
  DOMAIN="$(grep -E '^KEIZU_DOMAIN=' "$EXISTING_ENV" | cut -d= -f2- || true)"
fi
while [ -z "$DOMAIN" ]; do
  DOMAIN="$(ask "Sunucunun alan adı (ör. notlar.alanadin.com)")"
  [ -n "$DOMAIN" ] || [ "$YES" = 0 ] || die "--domain gerekli."
done
DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%%/*}"

PUBLIC_IP="$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || true)"
DNS_IP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)"
if [ -n "$PUBLIC_IP" ] && [ "$DNS_IP" != "$PUBLIC_IP" ]; then
  warn "$DOMAIN şu an ${DNS_IP:-hiçbir adrese} çözülüyor, bu sunucu ise $PUBLIC_IP."
  warn "DNS'te $DOMAIN için A kaydını $PUBLIC_IP yap. Kayıt yayılana kadar HTTPS sertifikası alınamaz."
  yes_no "Yine de devam edilsin mi?" e || exit 1
fi

# ---------- Mode ----------
ports_busy() {
  ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq '(^|:)(80|443)$'
}
caddy_running_here() { [ -f "$DIR/.env" ] && grep -q '^COMPOSE_PROFILES=caddy' "$DIR/.env" && docker compose --project-directory "$DIR" ps caddy 2>/dev/null | grep -q caddy; }
if [ "$MODE" = auto ]; then
  if ports_busy && ! caddy_running_here; then
    MODE=proxy
    info "80/443 portları başka bir servis tarafından kullanılıyor (muhtemelen nginx)."
    info "Keizu yalnız 127.0.0.1:$PORT üzerinde dinleyecek; mevcut ters vekil onu yayınlayacak."
  else
    MODE=caddy
    info "80/443 boş: Caddy ile otomatik HTTPS kurulacak."
  fi
fi
if [ "$MODE" = caddy ] && [ -z "$EMAIL" ]; then
  EMAIL="$(ask "Let's Encrypt bildirimleri için e-posta (boş bırakılabilir)" "")"
fi

# ---------- Files ----------
mkdir -p "$DIR/data"
chown 1000:1000 "$DIR/data"   # the container runs as user "node" (uid 1000)
curl -fsSL "$RAW/docker-compose.yml" -o "$DIR/docker-compose.yml"
curl -fsSL "$RAW/Caddyfile" -o "$DIR/Caddyfile"

IMAGE="ghcr.io/$REPO-server:latest"
if [ "$BUILD" = 0 ] && ! docker pull "$IMAGE" >/dev/null 2>&1; then
  warn "Hazır imaj indirilemedi ($IMAGE); kaynak koddan derlenecek."
  BUILD=1
fi
if [ "$BUILD" = 1 ]; then
  IMAGE="keizu-server:local"
  info "İmaj derleniyor (bir iki dakika sürebilir)…"
  docker build -t "$IMAGE" "https://github.com/$REPO.git#$REF:server"
fi

umask 077
cat > "$DIR/.env" <<EOF
# Keizu Server ayarları. Değiştirdikten sonra: keizu-server restart
KEIZU_DOMAIN=$DOMAIN
KEIZU_PUBLIC_URL=https://$DOMAIN
KEIZU_EMAIL=$EMAIL
KEIZU_PORT=$PORT
KEIZU_IMAGE=$IMAGE
KEIZU_BUILD_REF=$REF
# caddy: Caddy 80/443'te çalışır ve HTTPS'i kendisi alır. Boş: mevcut ters vekil kullanılır.
COMPOSE_PROFILES=$([ "$MODE" = caddy ] && echo caddy)
# Sınırlar (sunucu güvenliği için):
#   yeni kullanıcıların varsayılan kotası (MB, 0 = sınırsız)
KEIZU_DEFAULT_QUOTA_MB=2048
#   haritadaki tek bir görselin üst sınırı (MB) ve tek haritanın üst sınırı (MB)
KEIZU_MAX_IMAGE_MB=5
KEIZU_MAX_MAP_MB=50
#   sunucuda saklanan her şeyin toplamı (GB; haritalar, çöp kutusu, sürüm geçmişi)
KEIZU_TOTAL_LIMIT_GB=10
#   diskte bundan az boş yer kalırsa yeni kayıt kabul edilmez (GB)
KEIZU_MIN_FREE_GB=2
# Kaç günlük yedek saklansın (data/backups); her yedek veritabanı kadar yer kaplar
KEIZU_BACKUP_KEEP=3
EOF
umask 022

# ---------- Helper command ----------
cat > /usr/local/bin/keizu-server <<EOF
#!/bin/sh
# Keizu Server yönetimi. Örnekler:
#   keizu-server update            yeni sürüme geç
#   keizu-server logs              günlükleri izle
#   keizu-server pair <kullanıcı>  yeni cihaz için 6 haneli kod
#   keizu-server user add <ad>     kullanıcı ekle
cd "$DIR" || exit 1
case "\$1" in
  update)
    if grep -q '^KEIZU_IMAGE=keizu-server:local' .env; then
      ref=\$(grep '^KEIZU_BUILD_REF=' .env | cut -d= -f2-)
      docker build -t keizu-server:local "https://github.com/$REPO.git#\${ref:-main}:server" || exit 1
    else
      docker compose pull || exit 1
    fi
    docker compose up -d && docker image prune -f >/dev/null
    docker compose exec keizu keizu-server version ;;
  logs) docker compose logs -f --tail 100 keizu ;;
  status) docker compose ps ;;
  start) docker compose up -d ;;
  stop) docker compose stop ;;
  restart) docker compose up -d --force-recreate ;;
  ""|help|-h|--help)
    echo "keizu-server update | logs | status | start | stop | restart"
    docker compose exec keizu keizu-server help ;;
  *) docker compose exec keizu keizu-server "\$@" ;;
esac
EOF
chmod +x /usr/local/bin/keizu-server

# ---------- Start ----------
info "Başlatılıyor…"
docker compose --project-directory "$DIR" up -d
for i in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break
  sleep 1
  [ "$i" = 30 ] && die "Sunucu başlamadı. Günlükler: keizu-server logs"
done

# Open the firewall for Caddy if ufw is active (ufw is never turned on here).
if [ "$MODE" = caddy ] && command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
fi

# ---------- Reverse proxy (proxy mode) ----------
NGINX_DONE=0
if [ "$MODE" = proxy ]; then
  SITE="server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    client_max_body_size 50m;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_read_timeout 120s;
    }
}"
  if command -v nginx >/dev/null 2>&1 && yes_no "nginx bulundu. $DOMAIN için site yapılandırması eklensin mi?" e; then
    if [ -d /etc/nginx/sites-available ]; then
      CONF="/etc/nginx/sites-available/keizu-$DOMAIN.conf"
      echo "$SITE" > "$CONF"
      ln -sf "$CONF" "/etc/nginx/sites-enabled/keizu-$DOMAIN.conf"
      LINK="/etc/nginx/sites-enabled/keizu-$DOMAIN.conf"
    else
      CONF="/etc/nginx/conf.d/keizu-$DOMAIN.conf"
      echo "$SITE" > "$CONF"
      LINK=""
    fi
    if nginx -t >/dev/null 2>&1; then
      systemctl reload nginx
      NGINX_DONE=1
      info "nginx sitesi eklendi: $CONF"
      if command -v certbot >/dev/null 2>&1 && yes_no "certbot ile HTTPS sertifikası alınsın mı?" e; then
        certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos ${EMAIL:+-m "$EMAIL"} ${EMAIL:---register-unsafely-without-email} \
          || warn "certbot başarısız oldu. DNS kaydını kontrol edip 'certbot --nginx -d $DOMAIN' ile yeniden dene."
      else
        warn "HTTPS için: apt install certbot python3-certbot-nginx && certbot --nginx -d $DOMAIN"
      fi
    else
      rm -f "$CONF" ${LINK:+"$LINK"}
      warn "nginx yapılandırma testi başarısız oldu; değişiklik geri alındı. Aşağıdaki bloğu elle ekle."
    fi
  fi
  if [ "$NGINX_DONE" = 0 ]; then
    bold "Mevcut ters vekiline şu yönlendirmeyi ekle ($DOMAIN → 127.0.0.1:$PORT):"
    echo "$SITE"
    info "Caddy kullanıyorsan:  $DOMAIN { reverse_proxy 127.0.0.1:$PORT }"
  fi
fi

# ---------- Done ----------
echo
bold "Keizu Server çalışıyor: https://$DOMAIN"
FIRST="$(docker compose --project-directory "$DIR" logs --no-log-prefix keizu 2>/dev/null | sed -n '/=====/,/keizu-server invite --admin/p' || true)"
if [ -n "$FIRST" ]; then
  echo "$FIRST"
else
  info "Yönetici hesabı daha önce oluşturulmuş. Yeni davet: keizu-server invite · cihaz kodu: keizu-server pair <kullanıcı>"
fi
echo
info "Panel:        https://$DOMAIN  (davet oluştur, cihaz kodu üret, yedek indir)"
info "Uygulamada:   Ayarlar → Bulut senkronu → adres: $DOMAIN"
info "Güncelleme:   keizu-server update"
info "Rehber:       https://github.com/$REPO/blob/main/docs/server/hetzner.md"
