# Conectar o WhatsApp por QR code (modo simples)

Neste modo o assistente conecta ao **número da própria academia** lendo um QR code, igual ao WhatsApp Web. Não precisa de app da Meta, token nem número novo.

## ⚠️ Leia antes de decidir

Este método **não é oficial** e **vai contra as regras do WhatsApp**. O número pode ser **banido**, sem aviso e sem recurso. Não dá para saber quando. Você aceitou esse risco. Mesmo assim, deixo o conselho: o dia em que o WhatsApp banir, a academia fica sem o canal. Tenha um plano B (um segundo número, ou migrar para o modo oficial mais tarde). O código já suporta os dois modos.

Outra limitação: essas conexões quebram de tempos em tempos quando o WhatsApp muda algo, e aí alguém técnico precisa atualizar a biblioteca.

## Como a equipe atende junto

Como o bot está no **mesmo número** da academia, a equipe continua usando o WhatsApp normalmente no celular. Quando a equipe responde um cliente pelo celular, **o bot percebe e se cala** com aquele cliente por algumas horas (`HANDOFF_HORAS`, padrão 6). Quando o bot não sabe algo, ele avisa que a equipe vai responder, e a equipe vê a conversa no próprio aparelho.

## Passo a passo

**1. Coloque o bot no ar** seguindo o HOSPEDAGEM.md, com estas variáveis na Render:

| Variável | Valor |
|---|---|
| `WHATSAPP_MODO` | `qr` |
| `ANTHROPIC_API_KEY` | sua chave da Claude API |
| `ADMIN_TOKEN` | uma senha longa que você inventa (protege a página do QR) |
| `NUMEROS_PERMITIDOS` | seu celular, com DDD (enquanto testa) |

No modo QR você **não precisa** das variáveis `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` nem `NUMERO_RECEPCAO`.

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
