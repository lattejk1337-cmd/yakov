#!/usr/bin/env bash
# Tonum Wallet — test run on your own Mac (no server or domain needed).
#   bash deploy/mac-test.sh
# Starts PostgreSQL and the app in Docker Desktop and opens a free public HTTPS tunnel, so
# Telegram can open the Mini App from your phone. Tunnels are tried in order until one works:
# Cloudflare (needs port 7844, often blocked), then localhost.run and Pinggy over SSH, which is
# built into macOS. The address changes from run to run; the bot picks up the new one itself.
# Testing only: a tunnel provider can see the traffic, so never use it with real money.
# Keep the Terminal window open while testing; press Ctrl+C to stop.
set -euo pipefail

cd "$(dirname "$0")/.."

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

COMPOSE=(docker compose -f docker-compose.yml -f deploy/docker-compose.local.yml)

get_env() { [ -f .env ] && grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }

ask() { # ask "Вопрос" regex [secret]
  local prompt="$1" re="$2" secret="${3:-}" value
  while true; do
    if [ -n "$secret" ]; then
      read -r -s -p "$prompt: " value </dev/tty; echo >&2
    else
      read -r -p "$prompt: " value </dev/tty
    fi
    value="$(printf '%s' "$value" | tr -d '[:space:]')"
    if [[ "$value" =~ $re ]]; then printf '%s' "$value"; return; fi
    warn "Похоже, значение введено неверно. Попробуйте ещё раз."
  done
}

bold "1/4  Docker"
command -v docker >/dev/null 2>&1 ||
  die "Docker не найден. Установите Docker Desktop (https://www.docker.com/products/docker-desktop/), откройте его и запустите скрипт снова."
docker info >/dev/null 2>&1 ||
  die "Docker Desktop не запущен. Откройте его, подождите ~30 секунд и запустите скрипт снова."
ok "Docker работает"

bold "2/4  Ключи"
bot_token="$(get_env BOT_TOKEN)"
cp_token="$(get_env CRYPTOPAY_TOKEN)"
if [ -z "$bot_token" ] || [ -z "$cp_token" ]; then
  echo "Ключи вводятся скрыто — при вставке символы не отображаются, это нормально."
fi
[ -n "$bot_token" ] || bot_token="$(ask "Ключ бота от @BotFather" '^[0-9]+:[A-Za-z0-9_-]{30,}$' secret)"
[ -n "$cp_token" ] || cp_token="$(ask "Ключ Crypto Pay из @CryptoTestnetBot" '^[0-9]+:[A-Za-z0-9_-]+$' secret)"
network="$(get_env CRYPTOPAY_NETWORK)"; [ -n "$network" ] || network=testnet
pg_pass="$(get_env POSTGRES_PASSWORD)"
if [ -z "$pg_pass" ]; then
  pg_pass="$(openssl rand -hex 24)"
  # A test database left from an earlier run has a password we no longer know: start clean.
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
fi
ok "Ключи на месте (сохраняются в файле .env — повторно вводить не нужно)"

bold "3/4  Туннель в интернет"
mkdir -p .bin
cf="$(command -v cloudflared || true)"
if [ -z "$cf" ]; then
  cf=.bin/cloudflared
  if [ ! -x "$cf" ]; then
    case "$(uname -m)" in arm64 | aarch64) arch=arm64 ;; *) arch=amd64 ;; esac
    base=https://github.com/cloudflare/cloudflared/releases/latest/download
    echo "Скачиваем cloudflared (~20 МБ, один раз)…"
    if [ "$(uname -s)" = Darwin ]; then
      { curl -fL --progress-bar -o .bin/cloudflared.tgz "$base/cloudflared-darwin-$arch.tgz" &&
        tar -xzf .bin/cloudflared.tgz -C .bin && rm -f .bin/cloudflared.tgz; } || true
    else
      curl -fL --progress-bar -o "$cf" "$base/cloudflared-linux-$arch" || true
    fi
    [ -f "$cf" ] && chmod +x "$cf" || warn "cloudflared скачать не удалось — попробуем другие туннели."
  fi
fi

