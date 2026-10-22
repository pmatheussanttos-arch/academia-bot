# Painel do dono

Abra o **atalho da área de trabalho** (o mesmo de sempre, o endereço `/conectar?token=SUA_SENHA`). Se o WhatsApp estiver conectado, abre na aba **Hoje**; se estiver desconectado, abre na aba **Bot**, onde aparece o QR code.

No topo de todas as abas há um selo verde ou vermelho com o estado do WhatsApp. Os números vermelhos nas abas são coisas esperando por você.

## As abas

### 📅 Hoje
- **Precisa de atenção:** o que está pendente (WhatsApp caído, cliente esperando a equipe, matrículas para lançar, avaliações sem anotação, gasto alto). Toque na linha para ir direto ao assunto. Se não há nada, aparece "Tudo em ordem".
- **Avaliações de hoje**, de todas as origens, com o selo de quem marcou. As que já começaram têm os botões **Veio / Faltou / Matriculou**.
- **Pausar o assistente** (1 hora, 4 horas ou até você reativar).

### 🗓️ Avaliações
- Quantas avaliações no mês e na semana (já passaram e ainda vêm). **Conta todas as avaliações da agenda do Google**, não só as que o assistente marcou.
- **Quem marcou:** assistente, recepção (a lista), página dos professores ou direto na agenda.
- Dias da semana e horários mais usados.
- **Agenda cheia?** Quantos horários dos próximos 14 dias já estão ocupados.
- Próximas avaliações, **quem veio e quem faltou** (taxa de faltas e de quem matriculou) e as avaliações passadas que ninguém anotou ainda.
- O link da agenda dos professores.

### 💰 Vendas
- **Funil do mês:** conversas novas → avaliações → matrículas fechadas pelo WhatsApp. *Só conta o que fechou pela conversa; quem fecha na recepção depois da avaliação não entra aqui (use o botão "Matriculou" nas avaliações para isso).*
- **Matrículas para lançar:** os dados de cada cliente e o botão **✅ Já lancei na plataforma**. Quando você toca, ela sai da lista de pendentes (e fica em "Já lançadas", com opção de desfazer).

### 💬 Conversas
- **Esperando a equipe:** clientes que o bot passou para vocês e ninguém respondeu. Passou de 15 minutos fica vermelho.
- Conversas com a equipe (e o botão para devolver ao bot).
- **O bot dá conta sozinho?** Quantas conversas novas, quantas pediram a equipe e a % resolvida só pelo bot.
- **O que o bot não soube responder:** as perguntas em que ele disse "essa informação eu não tenho". Para ele aprender, escreva a resposta no `instrucoes.md`.
- Horários em que os clientes mais escrevem.

### 🤖 Bot
- Conexão com o WhatsApp e o QR code (a página se atualiza sozinha enquanto falta conectar).
- Pausar / reativar.
- **Saúde:** se o WhatsApp está conectado mas há cliente sem resposta há mais de 10 minutos, aparece "o bot pode estar mudo".
- **Gasto estimado com a IA:** hoje, no mês, previsão do mês e por conversa.
- **Rotinas automáticas** (veja abaixo).
- O endereço para o monitor de queda (UptimeRobot).

### 🧪 Testar
Conversa de teste com o GFIT, sem WhatsApp. Nada vai para clientes, para a agenda nem para a lista de matrículas.

## Rotinas automáticas (aba Bot)

| Rotina | Padrão | O que faz |
|---|---|---|
| Resumo da semana | **Ligado** | Toda segunda, depois das 8h, manda no WhatsApp dos números de aviso o balanço da semana que passou (avaliações, quem veio, matrículas, conversas, gasto). Só vai para a equipe. |
| Lembrete ao cliente | **Desligado** | Entre 17h e 20h do dia anterior, lembra o cliente da avaliação. |
| Aviso de gasto | Ligado (limite R$ 50) | Avisa a equipe a 80% e a 100% do limite do mês. Mude com `GASTO_LIMITE_MENSAL` na Render (0 desliga). |

**Sobre o lembrete ao cliente (leia antes de ligar):** é mensagem automática saindo do número da academia, e isso aumenta um pouco o risco de o WhatsApp estranhar e bloquear o número. Por isso ele:
- começa **desligado**;
- só manda para quem **já conversou com o bot**;
- manda no máximo 30 por dia, com pausa entre uma e outra;
- não manda se o bot estiver pausado, se a equipe estiver na conversa ou se o WhatsApp estiver desconectado;
- manda uma vez só por avaliação.

O texto fica no `mensagens.md`, na seção `lembrete-avaliacao` (aceita `{nome}`, `{dia}` e `{hora}`).

## Limites que você precisa saber

- **O gasto é uma estimativa**, calculada pelo uso que o bot anotou e por uma tabela de preços. O valor de verdade está em console.anthropic.com. As conversas da aba Testar também entram na conta, porque gastam de verdade.
- O funil só enxerga o que passou pelo WhatsApp do bot.
- Os números começam a ser guardados a partir do momento em que esta versão entra no ar: o histórico anterior (conversas, transferências, gasto) não existia e não dá para reconstruir. As avaliações vêm do Google e já aparecem completas.
- Nas avaliações antigas criadas à mão pela agenda do Google, o bot não sabe o WhatsApp do cliente, então elas não entram no cruzamento "avaliação → matrícula".
