/** Página de teste: conversa com o assistente no navegador, sem WhatsApp. Tudo aqui é simulação. */
export function paginaTeste(token: string): string {
  const dados = JSON.stringify({ token }).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Testar o GFIT</title>
<style>
  :root{--fundo:#e9e4dc;--cartao:#fff;--texto:#1b1f24;--suave:#5b6572;--borda:#d8dee7;--marca:#c2680a;--cliente:#d9fdd3;--bot:#fff}
  *{box-sizing:border-box}
  body{margin:0;background:var(--fundo);color:var(--texto);font:16px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;flex-direction:column;min-height:100vh}
  .aviso-topo{background:#fff3cd;border-bottom:1px solid #e6d28a;padding:10px 14px;font-size:.9rem}
  header{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--cartao);border-bottom:1px solid var(--borda)}
  header h1{font-size:1.05rem;margin:0;flex:1}
  button{font:inherit;cursor:pointer;border:0;border-radius:10px;padding:12px 14px;font-weight:600;background:var(--marca);color:#fff;min-height:44px}
  button.leve{background:var(--cartao);color:var(--texto);border:1px solid var(--borda)}
  button:disabled{opacity:.5;cursor:default}
  .layout{display:flex;flex:1;min-height:0;gap:12px;padding:12px;max-width:1100px;width:100%;margin:0 auto}
  .conversa{flex:1.4;display:flex;flex-direction:column;min-width:0;background:var(--cartao);border:1px solid var(--borda);border-radius:14px;overflow:hidden}
  .bastidores{flex:1;min-width:0;background:var(--cartao);border:1px solid var(--borda);border-radius:14px;padding:14px;overflow:auto;max-height:calc(100vh - 150px)}
  #mensagens{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:8px;min-height:320px;max-height:calc(100vh - 290px);background:#efeae2}
  .bolha{max-width:85%;padding:9px 12px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word;box-shadow:0 1px 1px rgba(0,0,0,.08)}
  .bolha.cliente{align-self:flex-end;background:var(--cliente)}
  .bolha.bot{align-self:flex-start;background:var(--bot)}
  .bolha.digitando{color:var(--suave);font-style:italic}
  .sistema{align-self:center;font-size:.85rem;color:var(--suave);background:#fff8;border-radius:8px;padding:4px 10px;text-align:center}
  .sugestoes{display:flex;gap:6px;flex-wrap:wrap;padding:8px 12px 0}
  .sugestoes button{font-weight:500;font-size:.85rem;min-height:38px;padding:8px 12px}
  form{display:flex;gap:8px;padding:12px}
  textarea{flex:1;font:inherit;padding:11px 12px;border:1px solid var(--borda);border-radius:10px;resize:none;min-height:46px;max-height:120px}
  h2{font-size:.95rem;margin:0 0 4px}
  .bastidores p{margin:4px 0 12px;color:var(--suave);font-size:.85rem}
  .item{border-left:3px solid var(--marca);background:#fff8ee;border-radius:6px;padding:8px 10px;margin:6px 0;font-size:.85rem;white-space:pre-wrap;word-wrap:break-word}
  .item.ferramenta{border-color:#2459b8;background:#eef3ff;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.78rem}
  .estado{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
  .chip{font-size:.78rem;font-weight:700;border-radius:999px;padding:3px 10px;border:1px solid var(--borda);background:#f4f6f9}
  .chip.alerta{background:#ffe9e6;border-color:#e6a39b;color:#a12a1b}
  @media (max-width:820px){
    .layout{flex-direction:column}
    .bastidores{max-height:none}
    #mensagens{max-height:55vh}
  }
</style>
</head>
<body>
<div class="aviso-topo">🧪 <b>Modo de teste.</b> Nada aqui chega ao WhatsApp, à agenda do Google nem à lista de matrículas de verdade. Só a inteligência (Claude) é real, então cada mensagem tem um custo mínimo na sua conta.</div>
<header>
  <h1>Testar o GFIT</h1>
  <button class="leve" id="novo" type="button">Nova conversa</button>
</header>

<div class="layout">
  <section class="conversa">
    <div id="mensagens" aria-live="polite"></div>
    <div class="sugestoes" id="sugestoes"></div>
    <form id="form">
      <textarea id="texto" rows="1" placeholder="Escreva aqui…" autocomplete="off"></textarea>
      <button type="submit" id="enviar">Enviar</button>
    </form>
  </section>

  <aside class="bastidores">
    <h2>Bastidores (só você vê)</h2>
    <p>O que a equipe e a agenda receberiam de verdade.</p>
    <div class="estado" id="estado"></div>
    <div id="avisos"></div>
    <div id="ferramentas"></div>
  </aside>
</div>

<script>
(function () {
  var CFG = ${dados}
  var sessao = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2) + String(Date.now())
  var elMsgs = document.getElementById('mensagens')
  var elTexto = document.getElementById('texto')
  var elEnviar = document.getElementById('enviar')
  var elAvisos = document.getElementById('avisos')
  var elFerr = document.getElementById('ferramentas')
  var elEstado = document.getElementById('estado')
  var ocupado = false

  var SUGESTOES = ['Oi, quero saber mais dos planos', 'Quanto custa a mensalidade?', 'Quero marcar uma avaliação', 'Quero cancelar meu plano']

  function pedir(caminho, corpo) {
    return fetch(caminho + '?token=' + encodeURIComponent(CFG.token), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo)
    }).then(function (r) {
      return r.json().catch(function () { return {} }).then(function (d) {
        if (!r.ok) throw new Error(d.erro || 'Erro ' + r.status)
        return d
      })
    })
  }

  function bolha(classe, texto) {
    var d = document.createElement('div')
    d.className = classe
    d.textContent = texto
    elMsgs.appendChild(d)
    elMsgs.scrollTop = elMsgs.scrollHeight
    return d
  }

  function item(onde, classe, texto) {
    var d = document.createElement('div')
    d.className = 'item ' + classe
    d.textContent = texto
    onde.appendChild(d)
  }

  function chip(texto, alerta) {
    var c = document.createElement('span')
    c.className = 'chip' + (alerta ? ' alerta' : '')
    c.textContent = texto
    elEstado.appendChild(c)
  }

  function desenharEstado(r) {
    elEstado.innerHTML = ''
    chip(r.emSilencio ? '🔇 Bot em silêncio: conversa passada para a equipe' : '🟢 Bot respondendo', r.emSilencio)
    if (r.matriculas) chip('📝 Matrículas registradas: ' + r.matriculas)
    if (r.avaliacoesAgendadas) chip('📅 Avaliações agendadas (simuladas): ' + r.avaliacoesAgendadas)
  }

  function limparTudo() {
    elMsgs.innerHTML = ''
    elAvisos.innerHTML = ''
    elFerr.innerHTML = ''
    elEstado.innerHTML = ''
    chip('🟢 Bot respondendo')
    bolha('sistema', 'Conversa nova. Escreva como se fosse um cliente chegando pelo WhatsApp.')
  }

  function travar(sim) {
    ocupado = sim
    elEnviar.disabled = sim
    elTexto.disabled = sim
    if (!sim) elTexto.focus()
  }

  function enviar(texto) {
    texto = String(texto || '').trim()
    if (!texto || ocupado) return
    travar(true)
    bolha('bolha cliente', texto)
    elTexto.value = ''
    var digitando = bolha('bolha bot digitando', 'GFIT está digitando…')
    pedir('/teste/enviar', { sessao: sessao, texto: texto }).then(function (r) {
      digitando.remove()
      r.mensagens.forEach(function (m) { bolha('bolha bot', m) })
      if (!r.mensagens.length) bolha('sistema', r.emSilencio ? '(o bot ficou em silêncio nesta conversa)' : '(o bot não respondeu)')
      r.ferramentas.forEach(function (f) { item(elFerr, 'ferramenta', f) })
      r.avisos.forEach(function (a) { item(elAvisos, '', '📣 Aviso para a equipe:\\n' + a) })
      desenharEstado(r)
    }).catch(function (e) {
      digitando.remove()
      bolha('sistema', '❌ ' + e.message)
    }).then(function () { travar(false) })
  }

  document.getElementById('form').addEventListener('submit', function (ev) { ev.preventDefault(); enviar(elTexto.value) })
  elTexto.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); enviar(elTexto.value) }
  })
  document.getElementById('novo').addEventListener('click', function () {
    pedir('/teste/novo', { sessao: sessao }).then(limparTudo).catch(function (e) { bolha('sistema', '❌ ' + e.message) })
  })

  var elSug = document.getElementById('sugestoes')
  SUGESTOES.forEach(function (s) {
    var b = document.createElement('button')
    b.type = 'button'
    b.className = 'leve'
    b.textContent = s
    b.addEventListener('click', function () { enviar(s) })
    elSug.appendChild(b)
  })

  limparTudo()
  elTexto.focus()
})()
</script>
</body>
</html>`
}
