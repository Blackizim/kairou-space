#!/bin/bash
set -e

echo "=== 1. BAIXANDO NOVO SERVER.MJS COMPILADO ==="
curl -sL https://raw.githubusercontent.com/Blackizim/kairou-space/main/dist-server/server.mjs -o /var/www/kairou/server.mjs
mkdir -p /var/www/kairou/server
echo "import '../server.mjs';" > /var/www/kairou/server/server.js

echo "=== 2. ATUALIZANDO NGINX ==="
python3 -c "
fpath = '/etc/nginx/sites-available/kairou'
with open(fpath, 'r') as f:
    c = f.read()

target1 = 'location ~ ^/api/(extract|channels|matches|vip|tv|bunny|version|tmdb|anilist|tvmaze|config|send|skip|pb|catalog|title|search|stream|p|subtitle|health)'
target2 = 'location ~ ^/api/(extract|channels|matches|vip|tv|bunny|version|tmdb|anilist|tvmaze|config|send|skip)'
repl = 'location ~ ^/api/(extract|channels|matches|vip|tv|bunny|version|tmdb|anilist|tvmaze|config|send|skip|pb|catalog|title|search|stream|p|subtitle|health|analytics|urgent-announcement)'

if target1 in c:
    c = c.replace(target1, repl)
elif target2 in c:
    c = c.replace(target2, repl)

if 'proxy_buffering off;' not in c and 'proxy_pass http://127.0.0.1:3001;' in c:
    c = c.replace('proxy_pass http://127.0.0.1:3001;', 'proxy_pass http://127.0.0.1:3001;\\n        proxy_buffering off;\\n        proxy_cache off;\\n        proxy_read_timeout 300s;')

with open(fpath, 'w') as f:
    f.write(c)
"
nginx -t && systemctl reload nginx

echo "=== 3. REINICIANDO PM2 ==="
pm2 restart kairou-api --update-env

echo "=== 4. TESTANDO ENDPOINTS LOCAIS ==="
curl -s http://127.0.0.1:3001/api/health
echo ""

echo "=== DEPLOY CONCLUIDO COM SUCESSO! ==="
