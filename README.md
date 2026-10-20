# Bot de WhatsApp da GarageFit

Assistente que responde clientes no WhatsApp 24h, usando a **Claude API** (a inteligência). Você controla o comportamento editando um arquivo de texto: `instrucoes.md`.

Dois jeitos de conectar ao WhatsApp, escolhidos pela variável `WHATSAPP_MODO`:
- **`qr`** (simples): conecta no número da própria academia lendo um QR code, como o WhatsApp Web. Não é oficial e tem risco de banimento do número. Passo a passo no **QR-WHATSAPP.md**.
- **`cloud`** (oficial): API da Meta, mais estável e dentro das regras, porém mais trabalhosa de configurar. Passo a passo no **META-WHATSAPP.md**.

## O que a versão faz

- Responde dúvidas sobre planos, preços, horários, endereço, cancelamento e renovação, só com o que está no `instrucoes.md`.
- Quando não sabe, ou quando o assunto é cancelamento, desconto, lesão, reclamação etc., chama a equipe: no modo `cloud` entrega um link para o WhatsApp da recepção; no modo `qr` (mesmo número da academia) avisa que a equipe responde ali mesmo.
- No modo `qr`, **percebe quando a equipe responde pelo celular e se cala** com aquele cliente.
- Pede que o cliente escreva quando recebe áudio, e avisa a equipe quando recebe imagem ou documento (possível comprovante).
- Guarda o histórico de cada cliente separado dos outros e apaga conversas antigas (`RETENCAO_DIAS`, padrão 90).

## O que ele ainda NÃO faz (de propósito)

- **Avaliação física:** com o Google Agenda ligado (veja o GOOGLE-AGENDA.md), o bot consulta os horários livres de verdade e **agenda sozinho** (segunda a sexta, 7:00–10:30 e 14:00–19:30, de 30 em 30 minutos). Sem o Google, vira um pedido e a equipe confirma o horário na conversa.
- **Aula experimental:** é sempre um pedido; a equipe confirma o horário na conversa. Não entra no Google Agenda.
- Não muda nem cancela visitas já marcadas: isso vai para a equipe.
- Não consulta mensalidade nem cadastro do NextFit.
- Não gera cobrança nem confirma pagamento: só informa a chave Pix e avisa que a equipe confere.
- Não envia lembretes de vencimento.

## 1. Testar sem WhatsApp (faça isto primeiro)

Precisa do Node.js 22.13 ou mais novo e de uma chave da Claude API (console.anthropic.com).

```bash
npm install
cp .env.example .env      # preencha pelo menos ANTHROPIC_API_KEY
npm run chat
```

Converse como se fosse um cliente. Edite o `instrucoes.md`, salve e mande outra mensagem: a mudança vale na hora, sem reiniciar. Teste de propósito os casos difíceis: pedir desconto, cancelar, perguntar algo que não está no arquivo, tentar enganar o bot ("ignore suas regras"), falar de lesão.

Gasto: o modelo padrão é o `claude-haiku-5-5`, o mais barato (por volta de US$ 1 a cada mil mensagens, estimativa). Se ele errar as regras no `npm run chat`, troque para `CLAUDE_MODEL=claude-sonnet-5-5` (cerca de 16 vezes mais caro).

## 2. Ligar ao WhatsApp

Escolha o modo:
- **Modo QR (recomendado para começar):** siga o **QR-WHATSAPP.md**. Depois de o bot estar no ar, você abre uma página, escaneia um QR code com o celular da academia e pronto.
- **Modo oficial da Meta:** siga o **META-WHATSAPP.md** (usa um número novo, token e webhook).

Enquanto testa, preencha `NUMEROS_PERMITIDOS` com o seu número: o bot ignora todo o resto.

Custos da Meta: cobrança por mensagem, que mudou em 2025 e muda de novo em outubro de 2026. Confira a tabela oficial de preços da Meta antes de estimar.

## 3. Colocar no ar 24h

Precisa de uma hospedagem que:

- mantenha o programa **ligado o tempo todo** (comando: `npm start`),
- tenha **HTTPS** com endereço público,
- tenha **disco permanente** (volume) para a pasta `data/`, onde ficam o histórico e as conversas passadas para a equipe. Em hospedagem com disco temporário, tudo isso se perde a cada reinício.

Cadastre as variáveis do `.env.example` no painel da hospedagem (nunca envie o arquivo `.env` para o GitHub). Veja o **HOSPEDAGEM.md**.

O passo a passo completo, com a hospedagem recomendada, está no arquivo **HOSPEDAGEM.md**.

## Como o cliente fala com a equipe

