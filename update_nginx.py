import os
import time
import paramiko

VPS_HOST = '80.97.124.207'
VPS_USER = 'root'
VPS_PASS = '14b36tpHnyooYECFc4'
LOCAL_DIR = r'c:\Users\shizu\Downloads\kairou\kaiii2'

print("=== APPLYING FIXES AND RESTARTING ===")
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(VPS_HOST, port=22, username=VPS_USER, password=VPS_PASS, timeout=15)
sftp = ssh.open_sftp()

def run_remote(cmd):
    print(f"[REMOTE] {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode('utf-8', errors='ignore')
    err = stderr.read().decode('utf-8', errors='ignore')
    if out:
        print(f"  STDOUT: {out[:250]}")
    if err:
        print(f"  STDERR: {err[:250]}")
    return out, err

# 1. Update Nginx configuration
with sftp.file('/etc/nginx/sites-available/kairou', 'r') as f:
    conf = f.read().decode('utf-8')

old_line = "location ~ ^/api/(extract|channels|matches|vip|tv|bunny|version|tmdb|anilist|tvmaze|config|send) {"
new_line = "location ~ ^/api/(extract|channels|matches|vip|tv|bunny|version|tmdb|anilist|tvmaze|config|send|skip|pb|catalog|title|search|stream|p|subtitle|health) {"

if old_line in conf:
    conf = conf.replace(old_line, new_line)
    with sftp.file('/etc/nginx/sites-available/kairou', 'w') as f:
        f.write(conf)
    print("Nginx configuration updated!")
else:
    print("Old line not found in conf or already updated.")

run_remote('nginx -t && systemctl reload nginx')

# 2. Upload latest server.mjs
local_server = os.path.join(LOCAL_DIR, 'dist-server', 'server.mjs')
print(f"Uploading {local_server} -> /var/www/kairou/server.mjs")
sftp.put(local_server, '/var/www/kairou/server.mjs')

# 3. Restart PM2 process
run_remote('pm2 restart kairou-api --update-env')
time.sleep(3)

# 4. Check status and test endpoints
run_remote('pm2 status')
run_remote('curl -s http://127.0.0.1:3001/api/health')
run_remote('curl -s https://www.kairou.space/api/health')
run_remote('curl -s https://www.kairou.space/filme/550-fight-club | head -n 12')
run_remote('curl -s https://www.kairou.space/api/title/movie/550')

sftp.close()
ssh.close()
print("=== FIXES COMPLETED ===")
