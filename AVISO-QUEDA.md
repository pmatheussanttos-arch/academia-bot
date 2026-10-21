# Ser avisado quando o WhatsApp cair

Sem isto, o bot pode ficar mudo e você só descobre quando um cliente reclama.

**Por que não dá para o próprio bot avisar:** quando a conexão cai, é justamente o WhatsApp que parou. Mandar o aviso por lá não chegaria a ninguém. Por isso a solução é um vigia **de fora**, que fica olhando o bot e te manda um e-mail.

## Como funciona

O bot tem um endereço que responde o estado da conexão:

```
https://SEU-ENDERECO.onrender.com/status/whatsapp
```

- **Conectado:** responde "tudo certo".
- **Fora do ar há mais de 5 minutos:** responde erro, e o vigia te manda o e-mail.

Quedas curtas e reinícios (um deploy, por exemplo) **não** disparam aviso. Se avisasse a cada soluço, você pararia de olhar os e-mails, e aí o aviso não serviria para nada. Para mudar esse prazo, crie na Render a variável `STATUS_TOLERANCIA_MIN` com o número de minutos.

Esse endereço fica aberto, sem senha, porque o vigia precisa acessá-lo sozinho. Ele mostra só se a conexão está de pé e há quanto tempo. **Nunca mostra o QR code**, que é o que daria acesso ao seu WhatsApp.

## Passo a passo (UptimeRobot, gratuito)

> Escrevi sem acesso às telas do UptimeRobot; os nomes dos botões podem ter mudado um pouco. Se algo não bater, me mande um print.

1. **Copie o endereço.** Abra o atalho da área de trabalho (a página de conexão). No fim dela há o cartão **"🔔 Aviso se o WhatsApp cair"** com o endereço pronto: toque na caixinha para selecionar e copiar.
2. Crie uma conta gratuita em **uptimerobot.com** e confirme o e-mail.
3. Clique em **"+ New monitor"** (novo monitor).
4. Preencha:
   - **Monitor type:** `HTTP(s)`
   - **Friendly name:** `WhatsApp GarageFit`
   - **URL:** cole o endereço que você copiou
   - **Monitoring interval:** 5 minutos
5. Em **alertas**, marque o seu e-mail. Se quiser aviso no celular, instale o app do UptimeRobot e ligue a notificação por lá.
6. Salve. Em poucos minutos ele deve mostrar **"Up"** (no ar), em verde.

## Testar se o aviso funciona

Vale a pena testar uma vez, para não descobrir que não funciona justamente no dia da queda:

1. No celular da academia, abra **WhatsApp > Aparelhos conectados** e **remova o aparelho do bot**.
2. Espere uns 10 minutos. Você deve receber o e-mail do UptimeRobot dizendo que está fora do ar.
3. Abra o atalho da área de trabalho e **escaneie o QR code** de novo.
4. Em poucos minutos chega outro e-mail avisando que voltou.

Faça isso num horário de pouco movimento: enquanto estiver desconectado, o bot não responde ninguém.

## Quando o e-mail chegar

O e-mail diz que o bot está fora do ar. O que fazer:

1. Abra o atalho da área de trabalho (a página de conexão).
2. **Se aparecer um QR code:** escaneie com o celular da academia. Era isso.
3. **Se disser "Reconectando":** espere alguns minutos; costuma voltar sozinho.
4. **Se a página não abrir:** veja na Render se o serviço está **Live**. Se não estiver, use **Manual Deploy → Deploy latest commit**.

## Outros vigias

Qualquer serviço de monitoramento serve, desde que aceite um endereço e avise por e-mail. O que ele precisa entender é só isto: resposta normal = tudo certo; resposta de erro = avisar.

O Telegram continua disponível como reserva (`TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`), mas exige criar um bot lá. O vigia por e-mail não exige nada disso.
