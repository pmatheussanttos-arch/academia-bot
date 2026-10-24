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

### Pontos para decidir ANTES de aplicar (levantados por Claude, sem resposta ainda)

1. **Conflito com as regras atuais.** Hoje o `instrucoes.md` manda: uma etapa por mensagem, no máximo 3 frases, **não dar preço antes de saber a frequência**, e **não despejar vários planos de uma vez**. Este texto mostra os dois planos básicos e os três VIP juntos, então aqueles trechos precisam ser reescritos (e os testes que conferem essas frases também).
2. **A pergunta "frequência" continua antes?** O texto lista 3x e todos os dias juntos, então a pergunta "3x por semana ou todos os dias?" deixaria de ser necessária. Confirmar se ela sai do fluxo.
3. **Avaliação gratuita:** hoje o `instrucoes.md` diz que a avaliação é grátis em **todos** os planos VIP (trimestral, semestral e anual). Neste texto o Semestral ficou de fora ("Trimestral e Anual"). Foi proposital?
4. **Convidado grátis (15 dias no Trimestral | 1 mês no Anual):** é uma condição que **não existe** hoje no `instrucoes.md`. Se entrar, o bot passa a prometer isso aos clientes. Confirmar que é verdade e se vale também para o Semestral. Corrigir "1 meses" para "1 mês"?
5. **"R$ 89,90/mês" nos VIP:** hoje as instruções descrevem os VIP como **parcelas no cartão** (3x de 89,90 = 269,70; 6x de 79,90 = 479,40; 12x de 69,90 = 838,80) e também **à vista pelo total**. O texto novo diz "/mês", que pode ser lido como mensalidade recorrente. Manter assim ou escrever "3x de R$ 89,90", "6x de R$ 79,90", "12x de R$ 69,90"?
6. **Pergunta final:** substitui a pergunta do objetivo ("Qual é o seu objetivo hoje?") por "Qual desses encaixa melhor no seu objetivo?". Ajustar a regra de não repetir pergunta.
7. **Tamanho:** é uma mensagem longa. No WhatsApp ela pode sair numa mensagem só (como está) ou dividida em duas ([[nova mensagem]] antes de "Mas quem realmente quer resultado"). Escolher.

---

(próximas alterações entram aqui embaixo)
