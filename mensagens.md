# Mensagens automáticas da GarageFit

Estes são os textos que o bot envia ao cliente quando uma avaliação é agendada, quando um pedido de visita é registrado, quando passa a conversa para uma pessoa (seção "transferencia") e quando registra uma matrícula (seções "matricula-pix" e "matricula-cartao" — é nelas que fica a chave Pix).
A linha {confirmacao} vira o link para a recepção (quando NUMERO_RECEPCAO está preenchido) ou o aviso de que a equipe confirma.
Pode editar o texto à vontade. Mantenha os títulos que começam com "##" e as palavras entre chaves, como {dia} e {hora}:
o bot troca por dados reais. A seção "matricula-paga" é a do cadastro feito depois que o cliente já pagou e mandou o comprovante. As seções "pagamento-cartao" (mensagem com o link; aceita {plano}, {link} e {parcelamento}, que só aparece nos planos VIP), "cartao-recepcao" e "links-pagamento" (um link da InfinitePay por plano) cuidam do pagamento no cartão. A seção "valores" é a mensagem de planos e preços (vai em 3 mensagens curtas: as linhas [[nova mensagem]] separam uma da outra; não apague). A seção "lembrete-avaliacao" é o lembrete do dia anterior (ligado pelo painel, aba Bot); aceita {nome}, {quando} (hoje ou amanhã), {dia} e {hora}. As seções "lembrete-transferida" (cliente transferido que a equipe não respondeu em 2 horas) e "lembrete-parada" (cliente que parou no meio de uma venda, depois de 15 minutos) são as retomadas de conversa (painel, aba Conversas); aceitam {nome}. As linhas {linha_valor} e {linha_mensalidade} vêm das três últimas seções.

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

{pagamento_cartao}

## matricula-paga
Prontinho, {nome}! Seu cadastro está registrado ✅

📋 Plano: {plano}

A recepção vai conferir o seu comprovante e finalizar tudo. Qualquer dúvida, é só chamar! 😊

## cartao-recepcao
O cartão é passado na recepção da academia. Pode vir no seu horário que a equipe finaliza tudo com você. Qualquer dúvida, tô aqui!

## pagamento-cartao
Segue o link para pagar no cartão ({plano}) 👇
{link}
{parcelamento}

É o pagamento seguro da InfinitePay: os dados do cartão você digita só lá, nunca por aqui. Depois de pagar, é só me enviar o comprovante que a recepção confere e finaliza o seu cadastro 😊

## links-pagamento
# Um link da InfinitePay por plano, no formato: chave | endereço. Linha com # na frente fica desligada.
# Plano sem link: o bot diz que o cartão é passado na recepção.
# ATENÇÃO: o valor do link é o que o cliente paga. Confira se bate com o preço do plano.
# ATENÇÃO (conferir): os dois links abaixo cobram R$ 90,00 e R$ 100,00, mas os planos custam R$ 89,90 e R$ 99,90.
3x_por_semana | https://link.infinitepay.io/garagefitacad/VC1DLTEtSQ-jxQLGYnUUJ-90,00
acesso_livre | https://link.infinitepay.io/garagefitacad/VC1DLTEtSQ-CyRHhyOSxh-100,00
trimestral_vip | https://link.infinitepay.io/garagefitacad/VC1DLTMtSQ-xNLN4aIOBC-269,70
semestral_vip | https://link.infinitepay.io/garagefitacad/VC1DLTYtSQ-KEMxUZM0qv-479,40
anual_vip | https://link.infinitepay.io/garagefitacad/VC1DLUMtSQ-htztVZNxF4-838,80

## lembrete-avaliacao
Oi, {nome}! Passando para lembrar da sua avaliação aqui na GarageFit {quando}, às {hora} 😊
Qualquer imprevisto, é só me avisar por aqui. Te esperamos!

## lembrete-transferida
Oi, {nome}! Aqui é o GFIT da GarageFit 😊 Desculpa a demora. Ficou alguma dúvida ou posso te ajudar a finalizar seu agendamento?

## lembrete-parada
Oi, {nome}! Conseguiu ver minha mensagem? Vamos continuar? 😊

## valores
Temos opções que se encaixam no seu momento:

💪 3x por semana — R$ 89,90
💪 Acesso todos os dias — R$ 99,90
[[nova mensagem]]
Mas quem realmente quer resultado escolhe nossos planos VIP, que saem muito mais em conta:

🔥 Trimestral VIP — R$ 89,90/mês
🔥 Semestral VIP — R$ 79,90/mês
🔥 Anual VIP — R$ 69,90/mês
[[nova mensagem]]
✅ Todos com acesso livre
✅ Avaliação gratuita (nos 3 planos VIP)
✅ Convidado grátis (15 dias no Trimestral | 1 meses no Anual)

Qual desses encaixa melhor no seu objetivo? 💪🏼
