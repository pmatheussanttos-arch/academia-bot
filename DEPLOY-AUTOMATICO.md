# Deploy automático (a Render atualiza o bot sozinha)

Hoje o deploy é manual (**Manual Deploy → Deploy latest commit**) porque o serviço da Render foi criado a partir de um endereço público do GitHub, e nesse caso a Render não recebe aviso das mudanças. A solução é o **Deploy Hook**: um endereço secreto que, quando acessado, manda a Render atualizar. O GitHub acessa esse endereço sozinho sempre que algo novo entra na branch `main`, **depois de rodar todos os testes**. Se um teste falhar, o deploy NÃO acontece.

## Ligar (uma vez só, 2 minutos)

1. **Render:** abra o serviço do bot → **Settings** → role até **Deploy Hook** → copie o endereço (começa com `https://api.render.com/deploy/srv-...`). Esse endereço é uma senha: **não cole em chat nem em e-mail**.
2. **GitHub:** abra o repositório `academia-bot` → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
   - Name: `RENDER_DEPLOY_HOOK`
   - Secret: cole o endereço copiado → **Add secret**.
3. Pronto. Para testar sem mudar nada: aba **Actions** → **Testes e deploy** → **Run workflow**. Ao terminar (verde), a Render começa um deploy.

## O que passa a acontecer

- Toda mudança na `main` roda os testes (cerca de 1 minuto). Verde = a Render atualiza o bot. Vermelho = nada muda no ar, e o GitHub avisa por e-mail.
- Cada deploy reinicia o bot por 1 a 2 minutos. O WhatsApp reconecta sozinho, sem QR code (a sessão fica no disco), e o aviso de queda só dispara depois de 5 minutos.
- **Qualquer mudança vai para o ar sozinha, inclusive as que eu fizer aqui.** Se você quiser revisar antes, não ligue o passo 2 e continue com o Manual Deploy.

## Desligar

Apague o segredo `RENDER_DEPLOY_HOOK` no GitHub (os testes continuam rodando, mas sem deploy).