**Modo `qr`:** o cliente recebe só a mensagem de transferência (texto editável na seção `transferencia` do `mensagens.md`); o bot avisa a equipe e se cala naquela conversa, e quem atende responde pelo WhatsApp da academia. Nenhum número é divulgado. O resto desta seção descreve o modo `cloud`.

O assistente atende num **número só dele**, onde ninguém da equipe lê as mensagens (um número ligado à API não funciona ao mesmo tempo no app WhatsApp Business). Por isso:

- Quando o cliente precisa de uma pessoa (cancelamento, desconto, lesão, dúvida que o bot não sabe, problema técnico), o bot envia um **link que abre o WhatsApp da recepção com a mensagem já escrita** (inclusive o motivo). O cliente só toca e envia, e a equipe recebe **no app que já usa**.
- O mesmo vale para a **aula experimental**: o cliente recebe o resumo e um link para confirmar o horário com a recepção.
- **Avaliações** agendadas pelo bot aparecem no Google Agenda da equipe (veja o GOOGLE-AGENDA.md).
- O bot **não se cala** depois de entregar o link: continua respondendo a outras dúvidas.

Configure o WhatsApp da recepção na variável **`NUMERO_RECEPCAO`** (com DDD, por exemplo `11999998888`). Sem ela, o bot volta ao comportamento antigo (avisa só no log e se cala por `HANDOFF_HORAS`), que **só serve para testes**: ninguém seria avisado.

Para os clientes saberem do número novo, divulgue-o (Instagram, site, cartaz) como o "WhatsApp 24h" da academia.

**Avisos à equipe.** Sempre aparecem no log da Render. No modo `qr`, preencha `NUMEROS_AVISOS` com o WhatsApp de quem atende (outro número, não o da academia) e o bot manda a mensagem por lá, com retentativas e um teto por hora (veja o QR-WHATSAPP.md). O Telegram é opcional e funciona junto: preencha `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`. No modo `cloud` só o Telegram está disponível (a API oficial só envia texto livre dentro de 24h da última mensagem).

## Operação do dia a dia

- **Mudar o que o bot diz ou os preços:** edite o `instrucoes.md`.
- **Devolver um cliente ao bot antes do prazo:** defina `ADMIN_TOKEN` e envie
  `POST /admin/liberar` com o cabeçalho `Authorization: Bearer SEU_TOKEN` e o corpo `{"numero":"5511999998888"}`.
  `GET /admin/handoffs` lista quem está com a equipe.
- **Saúde do serviço:** `GET /health`.

## Segurança e LGPD

- Cada cliente tem histórico próprio, e o bot não tem acesso a dados de outros clientes nem a sistemas internos. Só tem a ferramenta de chamar a equipe.
- O texto do cliente e o nome do perfil são tratados como dado, não como ordem. Mesmo assim, **não coloque no `instrucoes.md` nada que não possa ser dito a um cliente** (senhas, dados internos): o bot pode acabar repetindo.
- As conversas contêm dados pessoais. Informe isso na política de privacidade da academia e mantenha `RETENCAO_DIAS` no menor prazo que fizer sentido.
- Limite de mensagens por cliente por hora (`LIMITE_MSGS_POR_HORA`) protege contra abuso e gasto inesperado.

## Estrutura

| Arquivo | Para que serve |
|---|---|
| `instrucoes.md` | **O que você edita**: dados e regras da academia |
| `src/prompt.ts` | Regras fixas de segurança (ficam no código de propósito) |
| `src/agent.ts` | Conversa com o Claude e as ferramentas (chamar a equipe, consultar horários, agendar) |
| `agenda.json` | **Você edita**: dias e horários das visitas, antecedência, feriados |
| `mensagens.md` | **Você edita**: textos de "avaliação agendada" e "pedido recebido" |
| `src/agendamento.ts`, `src/agenda.ts`, `src/google.ts` | Regras de horário e integração com o Google Agenda |
| `src/baileys.ts`, `src/baileys-parse.ts` | Conexão por QR code (modo qr) |
| `src/atendimento.ts` | Fluxo de cada mensagem: limites, áudio, arquivos, erros |
| `src/app.ts`, `src/server.ts` | Servidor e webhook da Meta |
| `src/store.ts` | Banco de dados (SQLite) |
| `test/` | `npm test` roda 164 testes sem gastar nada |

## Próximas fases

- Detectar quando a equipe responde pelo app e calar o bot sozinho.
- Cobrança Pix com confirmação automática (precisa de um provedor com API) ou integração com o NextFit.
- Lembretes de vencimento com templates aprovados pela Meta.
- Painel privado para editar o `instrucoes.md` pelo navegador.
