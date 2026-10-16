# Ligar o número do assistente à Meta (passo a passo)

Ao final você terá **4 dados** para colar na Render: o token permanente, o ID do número, a chave secreta do app e uma frase de verificação.

> **Aviso:** a Meta muda os nomes de menus e botões com frequência, e escrevi isto sem ver as telas. **Faça um passo de cada vez e me mande um print** (escondendo tokens e senhas). Eu digo o que clicar. O fluxo geral segue o [guia oficial da Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started).

## Como funciona o número

O assistente atende num **número só dele**. Um número ligado à API do bot **não funciona ao mesmo tempo no app WhatsApp Business**, então ninguém da equipe lê esse número. Quando o cliente precisa de uma pessoa, o bot manda um link que abre o WhatsApp da **recepção** (o número que a equipe já usa, no app). O número atual da academia **não muda**.

## Antes de começar, tenha em mãos

- O **login do Facebook** de quem administra a conta Meta Business da academia.
- Um **número novo**, que **não esteja em nenhum WhatsApp** (nem o pessoal, nem o Business). Pode ser um chip pré-pago ou uma linha fixa, mas precisa **receber um código** por SMS ou ligação. Depois de ligado à API, esse número **não poderá ser usado no app**.
- O **nome de exibição** que os clientes verão (ex.: "GarageFit Academia").

## Etapa 1: criar o app

1. Abra **developers.facebook.com**, entre e clique em **Criar app**.
2. Escolha o caso de uso **"Conectar-se com clientes pelo WhatsApp"** (se aparecer só "Outro", escolha o tipo **Empresa**).
3. Dê um nome ao app (ex.: "GarageFit Assistente") e escolha o **portfólio empresarial** da academia (ou crie um).

## Etapa 2: abrir a configuração do WhatsApp

No painel do app, vá em **WhatsApp > Configuração da API** (API Setup). A Meta já mostra um **número de teste** e o **ID do número**. Você pode usá-los para testar o envio, mas o assistente vai usar o **seu número novo**, adicionado na próxima etapa.

## Etapa 3: adicionar o número novo

1. Na mesma tela, procure **Adicionar número de telefone**.
2. Informe o **nome de exibição**, a categoria do negócio e o **número novo**.
3. Confirme o código que chegar por SMS ou ligação.
4. Depois de adicionado, ele aparece na lista. **Anote o "ID do número de telefone"** dele (não é o número em si).

A Meta pode **analisar o nome de exibição** e pode pedir **verificação do negócio** (documentos da empresa) e uma **forma de pagamento** na conta do WhatsApp Business. Se pedir, siga as telas. Não consegui confirmar exatamente quando isso é exigido, então me mande um print se aparecer.

## Etapa 4: token permanente

O token que aparece na tela da API **expira em cerca de 24 horas**. Para o bot, você precisa de um **permanente**:

1. Abra **business.facebook.com** e vá em **Configurações do negócio**.
2. Em **Usuários > Usuários do sistema**, clique em **Adicionar** e crie um usuário com função **Administrador**.
3. Selecione-o e clique em **Atribuir ativos**. Dê **controle total** ao **app** e à **conta do WhatsApp Business**.
4. Clique em **Gerar novo token**, escolha o **app** e marque as permissões **`whatsapp_business_messaging`** e **`whatsapp_business_management`**.
5. **Copie o token na hora e guarde**: ele só aparece uma vez. **Não envie por chat.**

Algumas fontes citam permissões diferentes. Se mais tarde aparecer um erro de permissão, adicione também `business_management`.

## Etapa 5: reunir os 4 dados

| Dado | Onde achar | Nome na Render |
|---|---|---|
| Token permanente | Etapa 4 | `WHATSAPP_ACCESS_TOKEN` |
| ID do número | Etapa 3 (do **número novo**) | `WHATSAPP_PHONE_NUMBER_ID` |
| Chave secreta do app | Painel do app > Configurações > Básico > Chave secreta do app (clique em mostrar) | `WHATSAPP_APP_SECRET` |
| Frase de verificação | **Você inventa** uma frase longa, sem espaços | `WHATSAPP_VERIFY_TOKEN` |

## Etapa 6: o webhook (só depois que o bot estiver no ar na Render)

No painel do app, em **WhatsApp > Configuração > Webhook**:

1. **URL de callback:** `https://SEU-SERVICO.onrender.com/webhook` (o endereço da Render, com `/webhook` no final).
2. **Token de verificação:** a frase da etapa 5.
3. Clique em **Verificar e salvar**.
4. Em **Campos do webhook**, assine **messages**.

## Etapa 7: testar

Do seu celular, mande uma mensagem para o **número novo do assistente**. Se não chegar nada:

- Veja se o app está em modo **"Ativo/Live"** e não em "Desenvolvimento". Para publicar, a Meta costuma pedir um **link de política de privacidade** (pode ser uma página no site da academia).
- Confira se o campo **messages** está assinado.
- Veja os **Logs** na Render.

## Etapa 8: divulgar

Coloque o número do assistente no Instagram, no site e na recepção como o **"WhatsApp 24h"** da academia.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Meta recusa o webhook | Frase de verificação diferente da `WHATSAPP_VERIFY_TOKEN`, ou URL sem `/webhook` |
| Log da Render: `assinatura inválida` | `WHATSAPP_APP_SECRET` errado |
| Funcionou e parou depois de um dia | Está usando o token temporário. Gere o permanente (etapa 4) |
| Log: `falha ao enviar` com código 190 | Token expirado ou inválido |
| O número não aceita o código | O número já está em algum WhatsApp. Precisa estar livre |
| Mensagens não chegam | App em modo Desenvolvimento, ou campo `messages` não assinado |
