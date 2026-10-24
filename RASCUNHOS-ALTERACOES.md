# Rascunhos de alterações

**Situação:** o item 1 (mensagem de valores) já foi aplicado no bot. O item 2 (pagamento por cartão) ainda é só ideia.

Aqui ficam as mudanças combinadas com o Matheus. Este arquivo não afeta o bot: serve para juntar as ideias e aplicar quando o Matheus mandar. O texto vivo da mensagem de valores fica no `mensagens.md` (seção `valores`).

---

## 1. Mensagem de valores (24/10/2026) — APLICADA em 24/10/2026

**Quando usar:** depois que o cliente responde se quer treinar 3x por semana ou todos os dias (hoje o bot manda só o plano que a pessoa escolheu + os VIP, em texto corrido).

**Texto exato pedido pelo Matheus (gravado sem nenhuma alteração):**

```
Temos opções que se encaixam no seu momento:

💪 3x por semana — R$ 89,90
💪 Acesso todos os dias — R$ 99,90

Mas quem realmente quer resultado escolhe nossos planos VIP, que saem muito mais em conta:

🔥 Trimestral VIP — R$ 89,90/mês
🔥 Semestral VIP — R$ 79,90/mês
🔥 Anual VIP — R$ 69,90/mês

✅ Todos com acesso livre
✅ Avaliação gratuita (Trimestral e Anual)
✅ Convidado grátis (15 dias no Trimestral | 1 meses no Anual)

Qual desses encaixa melhor no seu objetivo? 💪🏼
```

### Decisões do Matheus (24/10/2026)

- **Texto igual ao enviado**, sem reescrever nada.
- **Não mandar mensagem grande:** dividir em mensagens menores (proposta abaixo; o texto continua idêntico, só separado).
- **A pergunta "3x por semana ou todos os dias?" sai do fluxo** (o texto já traz os dois). As regras "não dar preço antes de saber a frequência" e "não despejar vários planos" precisam ser reescritas ao aplicar, junto com os testes que conferem essas frases.
- **Avaliação gratuita vale nos 3 planos VIP** (confirmado pelo Matheus). No texto a linha passa a ser: `✅ Avaliação gratuita (nos 3 planos VIP)` (o original dizia "Trimestral e Anual"; conferir a redação final ao aplicar).
- **Convidado grátis (15 dias no Trimestral | 1 meses no Anual):** manter como está. (O Semestral não tem convidado.)
- **VIP continuam sendo parcelas no cartão** (3x, 6x, 12x) ou o total à vista: manter essa explicação nas instruções para quando o cliente perguntar como paga. O "/mês" do texto fica como o Matheus escreveu.
- **Só gravar por enquanto:** nada foi aplicado no `instrucoes.md`.

### Proposta de divisão em mensagens menores (ainda não aplicada)

Mensagem 1:
```
Temos opções que se encaixam no seu momento:

💪 3x por semana — R$ 89,90
💪 Acesso todos os dias — R$ 99,90
```

Mensagem 2:
```
Mas quem realmente quer resultado escolhe nossos planos VIP, que saem muito mais em conta:

🔥 Trimestral VIP — R$ 89,90/mês
🔥 Semestral VIP — R$ 79,90/mês
🔥 Anual VIP — R$ 69,90/mês
```

Mensagem 3:
```
✅ Todos com acesso livre
✅ Avaliação gratuita (nos 3 planos VIP)
✅ Convidado grátis (15 dias no Trimestral | 1 meses no Anual)

Qual desses encaixa melhor no seu objetivo? 💪🏼
```

**Decidido: 3 mensagens** (cada uma cabe na tela do celular sem rolar).

---

## 2. Pagamento por cartão pelo bot (ideia, em discussão — nada decidido)

Ideia do Matheus: integrar pagamento por cartão para o bot conduzir o cliente até pagar.

**Decisões (24/10/2026):**
- Gateway: **Mercado Pago** (o Matheus já tem conta).
- **Só os planos "3x por semana" e "Acesso livre"** pagam por cartão pelo bot. Os **VIP continuam pagos direto na recepção** (a taxa é menor lá), ou por Pix como hoje.
- Cartão nunca passa pelo WhatsApp: o bot manda um link de pagamento do Mercado Pago. A chave de acesso (Access Token) vai só em variável da Render, nunca no chat.
- Fases sugeridas: (1) bot manda o link e, quando o Mercado Pago avisar "aprovado", avisa a equipe, que lança a matrícula; (2) só então o bot confirma o pagamento ao cliente (a regra "nunca confirmar pagamento" só muda com a confirmação vinda do Mercado Pago); (3) integração com a plataforma da academia, se existir.

**Taxa vista no simulador do Mercado Pago (24/10/2026, print do Matheus):** cobrar R$ 100,00 no cartão, recebendo em 7 dias, custa **até R$ 4,98** (≈ 5%), mais a taxa de parcelamento se parcelar. Para o 3x por semana (R$ 89,90) são ≈ R$ 4,50; para o Livre (R$ 99,90) ≈ R$ 5,00. O Matheus achou caro. Alternativa levantada por Claude: **Pix gerado pelo Mercado Pago** (valor fixo, aviso automático de pagamento aprovado, taxa normalmente bem menor que a do cartão; conferir no simulador escolhendo Pix) e cartão continua só na recepção. Comparar também com a taxa da maquininha da recepção e com os outros prazos de recebimento do simulador (14 e 30 dias, se existirem na conta dele).

**ABERTO:**
0. Seguir com cartão online (taxa ≈ 5%), trocar por Pix do Mercado Pago, ou deixar tudo como está?
1. O link cobra o quê? (a) só a 1ª mensalidade (R$ 89,90 ou R$ 99,90); (b) 1ª mensalidade + avaliação de R$ 35 (R$ 124,90 ou R$ 134,90), que é o que o cliente novo paga hoje "no ato"; (c) outro.
2. As mensalidades seguintes dos planos básicos: como são cobradas hoje (recepção, plataforma)? O link pagaria só a primeira vez; cobrança automática todo mês seria outra etapa (Assinaturas do Mercado Pago), mais complexa.
3. Nome da plataforma da academia (para saber se dá para integrar a matrícula).

---

(próximas alterações entram aqui embaixo)
