#!/usr/bin/env bash
# Tonum Wallet — one-shot installer for a fresh Ubuntu server.
#   sudo bash deploy/install.sh
# Installs Docker, asks for the domain and tokens, writes .env and starts everything
# (Postgres + app + Caddy with automatic HTTPS). Safe to re-run: it keeps an existing .env
# unless you choose to overwrite it.
set -euo pipefail

cd "$(dirname "$0")/.."

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Запустите от имени root: sudo bash deploy/install.sh"
[ -f docker-compose.yml ] || die "Запускайте скрипт из папки проекта"

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

# Values that must survive a reconfiguration: the database volume keeps its first password.
get_env() { [ -f .env ] && grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }

bold "1/4  Docker"
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  ok "Docker уже установлен"
else
  curl -fsSL https://get.docker.com | sh
  ok "Docker установлен"
fi

bold "2/4  Настройки"
write_env=yes
if [ -f .env ]; then
  read -r -p "Файл настроек .env уже есть. Ввести настройки заново? (y/N): " answer </dev/tty
  [[ "$answer" =~ ^[YyДд] ]] || write_env=no
fi

if [ "$write_env" = yes ]; then
  while true; do
    domain="$(ask "Домен, например tonum.ru" '^[^[:space:]]+$')"
    domain="${domain#http://}"; domain="${domain#https://}"; domain="${domain%%/*}"
    domain="$(printf '%s' "$domain" | tr '[:upper:]' '[:lower:]')"
    [[ "$domain" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] && break
    warn "Укажите домен вида tonum.ru — без пробелов и русских букв."
  done
  echo "Ключи вводятся скрыто — при вставке символы не отображаются, это нормально."
  bot_token="$(ask "Ключ бота от @BotFather" '^[0-9]+:[A-Za-z0-9_-]{30,}$' secret)"
  cp_token="$(ask "Ключ Crypto Pay (API Token)" '^[0-9]+:[A-Za-z0-9_-]+$' secret)"
  net_choice="$(ask "Crypto Pay: 1 — тестовые деньги (@CryptoTestnetBot), 2 — настоящие (@CryptoBot)" '^[12]$')"
  network=testnet; [ "$net_choice" = 2 ] && network=mainnet

  pg_pass="$(get_env POSTGRES_PASSWORD)"; [ -n "$pg_pass" ] || pg_pass="$(openssl rand -hex 24)"
  hook_secret="$(get_env TELEGRAM_WEBHOOK_SECRET)"; [ -n "$hook_secret" ] || hook_secret="$(openssl rand -hex 32)"

  umask 077
  cat > .env <<ENV
NODE_ENV=production
DOMAIN=$domain
TRUST_PROXY=true
LOG_LEVEL=info

POSTGRES_PASSWORD=$pg_pass

BOT_TOKEN=$bot_token
BOT_MODE=webhook
TELEGRAM_WEBHOOK_SECRET=$hook_secret
PUBLIC_URL=https://$domain
WEBAPP_URL=https://$domain

PAYMENT_PROVIDER=cryptopay
CRYPTOPAY_TOKEN=$cp_token
CRYPTOPAY_NETWORK=$network
ASSETS=USDT,TON
ENV
  ok "Настройки сохранены в .env"
fi

domain="$(grep -E '^DOMAIN=' .env | cut -d= -f2-)"
[ -n "$domain" ] || die "В .env не указан DOMAIN"

bold "3/4  Проверка домена"
server_ip="$(curl -fsS4 --max-time 5 https://api.ipify.org || true)"
domain_ip="$(getent ahostsv4 "$domain" | awk 'NR==1{print $1}' || true)"
if [ -n "$server_ip" ] && [ "$server_ip" = "$domain_ip" ]; then
  ok "$domain указывает на этот сервер ($server_ip)"
else
  warn "$domain указывает на '${domain_ip:-никуда}', а IP этого сервера — '${server_ip:-неизвестен}'."
  warn "Проверьте A-запись домена. Если вы только что её поменяли, подождите — HTTPS включится сам, когда DNS обновится."
fi

bold "4/4  Сборка и запуск (первый раз — 3–7 минут)"
docker compose up -d --build

printf 'Ждём запуска'
for _ in $(seq 1 60); do
  if docker compose exec -T app wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo; ok "Приложение запущено"
    break
  fi
  printf '.'; sleep 3
done
echo

if ! docker compose exec -T app wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
  warn "Приложение пока не отвечает. Последние строки журнала:"
  docker compose logs --tail 30 app || true
  exit 1
fi

bold "Готово! Осталось два шага в Telegram:"
cat <<TXT

  1) @BotFather → /mybots → ваш бот → Bot Settings → Configure Mini App → Enable
     Адрес:  https://$domain

  2) Crypto Pay → My Apps → ваше приложение:
     • Webhooks → включить, адрес:  https://$domain/api/webhooks/cryptopay
     • Включите переводы (Transfers) и пополните баланс приложения — из него идут выводы.

  Проверка: откройте https://$domain/api/health — должно быть {"ok":true}
  Журнал:   docker compose logs -f app
  Обновить: положите новые файлы и запустите  docker compose up -d --build
TXT
