#!/bin/bash
set -e

echo "=== 1. BAIXANDO ARQUIVOS COMPILADOS DO GITHUB CDN ==="
mkdir -p /var/www/kairou/dist/assets /var/www/kairou/server

echo "Baixando server.mjs..."
curl -4 -fsSL https://raw.githubusercontent.com/Blackizim/kairou-space/main/dist-server/server.mjs -o /var/www/kairou/server.mjs
echo "import '../server.mjs';" > /var/www/kairou/server/server.js

echo "Baixando frontend (index.html, JS, CSS)..."
curl -4 -fsSL https://raw.githubusercontent.com/Blackizim/kairou-space/main/dist/index.html -o /var/www/kairou/dist/index.html
curl -4 -fsSL https://raw.githubusercontent.com/Blackizim/kairou-space/main/dist/assets/index-CYgTw0RC.js -o /var/www/kairou/dist/assets/index-CYgTw0RC.js
curl -4 -fsSL https://raw.githubusercontent.com/Blackizim/kairou-space/main/dist/assets/index-x1GIZ1SN.css -o /var/www/kairou/dist/assets/index-x1GIZ1SN.css
chown -R www-data:www-data /var/www/kairou/dist
echo "[OK] Arquivos baixados e permissoes ajustadas!"

echo "=== 2. CONFIGURANDO ANTI-BOT NO SSHD ==="
mkdir -p /etc/ssh/sshd_config.d
echo -e "MaxStartups 100:30:200\nLoginGraceTime 20" > /etc/ssh/sshd_config.d/99-anti-bot.conf
systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null || true
echo "[OK] SSHD otimizado contra bot floods!"

echo "=== 3. RECARREGANDO NGINX E PM2 ==="
nginx -t && systemctl reload nginx
pm2 restart kairou-api --update-env

echo "=== 4. TESTANDO ENDPOINTS ==="
sleep 2
curl -s http://127.0.0.1:3001/api/health
echo ""
echo "=== DEPLOY CONCLUIDO COM EXITO TOTAL! ==="
