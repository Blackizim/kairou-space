#!/bin/bash
echo "PermitRootLogin yes" > /etc/ssh/sshd_config.d/01-root.conf
echo "PasswordAuthentication yes" >> /etc/ssh/sshd_config.d/01-root.conf
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
systemctl restart ssh
echo "=== SSH REMOTO LIBERADO COM SUCESSO! ==="