# The free SSH tunnels accept any key (or an empty password). Use a throwaway key that lives
# only in this folder, and answer a password prompt with an empty line instead of blocking.
[ -f .bin/tunnel_key ] || ssh-keygen -q -t ed25519 -N "" -C tonum-wallet-tunnel -f .bin/tunnel_key >/dev/null 2>&1 || true
printf '#!/bin/sh\necho\n' >.bin/askpass && chmod +x .bin/askpass
SSH_OPTS=(-n -o NumberOfPasswordPrompts=1
  -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=.bin/known_hosts
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ConnectTimeout=15 -o ExitOnForwardFailure=yes)
[ -f .bin/tunnel_key ] && SSH_OPTS+=(-i .bin/tunnel_key -o IdentitiesOnly=yes)
tunnel_ssh() { SSH_ASKPASS="$PWD/.bin/askpass" SSH_ASKPASS_REQUIRE=force ssh "${SSH_OPTS[@]}" "$@"; }

tunnel_pid=""
provider=""
url=""

cleanup() {
  local code="${1:-0}"
  trap - INT TERM HUP EXIT
  echo
  echo "Останавливаем…"
  [ -n "$tunnel_pid" ] && kill "$tunnel_pid" 2>/dev/null || true
  "${COMPOSE[@]}" stop >/dev/null 2>&1 || true
  echo "Остановлено. Запустить снова: bash deploy/mac-test.sh"
  exit "$code"
}
trap 'cleanup 0' INT TERM HUP
trap 'cleanup $?' EXIT

# Latest public address printed by the running tunnel (some free tunnels rotate it).
url_from_log() {
  case "$provider" in
    cloudflare-*) grep -oE 'https://[-a-z0-9]+\.trycloudflare\.com' .tunnel.log | grep -v '//api\.' | tail -1 ;;
    localhostrun) grep 'tunneled with tls termination' .tunnel.log | grep -oE 'https://[-a-z0-9.]+' | tail -1 ;;
    pinggy) grep -oE 'https://[-a-z0-9.]+\.pinggy\.(link|online)' .tunnel.log | tail -1 ;;
  esac 2>/dev/null || true
}

launch() {
  case "$provider" in
    cloudflare-http2 | cloudflare-quic)
      [ -x "$cf" ] || return 1
      "$cf" tunnel --no-autoupdate --protocol "${provider#cloudflare-}" --url http://localhost:3000 ;;
    localhostrun) tunnel_ssh -R 80:localhost:3000 nokey@localhost.run ;;
    pinggy) tunnel_ssh -p 443 -R 0:localhost:3000 free@a.pinggy.io ;;
  esac
}

# Starts one tunnel and waits until it is really connected (Cloudflare hands out
# its address before the connection is up).
try_tunnel() {
  provider="$1"
  local timeout=25
  case "$provider" in cloudflare-*) timeout="${TUNNEL_TIMEOUT:-30}" ;; esac
  rm -f .tunnel.log
  launch >.tunnel.log 2>&1 &
  tunnel_pid=$!
  for _ in $(seq 1 "$timeout"); do
    url="$(url_from_log)"
    if [ -n "$url" ]; then
      case "$provider" in
        cloudflare-*) grep -q 'Registered tunnel connection' .tunnel.log && return 0 ;;
        *) return 0 ;;
      esac
    fi
    kill -0 "$tunnel_pid" 2>/dev/null || break
    sleep 1
  done
  kill "$tunnel_pid" 2>/dev/null || true
  wait "$tunnel_pid" 2>/dev/null || true
  tunnel_pid=""
  url=""
  return 1
}

PROVIDERS="cloudflare-http2 cloudflare-quic localhostrun pinggy"
name_of() {
  case "$1" in
    cloudflare-http2) echo "Cloudflare" ;; cloudflare-quic) echo "Cloudflare (QUIC)" ;;
    localhostrun) echo "localhost.run" ;; pinggy) echo "Pinggy" ;;
  esac
}

