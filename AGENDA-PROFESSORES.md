# Agenda de avaliações para os professores

Uma página no navegador onde a equipe vê a semana e **marca, desmarca e remarca avaliações**. Tudo na **mesma agenda do Google** que o assistente usa, com as mesmas regras do `agenda.json` (dias, horários de 30 em 30 minutos, feriados).

Não tem login. A página mora num **endereço secreto**, que você gera e compartilha no grupo privado da equipe. Quem não tem o endereço vê "Página não encontrada".

> Precisa do Google Agenda ligado (veja o **GOOGLE-AGENDA.md**). Sem ele a página não funciona, porque não há onde gravar as avaliações.

## Ligar a página

**1. Diga quem são os professores.** Na Render, em **Environment**, crie a variável:

| Variável | Valor |
|---|---|
| `AGENDA_PROFESSORES` | os nomes separados por vírgula, por exemplo `Ana Souza, Bia Lima, Carlos Rocha` |

Esses nomes viram a lista "Quem é você?" da página. É assim que fica registrado quem marcou ou desmarcou cada avaliação. Salve e espere ficar **Live**.

**2. Gere o endereço secreto com um toque.** Abra o atalho da área de trabalho (a página de conexão do WhatsApp, `/conectar?token=SEU_ADMIN_TOKEN`). No fim dela aparece o cartão **"Agenda dos professores"**. Toque em **"🔗 Gerar o link da agenda"**. O endereço completo aparece numa caixinha pronta para copiar.

Quem preferir o terminal pode fazer o mesmo pedido assim:

```
curl -X POST "https://SEU-ENDERECO.onrender.com/admin/agenda?token=SEU_ADMIN_TOKEN" \
  -H "content-type: application/json" -d '{"acao":"ligar"}'
```

**3. Mande esse endereço no grupo privado da equipe.** Peça para salvarem como favorito no celular.

## Como a equipe usa

- **Escolher o nome** em "Quem é você?" (fica guardado no aparelho).
- **Verde = livre.** Toque para marcar: pede nome do cliente, WhatsApp e uma observação opcional.
- **Cinza = ocupado,** com o nome do cliente. Toque para ver o WhatsApp (com link para conversar) e quem marcou.
- **Desmarcar:** toque na avaliação, depois em "Desmarcar" e confirme. O horário fica livre na hora.
- **Remarcar:** toque na avaliação, depois em "Remarcar", e toque no novo horário verde.
- **‹ ›** mudam de semana; **Hoje** volta para a semana atual; **↻** atualiza.
- A tela se atualiza sozinha a cada minuto.

## Regras que a página respeita

- Só os dias e horários do `agenda.json` (hoje: segunda a sexta, 07:00–10:30 e 14:00–19:30, de 30 em 30 minutos).
- **Não deixa marcar no passado** nem fora desses horários.
- **Feriados e dias "Fechado"** aparecem bloqueados.
- **Só mexe em eventos de avaliação** (título "Avaliação — Nome"). Reuniões, feriados e outros eventos aparecem como ocupados, mas não podem ser apagados nem movidos por ali.
- **Confere de novo na hora de gravar.** Se dois professores tocarem no mesmo horário ao mesmo tempo, ou se o assistente marcar primeiro pelo WhatsApp, o segundo recebe "esse horário acabou de ser ocupado" em vez de marcar por cima.
- O que é marcado na página **o assistente respeita**: ele não oferece o horário a outro cliente e sabe que aquele cliente já tem avaliação.
- **O cliente não é avisado automaticamente** quando a equipe desmarca ou remarca. Quem mexe precisa falar com ele.

## Ver quem fez o quê

Toda ação fica registrada com o nome do professor, o cliente e a hora. Para ver (só você, com o `ADMIN_TOKEN`):

```
https://SEU-ENDERECO.onrender.com/admin/agenda?token=SEU_ADMIN_TOKEN
```

Também aparece no **Logs** da Render, em linhas que começam com `[agenda-professores]`.

## Trocar o endereço ou desligar

Tudo pelo mesmo cartão da página de conexão:

- **Alguém saiu da equipe, ou o link vazou:** toque em **"♻️ Gerar outro link"**. O endereço antigo para de funcionar na hora.
- **Desligar a página de vez:** toque em **"Desligar"**.

(Pelo terminal, os mesmos pedidos com `{"acao":"novo_link"}` e `{"acao":"desligar"}`.)

  Depois disso, qualquer endereço de agenda responde "Página não encontrada". O assistente continua funcionando normalmente.

O endereço fica guardado no disco: **um deploy ou reinício não o derruba**. Em `/health`, o campo `agenda_professores` mostra se a página está ligada.

## O que você precisa saber sobre segurança

Sem senha, **o endereço é a chave**. Quem tiver o link entra. Por isso:

- A página não é indexada por buscadores e não fica guardada em cache.
- O endereço tem 26 caracteres sorteados: não dá para adivinhar tentando.
- Mesmo assim, **não mande o link por WhatsApp para clientes, nem publique em lugar nenhum**. Se sair do grupo da equipe, gere um link novo.
- Quem tem o link pode ver nome e WhatsApp dos clientes agendados, e pode desmarcar avaliações. Não dá acesso ao resto do bot (a conexão do WhatsApp e o painel continuam protegidos pelo `ADMIN_TOKEN`).

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| "Página não encontrada" no link certo | A página foi desligada, ou o endereço mudou. Gere um novo |
| "O Google Agenda não está ligado no bot" | Faltam `GOOGLE_CALENDAR_ID` e `GOOGLE_SERVICE_ACCOUNT_JSON`. Veja o GOOGLE-AGENDA.md |
| "Escolha o seu nome na lista" | O professor não escolheu o nome no topo, ou o nome não está em `AGENDA_PROFESSORES` |
| Não deixa ligar a página | `AGENDA_PROFESSORES` está vazia |
| "Esse horário acabou de ser ocupado" | Alguém marcou antes (outro professor ou o assistente). A tela se atualiza sozinha |
| A avaliação some da página mas fica no Google | Não acontece: a página apaga o evento de verdade. Se estranhar, confira se olhou a agenda certa |
