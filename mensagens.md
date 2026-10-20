# Mensagens automáticas da GarageFit

Estes são os textos que o bot envia ao cliente quando uma avaliação é agendada, quando um pedido de visita é registrado e quando passa a conversa para uma pessoa (seção "transferencia").
A linha {confirmacao} vira o link para a recepção (quando NUMERO_RECEPCAO está preenchido) ou o aviso de que a equipe confirma.
Pode editar o texto à vontade. Mantenha os títulos que começam com "##" e as palavras entre chaves, como {dia} e {hora}:
o bot troca por dados reais. As linhas {linha_valor} e {linha_mensalidade} vêm das três últimas seções.

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
