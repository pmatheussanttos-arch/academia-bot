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
- **Retomada de conversas:** os dois interruptores (veja abaixo) e a lista de **quem recebeu lembrete** (nome, telefone, motivo, quando, texto e se foi enviado).

### 🤖 Bot
- Conexão com o WhatsApp e o QR code (a página se atualiza sozinha enquanto falta conectar).
- Pausar / reativar.
- **Saúde:** se o WhatsApp está conectado mas há cliente sem resposta há mais de 10 minutos, aparece "o bot pode estar mudo".
- **Gasto estimado com a IA:** hoje, no mês, previsão do mês e por conversa.
- **Rotinas automáticas** (veja abaixo).
- O endereço para o monitor de queda (UptimeRobot).

### 🧪 Testar
Conversa de teste com o GFIT, sem WhatsApp. Nada vai para clientes, para a agenda nem para a lista de matrículas.

## Quem veio e quem faltou: pode marcar no Google Agenda

Os professores podem marcar direto no Google Agenda, escrevendo no fim do título do evento: `✅` (veio), `❌` (faltou) ou `🏋️` (veio e matriculou), ou as palavras `veio`, `faltou`, `matriculou`. O painel lê isso sozinho (a leitura da agenda é guardada por 1 minuto). Marcar pelo painel também escreve o selo no título, então os dois lugares ficam iguais. Se discordarem, vale o Google. Detalhes no AGENDA-PROFESSORES.md.

## Rotinas automáticas (aba Bot)

| Rotina | Padrão | O que faz |
|---|---|---|
| Resumo da semana | **Ligado** | Toda segunda, depois das 8h, manda no WhatsApp dos números de aviso o balanço da semana que passou (avaliações, quem veio, matrículas, conversas, gasto). Só vai para a equipe. |
| Lembrete da avaliação | **Desligado** | Lembra o cliente da avaliação **cerca de 4 horas antes, no mesmo dia** (a partir das 7h e nunca com menos de 1 hora de antecedência). As avaliações da manhã cedo, em que 4 horas antes seria de madrugada, são lembradas na **véspera, entre 17h e 20h**. |
| Aviso de gasto | Ligado (limite R$ 50) | Avisa a equipe a 80% e a 100% do limite do mês. Mude com `GASTO_LIMITE_MENSAL` na Render (0 desliga). |

**Sobre o lembrete ao cliente (leia antes de ligar):** é mensagem automática saindo do número da academia, e isso aumenta um pouco o risco de o WhatsApp estranhar e bloquear o número. Por isso ele:
- começa **desligado**;
- só manda para quem **já conversou com o bot**;
- manda no máximo 30 por dia, com pausa entre uma e outra;
- não manda se o bot estiver pausado, se a equipe estiver na conversa ou se o WhatsApp estiver desconectado;
- manda uma vez só por avaliação.

O texto fica no `mensagens.md`, na seção `lembrete-avaliacao` (aceita `{nome}`, `{dia}` e `{hora}`).

## Conversas paradas: aviso à equipe e lembrete ao cliente

**Aviso à equipe (ligado por padrão):** se o bot transfere um cliente para a equipe e ninguém responde em **30 minutos**, ele manda no WhatsApp dos números de aviso: nome, número, última mensagem do cliente, motivo e há quanto tempo espera. É **um aviso só** por transferência (não há segundo aviso), além do aviso que já chega na hora da transferência. Só com a academia funcionando (seg a sex 5h–12h e 14h–21h, sáb 8h–11h; o horário fica no `agenda.json`, em `funcionamento`).

**Lembrete ao cliente (desligado por padrão, com interruptor na aba Conversas):** uma mensagem curta, **no máximo uma por conversa**:
- cliente **transferido e sem resposta da equipe há 2 horas**: "Oi, [nome]! Aqui é o GFIT da GarageFit 😊 Desculpa a demora. Ficou alguma dúvida ou posso te ajudar a finalizar seu agendamento?", e a conversa volta para o bot;
- cliente que **parou no meio de uma venda há 15 minutos** (o bot perguntou algo sobre plano, preço ou agendamento e ele sumiu): "Oi, [nome]! Conseguiu ver minha mensagem? Vamos continuar? 😊".

Os textos ficam no `mensagens.md` (`lembrete-transferida` e `lembrete-parada`). O `[nome]` é o que o cliente **disse** ao bot (nunca o do perfil do WhatsApp); sem nome, a mensagem sai sem ele.

Limites (por causa do risco de bloqueio no modo QR):
- só para quem escreveu nas **últimas 24 horas**;
- só com a academia funcionando e **entre 8h e 20h**;
- **intervalo aleatório de 1 a 5 minutos** entre mensagens e no máximo **10 automáticas por dia** (somando com o lembrete de avaliação);
- **nunca** para quem escreveu "pare", "não quero", "sem interesse" e parecidos, nem para os números da equipe, nem para grupos;
- se a equipe respondeu no meio-tempo, ou o cliente já agendou ou matriculou, não manda nada;
- não manda com o bot pausado nem com o WhatsApp desconectado.

"Parou no meio de uma venda" é uma **estimativa**: o bot olha se a conversa falou de plano, preço, avaliação ou horário e terminou numa pergunta dele. Pode errar nos dois sentidos.

## Como o bot trata o pagamento e a transferência

- **Comprovante (imagem ou documento) no modo QR:** o bot **não se cala nem faz perguntas**. A equipe recebe um aviso ("📎 Cliente enviou...") e o bot responde só: "Recebi a imagem! 😊 A equipe vai dar uma olhada e já te retorna." (texto editável no `mensagens.md`, seção `arquivo-recebido`). Ele não pede nome nem dados e nunca diz que o pagamento foi confirmado. Se o cliente continuar escrevendo, o bot responde normalmente.
- **Cliente transferido que escreve 2 vezes** sem a equipe responder: o bot volta a atender. Se uma pessoa da equipe já assumiu a conversa, o bot não volta por esse caminho.
- **Retomada de conversa parada:** se o cliente não responde em **15 minutos** no meio de uma venda, o bot manda "conseguiu ver minha mensagem? Vamos continuar?" (interruptor na aba Conversas, desligado por padrão).

## Limites que você precisa saber

- **O gasto é uma estimativa**, calculada pelo uso que o bot anotou e por uma tabela de preços. O valor de verdade está em console.anthropic.com. As conversas da aba Testar também entram na conta, porque gastam de verdade.
- O funil só enxerga o que passou pelo WhatsApp do bot.
- Os números começam a ser guardados a partir do momento em que esta versão entra no ar: o histórico anterior (conversas, transferências, gasto) não existia e não dá para reconstruir. As avaliações vêm do Google e já aparecem completas.
- Nas avaliações antigas criadas à mão pela agenda do Google, o bot não sabe o WhatsApp do cliente, então elas não entram no cruzamento "avaliação → matrícula".
