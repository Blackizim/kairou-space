import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('80.97.124.207', port=22, username='root', password='14b36tpHnyooYECFc4', timeout=10)

sftp = ssh.open_sftp()
with sftp.file('/tmp/check_db.py', 'w') as f:
    f.write('''import sqlite3
con = sqlite3.connect('/opt/pocketbase/pb_data/data.db')
cur = con.cursor()
tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table';").fetchall()]
print('TABLES:', tables)
for t in ['users', 'profiles', '_collections', 'watch_progress']:
    if t in tables:
        count = cur.execute(f"SELECT count(*) FROM {t};").fetchone()[0]
        cols = [c[1] for c in cur.execute(f"PRAGMA table_info({t});").fetchall()]
        print(f"{t}: count={count}, cols={cols}")
cur.execute("SELECT id, email, created FROM users LIMIT 3;")
print("Sample users:", cur.fetchall())
''')
sftp.close()

stdin, stdout, stderr = ssh.exec_command('python3 /tmp/check_db.py')
print(stdout.read().decode())
print(stderr.read().decode())
ssh.close()
