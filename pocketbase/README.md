# PocketBase local

O serviço usa uma base própria em `.local/pocketbase/pb_data`; não copie a base de produção para testes. Para usar o executável PocketBase já disponível no computador:

```powershell
New-Item -ItemType Directory -Force .local/pocketbase/pb_data | Out-Null
Copy-Item 'C:\Users\shizu\Downloads\REA - Cópia\pb\pocketbase.exe' .local/pocketbase/pocketbase.exe
& ./.local/pocketbase/pocketbase.exe migrate up --dir ./.local/pocketbase/pb_data --migrationsDir ./pocketbase/pb_migrations --hooksDir ./pocketbase/pb_hooks
& ./.local/pocketbase/pocketbase.exe serve --http 127.0.0.1:8090 --dir ./.local/pocketbase/pb_data --migrationsDir ./pocketbase/pb_migrations --hooksDir ./pocketbase/pb_hooks
```

O servidor do aplicativo acessa o PocketBase em `PB_URL`, que por padrão aponta para `http://127.0.0.1:8090`. As contas anteriores do navegador não são automaticamente migradas; cadastro ou login no PocketBase é necessário. A sincronização de lista e progresso é por perfil. As migrações e regras limitam os registros de cada usuário à sua conta. Para outros sistemas, obtenha uma versão compatível do PocketBase e ajuste o caminho do executável.
