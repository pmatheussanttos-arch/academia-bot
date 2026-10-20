# Conectar o WhatsApp por QR code (modo simples)

Neste modo o assistente conecta ao **número da própria academia** lendo um QR code, igual ao WhatsApp Web. Não precisa de app da Meta, token nem número novo.

## ⚠️ Leia antes de decidir

Este método **não é oficial** e **vai contra as regras do WhatsApp**. O número pode ser **banido**, sem aviso e sem recurso. Não dá para saber quando. Você aceitou esse risco. Mesmo assim, deixo o conselho: o dia em que o WhatsApp banir, a academia fica sem o canal. Tenha um plano B (um segundo número, ou migrar para o modo oficial mais tarde). O código já suporta os dois modos.

Outra limitação: essas conexões quebram de tempos em tempos quando o WhatsApp muda algo, e aí alguém técnico precisa atualizar a biblioteca.

## Como a equipe atende junto

Como o bot está no **mesmo número** da academia, a equipe continua usando o WhatsApp normalmente no celular. Quando a equipe escreve para um cliente pelo celular, **o bot percebe e se cala naquela conversa**. Ele só volta a responder sozinho depois de **1 hora sem nenhuma mensagem da equipe** naquela conversa: cada mensagem humana renova essa hora (o prazo é `HANDOFF_HORAS`, padrão 1).

Quando o cliente precisa de uma pessoa (ou o bot não sabe algo), o bot responde só: *"Ok, vou te transferir para um atendente. Aguarde um instante, que já vai te responder! 😊"*, avisa a equipe (veja "Avisos para a equipe" abaixo) e **fica em silêncio com aquele cliente**. Se ninguém da equipe falar com ele em 1 hora, o bot volta a responder. **Nenhum número de telefone é passado ao cliente**: quem atende responde na própria conversa, pelo WhatsApp da academia. Para mudar o texto, edite a seção `transferencia` do `mensagens.md`. O prazo do silêncio é o `HANDOFF_HORAS` (padrão 1 hora).

## Passo a passo

**1. Coloque o bot no ar** seguindo o HOSPEDAGEM.md, com estas variáveis na Render:

| Variável | Valor |
|---|---|
| `WHATSAPP_MODO` | `qr` |
| `ANTHROPIC_API_KEY` | sua chave da Claude API |
| `ADMIN_TOKEN` | uma senha longa que você inventa (protege a página do QR) |
| `NUMEROS_PERMITIDOS` | seu celular, com DDD (enquanto testa) |
| `NUMEROS_AVISOS` | o WhatsApp de quem atende na recepção, com DDD (veja "Avisos para a equipe" abaixo) |

No modo QR você **não precisa** das variáveis `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` nem `NUMERO_RECEPCAO`. Se `NUMERO_RECEPCAO` estiver preenchida, ela é **ignorada** neste modo (o cliente nunca recebe link com o número de ninguém); pode apagá-la.

**Modo de teste (`NUMEROS_PERMITIDOS`):** o WhatsApp às vezes identifica a pessoa por um código interno (algo como `277038426505415`) em vez do telefone. O bot descobre o telefone sozinho, então basta colocar o **telefone** em `NUMEROS_PERMITIDOS`. Se o WhatsApp esconder o telefone de alguém, o Log da Render mostra `ignorei +... (código interno ...)`: nesse caso pode colocar o código na lista.

**2. Abra a página de conexão.** Quando o serviço estiver **Live**, abra no navegador:

```
https://SEU-ENDERECO.onrender.com/conectar?token=SEU_ADMIN_TOKEN
```

(troque `SEU_ADMIN_TOKEN` pelo valor que você pôs em `ADMIN_TOKEN`). Vai aparecer um QR code.

**3. Escaneie com o celular do número da academia:**
- Abra o WhatsApp no celular.
- Toque em **⋮ (ou Ajustes) → Aparelhos conectados → Conectar um aparelho**.
- Aponte a câmera para o QR code da página.

**4. Pronto.** A página mostra "✅ Conectado". O assistente começa a responder. Mande uma mensagem do seu celular (o que está em `NUMEROS_PERMITIDOS`) para testar.

**5. Libere para todos.** Quando estiver satisfeito, na Render apague a variável `NUMEROS_PERMITIDOS`.

## Pausar o assistente

**Uma conversa só:** no celular da academia, escreva a palavra **`transferido`** na conversa do cliente. O bot para de responder só aquele cliente e volta 1 hora depois da última mensagem da equipe nessa conversa. A palavra aparece para o cliente, porque é uma mensagem como outra qualquer. (Qualquer resposta da equipe já silencia o bot naquela conversa; a palavra serve para fazer isso de forma explícita.) Enquanto o bot está calado, as mensagens do cliente **ficam como não lidas** no celular, para a equipe ver.

