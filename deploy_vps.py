import os
import sys
import time
import paramiko

try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass

VPS_HOST = '80.97.124.207'
VPS_USER = 'root'
VPS_PASS = '14b36tpHnyooYECFc4'
LOCAL_DIR = r'c:\Users\shizu\Downloads\kairou\kaiii2'

print("=== DEPLOYING TO ALEXHOST VPS ===")
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(VPS_HOST, port=22, username=VPS_USER, password=VPS_PASS, timeout=15)
sftp = ssh.open_sftp()

def run_remote(cmd):
    print(f"[REMOTE] {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode('utf-8', errors='ignore')
    err = stderr.read().decode('utf-8', errors='ignore')
    if err and not out:
        print(f"  STDERR: {err}")
    elif out:
        print(f"  STDOUT: {out[:300]}...")
    return out, err

# 1. Verify PocketBase DB exists and is safe
out, _ = run_remote('ls -la /opt/pocketbase/pb_data/data.db')
print("Protected PB DB:", out.strip())

# 2. Create timestamped backup of current /var/www/kairou
ts = int(time.time())
run_remote(f'cp -r /var/www/kairou/dist /var/www/kairou/dist.bak_{ts}')
run_remote(f'cp /var/www/kairou/server.mjs /var/www/kairou/server.mjs.bak_{ts} 2>/dev/null || true')

# 3. Clean old index bundle files from /var/www/kairou/dist/assets
run_remote('mkdir -p /var/www/kairou/dist && rm -f /var/www/kairou/dist/assets/index-*.js /var/www/kairou/dist/assets/index-*.css')

# 4. SFTP upload directory recursive (smart diff by size)
def upload_dir(local_path, remote_path):
    print(f"Uploading {local_path} -> {remote_path}")
    for root, dirs, files in os.walk(local_path):
        rel = os.path.relpath(root, local_path)
        dest_dir = remote_path if rel == '.' else os.path.join(remote_path, rel).replace('\\', '/')
        try:
            sftp.mkdir(dest_dir)
        except Exception:
            pass
        for f in files:
            src_file = os.path.join(root, f)
            dest_file = os.path.join(dest_dir, f).replace('\\', '/')
            local_size = os.path.getsize(src_file)
            # Only skip large static media if size matches; HTML/JS/CSS/XML always upload
            if f.endswith(('.png', '.jpg', '.jpeg', '.gif', '.woff2', '.webp')) and not f.startswith('index-'):
                try:
                    remote_stat = sftp.stat(dest_file)
                    if remote_stat.st_size == local_size:
                        continue  # File unchanged, skip upload
                except Exception:
                    pass
            sftp.put(src_file, dest_file)

local_dist = os.path.join(LOCAL_DIR, 'dist')
upload_dir(local_dist, '/var/www/kairou/dist')

# 5. Upload server.mjs
local_server = os.path.join(LOCAL_DIR, 'dist-server', 'server.mjs')
print(f"Uploading {local_server} -> /var/www/kairou/server.mjs")
sftp.put(local_server, '/var/www/kairou/server.mjs')

# 6. Ensure server/server.js imports ../server.mjs
run_remote('mkdir -p /var/www/kairou/server && echo "import \'../server.mjs\';" > /var/www/kairou/server/server.js')

# 7. Update Nginx configuration rule 3
nginx_update_py = '''
with open('/etc/nginx/sites-available/kairou', 'r') as f:
    content = f.read()

target = 'location ~ ^/api/(extract|channels|matches|vip|tv|bunny|version|tmdb|anilist|tvmaze|config|send|skip)'
replacement = 'location ~ ^/api/(extract|channels|matches|vip|tv|bunny|version|tmdb|anilist|tvmaze|config|send|skip|pb|catalog|title|search|stream|p|subtitle|health)'

if target in content and replacement not in content:
    content = content.replace(target, replacement)
    with open('/etc/nginx/sites-available/kairou', 'w') as f:
        f.write(content)
    print("Nginx config updated successfully.")
else:
    print("Nginx config already up to date or target pattern not matched.")
'''
with sftp.file('/tmp/update_nginx.py', 'w') as f:
    f.write(nginx_update_py)

run_remote('python3 /tmp/update_nginx.py')
run_remote('nginx -t && systemctl reload nginx')

# 8. Set permissions
run_remote('chown -R www-data:www-data /var/www/kairou/dist')

# 9. Restart PM2 kairou-api
run_remote('pm2 restart kairou-api --update-env')

# 10. Wait and test
time.sleep(3)
run_remote('pm2 status')
run_remote('curl -s http://127.0.0.1:3001/api/health')
run_remote('curl -s http://127.0.0.1:3001/api/channels | cut -c 1-100')
run_remote('curl -s https://www.kairou.space/api/health')
run_remote('curl -s https://www.kairou.space/api/channels | cut -c 1-100')
run_remote('curl -s https://www.kairou.space/canais | head -n 10')

sftp.close()
ssh.close()
print("=== DEPLOYMENT COMPLETED ===")