connect_any() {
  local last order p
  # Start with whatever worked last time.
  last="$(cat .bin/tunnel-provider 2>/dev/null || true)"
  order="$last"
  for p in $PROVIDERS; do [ "$p" = "$last" ] || order="$order $p"; done
  for p in $order; do
    echo "Пробуем туннель: $(name_of "$p")…"
    if try_tunnel "$p"; then
      echo "$p" >.bin/tunnel-provider
      ok "Подключено через $(name_of "$p")"
      return 0
    fi
    warn "$(name_of "$p") не подключился:"
    grep -v '^[[:space:]]*$' .tunnel.log 2>/dev/null | tail -2 | sed 's/^/      /' >&2 || true
  done
  return 1
}

connect_any || {
  die "Ни один туннель не подключился. Проверьте интернет; если включён VPN — попробуйте с ним и без него, затем запустите скрипт снова."
}
ok "Адрес: $url"

write_env() {
  umask 077
  cat >.env <<ENV
# Generated by deploy/mac-test.sh for testing on this computer.
NODE_ENV=production
TRUST_PROXY=true
LOG_LEVEL=info

POSTGRES_PASSWORD=$pg_pass

BOT_TOKEN=$bot_token
BOT_MODE=polling
PUBLIC_URL=$url
WEBAPP_URL=$url

PAYMENT_PROVIDER=cryptopay
CRYPTOPAY_TOKEN=$cp_token
CRYPTOPAY_NETWORK=$network
ASSETS=USDT,TON
ENV
}

wait_healthy() {
  for _ in $(seq 1 "$1"); do
    curl -fsS --max-time 2 http://localhost:3000/api/health >/dev/null 2>&1 && return 0
    printf '.'
    sleep 3
  done
  return 1
}

bold "4/4  Сборка и запуск (первый раз — 3–7 минут)"
write_env
"${COMPOSE[@]}" up -d db
"${COMPOSE[@]}" up -d --build --force-recreate app
printf 'Ждём запуска'
if ! wait_healthy 100; then
  echo
  warn "Приложение не отвечает. Последние строки журнала:"
  "${COMPOSE[@]}" logs --tail 40 app >&2 || true
  exit 1
fi
echo
ok "Приложение запущено"
active_url="$url"

reachable=no
for _ in $(seq 1 30); do
  if curl -fsS --max-time 5 "$url/api/health" >/dev/null 2>&1; then reachable=yes; break; fi
  sleep 2
done
if [ "$reachable" = yes ]; then
  ok "Кошелёк открывается из интернета: $url"
else
  warn "Приложение запущено, но с этого Mac адрес $url пока не открывается."
  warn "Попробуйте открыть кошелёк в Telegram. Если не откроется — пришлите снимок этого окна."
fi

bold "Готово! Можно тестировать в Telegram:"
cat <<TXT

  1) Откройте своего бота в Telegram и отправьте /start
  2) Нажмите «Открыть Tonum Wallet» (или кнопку «Tonum Wallet» слева от поля ввода)

  Деньги тестовые: платите и получайте выводы в @CryptoTestnetBot.
  Пополнение зачисляется в течение ~30 секунд после оплаты.
  Для выводов включите в Crypto Pay переводы (Transfers) и пополните баланс приложения.

  Пока идёт тест, не закрывайте это окно и не давайте Mac уснуть (держите крышку открытой).
  Остановить — Ctrl+C. Журнал приложения — в новом окне: docker compose logs -f app
TXT

# Watch the tunnel: reconnect if it drops and hand a changed address to the bot.
while true; do
  sleep 5
  if ! kill -0 "$tunnel_pid" 2>/dev/null; then
    warn "Туннель отключился — переподключаемся…"
    connect_any || die "Не удалось переподключить туннель. Запустите скрипт снова."
  fi
  latest="$(url_from_log)"
  [ -n "$latest" ] && url="$latest"
  if [ "$url" != "$active_url" ]; then
    echo "Адрес туннеля сменился: $url — обновляем бота…"
    write_env
    "${COMPOSE[@]}" up -d --force-recreate app >/dev/null 2>&1 || true
    if wait_healthy 40; then
      echo
      active_url="$url"
      ok "Готово. В Telegram откройте кошелёк кнопкой «Tonum Wallet» или отправьте /start заново"
    else
      echo
      warn "Приложение не перезапустилось — попробуем ещё раз через несколько секунд"
    fi
  fi
done
