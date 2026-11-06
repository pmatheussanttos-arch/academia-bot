# Campanhas com data (Black GarageFit)

O texto da campanha fica no arquivo **`campanha.md`**. O bot lê esse arquivo a cada conversa:

- **Entra sozinho** no dia `inicio` (02/11/2026) e **sai sozinho** depois do `fim` (30/11/2026). Não precisa de novo deploy no dia 30 nem no dia 1º.
- A **semana final** (a partir de `semana-final`, 23/11) e o **último dia** (30/11) avisam o bot para usar as mensagens 7 e 8.
- Depois do fim, até `encerrada-ate` (31/12), o bot só usa o texto da seção `## encerrada` ("a Black acabou, mas posso te mostrar a melhor opção hoje"). Depois dessa data o arquivo é ignorado.
- Durante a campanha, o texto vale **mais** do que as regras antigas: o bot não usa a lista padrão de valores (a ferramenta `enviar_valores` manda seguir a campanha) e pula a apresentação inicial para quem veio da Black.

## Como o bot abre a conversa na campanha

- Quem escreve **BLACK** (ou fala da promoção, do story, do anúncio): vai direto para a oferta (mensagens 0, 1 e 2).
- Quem chega com "Oi", "Boa tarde" ou "qual o valor?": o bot se apresenta e **pergunta se a pessoa quer conhecer a promoção** (mensagem A). Se ela quiser, segue a oferta; se não, responde o que ela perguntou, sem insistir.
- As mensagens-modelo são roteiro: o bot responde primeiro o que a pessoa perguntou e não repete pergunta já respondida.

## Para trocar o texto ou as datas

Edite o `campanha.md` (as datas no começo e as seções `## campanha` e `## encerrada`) e faça o **Manual Deploy**. Arquivo sem o formato certo é ignorado, e o bot continua funcionando sem campanha. Para uma campanha nova, troque as datas e os textos.

## Como testar

Aba **Testar** do painel: escreva "BLACK". O bot deve responder com a mensagem 0 ou 1 (pedindo o nome e o objetivo), sem a apresentação padrão, e depois mostrar só o Semestral e o Anual VIP.

## Pontos que a equipe precisa saber

- O bot **envia o link de pagamento ele mesmo** (os links do Semestral e do Anual estão no `mensagens.md`) e anota na matrícula se o plano começa agora ou em janeiro. Os textos que diziam "a equipe te envia o link" foram trocados por "eu te envio".
- A avaliação física pode ser marcada com até **90 dias** de antecedência (antes eram 14), para quem começa só em janeiro. O dia exato de janeiro o bot não sabe: ele diz que a equipe confirma.
- Sobre aluno atual e a mensalidade que ele já pagou, o bot responde "a equipe confirma com você", como pedido.
