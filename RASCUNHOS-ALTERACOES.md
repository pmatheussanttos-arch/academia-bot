# Rascunhos de alterações (ainda NÃO aplicadas no bot)

Aqui ficam as mudanças combinadas com o Matheus que ainda não foram para o `instrucoes.md`. Nada deste arquivo afeta o bot: ele serve para juntar as ideias e aplicar tudo de uma vez, quando o Matheus mandar.

---

## 1. Mensagem de valores (24/10/2026)

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

Ideia do Matheus: integrar pagamento por cartão para o bot conduzir o cliente até pagar. Ver a conversa de 24/10/2026 para os pontos levantados (gateway, plataforma da academia, direito de arrependimento, taxas, fases).

---

(próximas alterações entram aqui embaixo)
