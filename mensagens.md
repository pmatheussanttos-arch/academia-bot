# Mensagens automáticas da GarageFit

Estes são os textos que o bot envia ao cliente quando uma avaliação é agendada, quando um pedido de visita é registrado, quando passa a conversa para uma pessoa (seção "transferencia") e quando registra uma matrícula (seções "matricula-pix" e "matricula-cartao" — é nelas que fica a chave Pix).
A linha {confirmacao} vira o link para a recepção (quando NUMERO_RECEPCAO está preenchido) ou o aviso de que a equipe confirma.
Pode editar o texto à vontade. Mantenha os títulos que começam com "##" e as palavras entre chaves, como {dia} e {hora}:
o bot troca por dados reais. A seção "lembrete-avaliacao" é o lembrete do dia anterior (ligado pelo painel, aba Bot); aceita {nome}, {dia} e {hora}. As seções "lembrete-transferida" (cliente transferido que a equipe não respondeu em 2 horas) e "lembrete-parada" (cliente que parou no meio de uma venda, depois de 3 horas) são as retomadas de conversa (painel, aba Conversas); aceitam {nome}. As linhas {linha_valor} e {linha_mensalidade} vêm das três últimas seções.

## avaliacao-agendada
Perfeito! Avaliação agendada! ✅

📅 {dia}
⏰ {hora}
📍 Av. Dr. Carlos Soares (Rua Nova), 433 – Centro (em frente ao INSS)
🥋 Venha com roupa de treino
⏱️ 20 a 30 minutos

{linha_valor}
{linha_mensalidade}

Qualquer dúvida, tô aqui!
Te espero 💪🔥

## avaliacao-pedido
Perfeito! Pedido de avaliação recebido! ✅

📅 {dia}
⏰ {hora}
📍 Av. Dr. Carlos Soares (Rua Nova), 433 – Centro (em frente ao INSS)
🥋 Venha com roupa de treino
⏱️ 20 a 30 minutos

{linha_valor}
{linha_mensalidade}

{confirmacao}

Qualquer dúvida, tô aqui!
Te espero 💪🔥

## experimental-pedido
Perfeito! Pedido de aula experimental recebido! ✅

📅 {dia}
⏰ {hora}
📍 Av. Dr. Carlos Soares (Rua Nova), 433 – Centro (em frente ao INSS)
🥋 Venha com roupa de treino
⏱️ 20 a 30 minutos

💰 A aula experimental é gratuita!

{confirmacao}

Qualquer dúvida, tô aqui!
Te espero 💪🔥

## linha-valor-pago
💰 Valor da avaliação: R$ 35,00 (pago no ato).

## linha-valor-vip
💰 Avaliação gratuita nos planos VIP.

## linha-mensalidade
📌 A mensalidade é paga junto com a avaliação no primeiro mês — ou seja, você já inicia com tudo certo.

## confirmacao-recepcao
👉 Para garantir o seu horário, toque no link e envie a mensagem que já está pronta para a nossa recepção:
{link}

## confirmacao-equipe
Nossa equipe confirma o seu horário por aqui em seguida.

## transferencia
Ok, vou te transferir para um atendente. Aguarde um instante, que já vai te responder! 😊

## matricula-pix
Prontinho, {nome}! Seu cadastro já está registrado aqui ✅

📋 Plano: {plano}

Para garantir, é só fazer o Pix:
🔑 Chave (CNPJ): 35.950.235/0001-29
🏢 GarageFit Academia

Depois me manda o comprovante por aqui que a recepção confere e finaliza o seu cadastro. Qualquer dúvida, tô aqui!

## matricula-cartao
Prontinho, {nome}! Seu cadastro já está registrado aqui ✅

📋 Plano: {plano}
💳 Pagamento no cartão

O cartão é passado na recepção da academia. Pode vir no seu horário que a equipe finaliza tudo com você. Qualquer dúvida, tô aqui!

## lembrete-avaliacao
Oi, {nome}! Passando para lembrar da sua avaliação aqui na GarageFit: {dia}, às {hora} 😊
Qualquer imprevisto, é só me avisar por aqui. Te esperamos!

## lembrete-transferida
Oi, {nome}! Aqui é o GFIT da GarageFit 😊 Desculpa a demora. Ficou alguma dúvida ou posso te ajudar a finalizar seu agendamento?

## lembrete-parada
Oi, {nome}, conseguiu ver? Posso te ajudar a finalizar?