**Devolver uma conversa ao bot antes da hora:**
- **Pela página:** na página de conexão, a caixa **Conversas com a equipe** lista os clientes em que o bot está calado (telefone, motivo e a hora em que ele volta sozinho). Toque em **Devolver ao bot** ao lado do cliente. O cliente não vê nada.
- **Pelo WhatsApp:** no celular da academia, escreva a palavra **`retomar`** (sozinha) na conversa daquele cliente. A palavra aparece para o cliente, como o `transferido`. Para frases como "vou retomar seu treino" nada muda: só vale a palavra sozinha.
- O bot volta a responder a **próxima mensagem** do cliente; ele não responde mensagens que chegaram enquanto estava calado.

**O assistente todo (todos os clientes):**
- **Pelo botão:** abra a página de conexão (o mesmo atalho do QR). No topo aparece "Assistente ATIVO" com os botões **Pausar 1 hora**, **Pausar 4 horas** e **Pausar até eu reativar**. Pausado, aparece **Reativar agora**.
- **Por WhatsApp:** no celular da academia, abra a conversa **com você mesmo** ("Mensagem para você") e envie `pausar` (1 hora), `pausar 5` (5 horas, de 1 a 72), `pausar sempre`, `retomar` ou `status`. O bot responde na mesma conversa. **Só o celular da academia manda nesses comandos**: cliente, número da equipe ou qualquer outro número que escreva "pausar" não pausa nada.

A pausa geral fica gravada no disco: **um deploy ou reinício não a desfaz**. Pausada, o bot não responde ninguém e não marca as mensagens como lidas. Quem escrever durante a pausa não recebe nada, então não deixe pausado sem necessidade; prefira um prazo.

## Avisos para a equipe

Quando o cliente pede uma pessoa, solicita uma avaliação ou aula, ou manda um comprovante, o bot **manda uma mensagem de WhatsApp** para quem atende (com nome, telefone do cliente e o motivo).

- Configure na Render, em **Environment**, a variável `NUMEROS_AVISOS` com o WhatsApp da recepção, com DDD. Vários números: separe por vírgula (`11988887777,11977776666`).
- **Tem que ser outro número, não o da academia.** O bot envia a partir do número da academia; se o destino for o mesmo, o aviso cai numa conversa consigo mesmo e ninguém é notificado (o bot avisa isso no Log).
- Quem recebe o aviso e responde nessa conversa **não é atendido pelo bot** (é tratado como equipe). Exceção: se o número também estiver em `NUMEROS_PERMITIDOS`, o bot responde, para você poder testar com o seu próprio celular.
- Se o WhatsApp da academia estiver desconectado na hora, o bot tenta de novo (10 segundos, 1 minuto e 5 minutos) e depois desiste, deixando o aviso só no Log. Há um teto de 60 avisos por hora para não encher a recepção nem chamar atenção do WhatsApp.
- **Reserva:** o Telegram continua disponível (`TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`) e funciona junto. Vale a pena se quiser ser avisado até quando o WhatsApp da academia cair ou for banido, que são justamente os casos em que o aviso por WhatsApp não chega.
- Em `/health`, o campo `avisos` mostra quantos números e se o Telegram estão ligados.

## Importante

- **Deixe o celular com internet.** Como em qualquer "aparelho conectado", o celular precisa ficar ligado e online de vez em quando, senão o WhatsApp desconecta o bot.
- **A conexão é guardada no disco** (`/data`). Se a Render reiniciar o serviço, ele reconecta sozinho, sem novo QR. Por isso o disco permanente é obrigatório.
- **A página do QR dá controle total do seu WhatsApp.** Nunca compartilhe o endereço com o `token`. Se achar que alguém viu, troque o `ADMIN_TOKEN` na Render.
- **Para desconectar:** no celular, em Aparelhos conectados, remova o aparelho do bot.

## Se o QR não aparecer

- Confira que `WHATSAPP_MODO` está como `qr` e que o serviço está **Live**.
- Veja em `/health` se `whatsapp_status` está como `aguardando_qr`.
- A página recarrega sozinha a cada 5 segundos. Se ficar em "Reconectando", espere um pouco.
- Nos Logs da Render, procure linhas que começam com `[baileys]`.

## Trocar para o modo oficial depois

Se um dia quiser o modo oficial da Meta (mais estável, dentro das regras), troque `WHATSAPP_MODO` para `cloud` e preencha as variáveis do META-WHATSAPP.md. O resto do bot continua igual.
