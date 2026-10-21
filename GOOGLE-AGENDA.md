# Ligar o Google Agenda (avaliações agendadas pelo bot)

**Sem isto o bot funciona normalmente em modo manual:** registra o pedido e a equipe confirma o horário na conversa. Ligue o Google Agenda quando o bot já estiver no ar.

## O que muda quando está ligado

- O bot consulta a agenda e **só oferece horários realmente livres** para a **avaliação física**.
- Quando o cliente escolhe, o bot cria o evento **"Avaliação — Nome"** na agenda e responde "Avaliação agendada! ✅" na hora.
- A equipe vê o evento no Google Agenda do celular. **Se apagar o evento, o horário volta a ficar livre** e o cliente pode marcar outro. O bot não avisa o cliente sozinho: quem apaga fala com ele.
- **Aula experimental não entra na agenda**: continua sendo um pedido que a equipe confirma na conversa.
- Se o Google estiver fora do ar ou der erro, o bot não deixa o cliente sem resposta: registra um pedido e avisa que a equipe confirma (e o aviso aparece no log).

## Regras que o bot segue

- A grade vem do arquivo `agenda.json`: segunda a sexta, 7:00–10:30 e 14:00–19:30, de 30 em 30 minutos, uma avaliação por horário, com pelo menos 60 minutos de antecedência e até 14 dias à frente.
- **Qualquer evento da agenda que esteja no horário ocupa a vaga**, mesmo que não seja uma avaliação (reunião, por exemplo). Se quiser que um evento não bloqueie, marque-o como **"Livre"** em vez de "Ocupado".
- **Para fechar um dia inteiro** (feriado, manutenção), crie na agenda um evento de **dia inteiro** com a palavra **"Fechado"** no título. Outros eventos de dia inteiro (aniversários, lembretes) são ignorados.
- Cada cliente só pode ter **uma** avaliação marcada pelo bot ao mesmo tempo.
- **Para não encher o chat de horários**, o bot pergunta antes o período do dia ("Prefere de manhã, à tarde ou à noite?"), a não ser que o cliente já tenha dito o período ou um horário. Depois mostra só 3 ou 4 opções daquele período. Se o período estiver cheio, ele sugere os outros. As faixas ficam em `agenda.json`, em `periodos` (padrão: manhã até 11:59, tarde de 12:00 a 17:59, noite a partir de 18:00).

## Passo a passo

> **Aviso:** escrevi isto sem acesso às telas do Google. Os nomes dos menus podem ter mudado. Se algo não bater, me mande um print.

**1. Crie uma agenda de teste.** No Google Agenda (calendar.google.com), em "Outras agendas", clique em **+ > Criar nova agenda** e chame de "Teste do bot". Teste tudo nela antes de usar a agenda real.

**2. Crie a "conta de serviço" (o robô que acessa a agenda).**

1. Entre em console.cloud.google.com com a conta Google da academia e crie um **projeto** (o nome não importa).
2. No menu, vá em **APIs e serviços > Biblioteca**, procure **Google Calendar API** e clique em **Ativar**.
3. Vá em **IAM e administrador > Contas de serviço > Criar conta de serviço**. Dê um nome (ex.: `bot-garagefit`) e conclua sem marcar permissões.
4. Abra a conta criada, aba **Chaves > Adicionar chave > Criar nova chave > JSON**. O navegador baixa um arquivo `.json`. **Guarde-o como uma senha**: quem tem esse arquivo acessa a agenda.
5. Anote o e-mail da conta de serviço (termina em `.iam.gserviceaccount.com`).

Contas Google Workspace (de empresa) às vezes bloqueiam a criação de chaves por política da organização. Com Gmail comum isso normalmente não acontece.

**3. Compartilhe a agenda com o robô.** No Google Agenda, ao lado da agenda "Teste do bot", clique em **Configurações e compartilhamento > Compartilhar com pessoas e grupos > Adicionar pessoas**, cole o e-mail da conta de serviço e escolha a permissão **"Fazer alterações em eventos"**.

**4. Copie o ID da agenda.** Na mesma tela, role até **Integrar agenda** e copie o **ID da agenda** (para agendas criadas à parte, algo como `abc123@group.calendar.google.com`; para a agenda principal, o próprio e-mail).

**5. Cadastre as duas variáveis** (na Render: aba **Environment**; no teste local: arquivo `.env`):

| Variável | Valor |
|---|---|
| `GOOGLE_CALENDAR_ID` | o ID do passo 4 |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | o **conteúdo inteiro** do arquivo `.json` do passo 2 (abra no Bloco de Notas, copie tudo e cole) |

Nunca coloque esse conteúdo no GitHub nem mande por conversa.

**6. Teste.** Depois do deploy, abra `/health` do bot: deve mostrar `"agenda":"google"`. Do celular de teste, peça uma avaliação pelo WhatsApp e veja o evento "Avaliação — Nome" aparecer na agenda. Apague os eventos de teste depois. Para ver o que o bot fez, abra os **Logs** da Render e procure `agente`: cada consulta aparece como `[agente] consultar_horarios(avaliacao_fisica, 2026-10-22) -> Horários livres…` (ou o erro, se o Google falhar). Se a conversa não mostrar nenhuma linha `[agente]`, o modelo não chamou a ferramenta.

**7. Troque para a agenda real.** Repita os passos 3 e 4 para a agenda das avaliações e troque o `GOOGLE_CALENDAR_ID`.

## Agenda para os professores

Com o Google ligado, a equipe também pode marcar, desmarcar e remarcar avaliações numa página do navegador, na mesma agenda. Veja o **AGENDA-PROFESSORES.md**.

## Desligar sem apagar nada

Defina `AGENDAMENTO_AUTOMATICO=0`. O bot volta ao modo manual na hora, mantendo as credenciais guardadas.

## Privacidade

A agenda passa a guardar **nome e WhatsApp** dos clientes. Todos que têm acesso a essa agenda os veem. Revise quem a recebe compartilhada e inclua isso na política de privacidade da academia.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| O servidor não sobe e fala de `GOOGLE_...` | Só uma das duas variáveis foi preenchida, ou o JSON foi colado incompleto |
| `/health` mostra `"agenda":"manual"` | Google não configurado, ou `AGENDAMENTO_AUTOMATICO=0` |
| Log: `Invalid JWT Signature` ou `invalid_grant` | Chave colada errada: copie o arquivo `.json` inteiro de novo |
| Log: `Not Found` ao listar eventos | `GOOGLE_CALENDAR_ID` errado, ou a agenda não foi compartilhada com o e-mail da conta de serviço |
| Log: `Forbidden`/`insufficient permissions` | A permissão no compartilhamento não é "Fazer alterações em eventos", ou a Calendar API não foi ativada no projeto |
| A agenda compartilhada não aparece na lista do robô | Normal: o Google não coloca agendas compartilhadas na lista de uma conta de serviço. O que vale é o `GOOGLE_CALENDAR_ID` estar certo e o compartilhamento ter a permissão "Fazer alterações em eventos" |
| O bot oferece um horário que a equipe já usou | O evento da equipe está na **outra** agenda (o bot só lê a agenda do `GOOGLE_CALENDAR_ID`) |
| Os horários parecem deslocados | Fuso horário em `agenda.json` (`fusoHorario`) |
