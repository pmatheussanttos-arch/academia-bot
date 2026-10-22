# Testar o bot sem WhatsApp

Uma página dentro do próprio bot, onde você conversa com o GFIT pelo navegador, como se fosse um cliente. Serve para testar as instruções, os preços e o fluxo de matrícula **sem usar o WhatsApp**, e funciona mesmo com o WhatsApp desconectado.

## Como abrir

1. Abra o atalho da área de trabalho (a página de conexão).
2. Toque na aba **"🧪 Testar"**. A conversa abre ali mesmo (ou toque em **"Abrir em tela cheia"**).

Ou digite direto no navegador, trocando `SEU-ENDERECO` e `SEU_ADMIN_TOKEN`:

```
https://SEU-ENDERECO.onrender.com/teste?token=SEU_ADMIN_TOKEN
```

## Como usar

- Escreva como se fosse o cliente e toque em **Enviar** (ou aperte Enter). Os botões com frases prontas ajudam a começar.
- O GFIT responde como no WhatsApp. Quando ele manda duas mensagens seguidas, aparecem duas bolhas.
- **Nova conversa** apaga tudo e recomeça do zero. Faça isso para testar o início do fluxo ("Olá! Eu sou o GFIT…"), porque senão ele continua a conversa anterior.
- A caixa **Bastidores** mostra o que, no mundo real, aconteceria por trás: os **avisos que a equipe receberia** (atendimento humano, matrícula, pedido de avaliação) e **o que o assistente fez** (consultou horários, registrou matrícula…).

## O que é de verdade e o que é de mentira

| | No teste |
|---|---|
| **A inteligência (Claude)** | **Real.** É ela que está sendo testada, então cada mensagem tem um custo mínimo na sua conta da Claude API. |
| WhatsApp | Não é usado. Nada é enviado a ninguém. |
| Avisos para a equipe | Ficam presos na página. A recepção **não** recebe nada. |
| Agenda do Google | Uma agenda **de mentira**, só na memória. Nada é criado na sua agenda real. |
| Lista de matrículas | A matrícula do teste fica só no teste. Não aparece na sua lista de verdade. |
| Conversas e silêncio | Cada teste é um mundo à parte. Não mexe nos clientes reais. |

Isso é garantido por testes automáticos: um deles vigora a rede e falha se o teste tentar falar com o Google ou com o WhatsApp.

## Cuidados

- **Só funciona com o `ADMIN_TOKEN`.** Quem abrir a página gasta a sua chave de API, por isso ela não é pública.
- **A agenda de mentira começa vazia.** Todos os horários aparecem livres. Para ver "horário ocupado" de verdade, agende duas avaliações no mesmo horário no teste.
- **As conversas de teste somem sozinhas** depois de 2 horas sem uso, ou quando o bot reinicia (por exemplo, num deploy).
- **Pagamento de verdade não existe aqui.** No teste, "pagar no Pix" só mostra a chave: ninguém recebe nada.
- **Se mudar o `instrucoes.md`,** lembre de fazer o Manual Deploy antes de testar. O teste usa as instruções que estão no ar.

## Quando algo sair errado

Anote a frase que você escreveu e o que o bot respondeu (um print resolve) e me mande. O que aparece nos Bastidores ajuda muito a achar a causa.
