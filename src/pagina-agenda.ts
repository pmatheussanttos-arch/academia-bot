/**
 * A página da agenda dos professores (HTML + JavaScript que roda no navegador).
 * Fica num arquivo só, servida pelo próprio bot; o endereço secreto entra como base das chamadas.
 */

export function paginaAgenda(base: string, professores: string[]): string {
  const dados = JSON.stringify({ base, professores }).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
<meta name="referrer" content="no-referrer">
<title>Agenda de avaliações</title>
<style>
  :root{--fundo:#f4f6f9;--cartao:#fff;--texto:#1b1f24;--suave:#5b6572;--borda:#d8dee7;--marca:#c2680a;
    --livre:#e7f6ec;--livre-borda:#9fd8b2;--livre-texto:#13692f;--ocupado:#eceff3;--ocupado-borda:#cbd3dd;--perigo:#c0392b}
  *{box-sizing:border-box}
  body{margin:0;background:var(--fundo);color:var(--texto);font:16px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
  header{position:sticky;top:0;z-index:5;background:var(--cartao);border-bottom:1px solid var(--borda);padding:10px 14px}
  .topo{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  h1{font-size:1.05rem;margin:0;flex:1}
  select,button,input,textarea{font:inherit}
  select,input,textarea{width:100%;padding:11px 12px;border:1px solid var(--borda);border-radius:10px;background:var(--cartao);color:var(--texto)}
  .quem{display:flex;align-items:center;gap:8px;margin-top:8px}
  .quem label{color:var(--suave);font-size:.9rem;white-space:nowrap}
  .navegacao{display:flex;align-items:center;gap:8px;margin-top:10px}
  .navegacao .periodo{flex:1;text-align:center;font-weight:600}
  button{cursor:pointer;border:0;border-radius:10px;padding:12px 14px;font-weight:600;background:var(--marca);color:#fff;min-height:44px}
  button.leve{background:var(--cartao);color:var(--texto);border:1px solid var(--borda)}
  button.perigo{background:var(--perigo)}
  button:disabled{opacity:.5;cursor:default}
  main{padding:14px;max-width:1100px;margin:0 auto}
  .dia{background:var(--cartao);border:1px solid var(--borda);border-radius:14px;margin-bottom:14px;overflow:hidden}
  .dia h2{font-size:1rem;margin:0;padding:12px 14px;border-bottom:1px solid var(--borda);display:flex;justify-content:space-between;align-items:center;gap:8px}
  .dia.hoje h2{background:#fff6e9}
  .marca-hoje{font-size:.75rem;font-weight:700;color:var(--marca);border:1px solid var(--marca);border-radius:999px;padding:2px 8px}
  .fechado{color:var(--perigo);font-size:.85rem;font-weight:600}
  .slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;padding:12px}
  .slot{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;padding:10px 12px;border-radius:10px;border:1px solid var(--borda);background:var(--cartao);min-height:52px}
  .slot .hora{font-weight:700}
  .slot .quem-slot{font-size:.82rem;color:var(--suave);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
  .slot.livre{background:var(--livre);border-color:var(--livre-borda);color:var(--livre-texto)}
  .slot.ocupado{background:var(--ocupado);border-color:var(--ocupado-borda)}
  .slot.passado,.slot.fechado{background:var(--fundo);color:#9aa3ad;cursor:default}
  .vazio{padding:14px;color:var(--suave)}
  dialog{border:0;border-radius:16px;padding:0;width:min(440px,calc(100vw - 24px));box-shadow:0 10px 40px rgba(0,0,0,.2)}
  dialog::backdrop{background:rgba(0,0,0,.45)}
  .corpo{padding:18px}
  .corpo h3{margin:0 0 4px;font-size:1.1rem}
  .corpo p{margin:6px 0;color:var(--suave)}
  .corpo label{display:block;margin-top:12px;font-weight:600;font-size:.92rem}
  .acoes{display:flex;gap:8px;margin-top:18px;flex-wrap:wrap}
  .acoes button{flex:1;min-width:120px}
  .erro{color:var(--perigo);font-weight:600;margin-top:10px;min-height:1.2em}
  .aviso{position:fixed;left:50%;transform:translateX(-50%);bottom:16px;background:#13692f;color:#fff;padding:12px 16px;border-radius:12px;max-width:calc(100vw - 32px);z-index:20;box-shadow:0 6px 20px rgba(0,0,0,.25)}
  .aviso.ruim{background:var(--perigo)}
  .dados{font-size:.92rem;background:var(--fundo);border-radius:10px;padding:10px;margin-top:10px}
  .dados div{margin:3px 0}
  @media (max-width:640px){
    .slots{grid-template-columns:repeat(auto-fill,minmax(104px,1fr))}
    .slot{min-height:60px}
  }
</style>
</head>
<body>
<header>
  <div class="topo">
    <h1>Agenda de avaliações</h1>
    <button class="leve" id="hoje" type="button">Hoje</button>
    <button class="leve" id="atualizar" type="button" aria-label="Atualizar">↻</button>
  </div>
  <div class="quem">
    <label for="professor">Quem é você?</label>
    <select id="professor"></select>
  </div>
  <div class="navegacao">
    <button class="leve" id="anterior" type="button">‹</button>
    <div class="periodo" id="periodo">carregando…</div>
    <button class="leve" id="proxima" type="button">›</button>
  </div>
</header>

<main id="grade"><p class="vazio">Carregando a agenda…</p></main>

<dialog id="dlg">
  <form method="dialog" class="corpo" id="form">
    <h3 id="dlg-titulo"></h3>
    <div id="dlg-corpo"></div>
    <div class="erro" id="dlg-erro" role="alert"></div>
    <div class="acoes" id="dlg-acoes"></div>
  </form>
</dialog>

<script>
(function () {
  var CFG = ${dados}
  var estado = { semana: null, inicio: '', professor: '', remarcando: null }
  var elGrade = document.getElementById('grade')
  var elPeriodo = document.getElementById('periodo')
  var elProfessor = document.getElementById('professor')
  var dlg = document.getElementById('dlg')
  var dlgTitulo = document.getElementById('dlg-titulo')
  var dlgCorpo = document.getElementById('dlg-corpo')
  var dlgErro = document.getElementById('dlg-erro')
  var dlgAcoes = document.getElementById('dlg-acoes')

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }

  function aviso(texto, ruim) {
    var d = document.createElement('div')
    d.className = 'aviso' + (ruim ? ' ruim' : '')
    d.setAttribute('role', 'status')
    d.textContent = texto
    document.body.appendChild(d)
    setTimeout(function () { d.remove() }, ruim ? 7000 : 5000)
  }

  function pedir(caminho, corpo) {
    var opcoes = { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' }
    if (corpo) { opcoes.method = 'POST'; opcoes.body = JSON.stringify(corpo) }
    return fetch(CFG.base + caminho, opcoes).then(function (r) {
      return r.json().catch(function () { return {} }).then(function (d) {
        if (!r.ok) throw new Error(d.erro || 'Não consegui falar com o servidor (' + r.status + ').')
        return d
      })
    })
  }

  // --- professor escolhido (fica guardado neste aparelho) ---
  function montarProfessores() {
    var guardado = ''
    try { guardado = localStorage.getItem('agenda-professor') || '' } catch (e) {}
    var html = '<option value="">Selecione…</option>'
    for (var i = 0; i < CFG.professores.length; i++) {
      var n = CFG.professores[i]
      html += '<option value="' + esc(n) + '"' + (n === guardado ? ' selected' : '') + '>' + esc(n) + '</option>'
    }
    elProfessor.innerHTML = html
    estado.professor = elProfessor.value
  }
  elProfessor.addEventListener('change', function () {
    estado.professor = elProfessor.value
    try { localStorage.setItem('agenda-professor', estado.professor) } catch (e) {}
  })

  function exigirProfessor() {
    if (estado.professor) return true
    aviso('Primeiro escolha o seu nome em "Quem é você?".', true)
    elProfessor.focus()
    return false
  }

  // --- grade ---
  function carregar(inicio) {
    return pedir('/api/semana?inicio=' + encodeURIComponent(inicio || '')).then(function (d) {
      estado.semana = d
      estado.inicio = d.inicio
      desenhar()
    }).catch(function (e) {
      elGrade.innerHTML = '<p class="vazio">' + esc(e.message) + '</p>'
    })
  }

  var ROTULO_PRESENCA = { veio: 'veio', faltou: 'faltou', matriculou: 'veio e matriculou' }
  var ICONE = { veio: '✅ ', faltou: '❌ ', matriculou: '🏋️ ' }

  function textoSlot(s) {
    if (s.estado === 'ocupado') return s.ocupantes.map(function (o) { return (ICONE[o.comparecimento] || '') + o.cliente }).join(', ')
    if (s.estado === 'fechado') return 'fechado'
    if (s.estado === 'passado') return 'passou'
    return 'livre'
  }

  function desenhar() {
    var s = estado.semana
    elPeriodo.textContent = s.rotulo
    if (!s.dias.length) { elGrade.innerHTML = '<p class="vazio">Nenhum dia com avaliações nesta semana.</p>'; return }
    var html = ''
    for (var i = 0; i < s.dias.length; i++) {
      var d = s.dias[i]
      html += '<section class="dia' + (d.hoje ? ' hoje' : '') + '"><h2><span>' + esc(d.rotulo) + '</span>' +
        (d.hoje ? '<span class="marca-hoje">hoje</span>' : '') +
        (d.fechado ? '<span class="fechado">' + esc(d.fechado) + '</span>' : '') + '</h2><div class="slots">'
      for (var j = 0; j < d.slots.length; j++) {
        var x = d.slots[j]
        var clicavel = x.estado === 'livre' || x.podeAlterar || x.podeAnotar
        html += '<button type="button" class="slot ' + x.estado + '" data-dia="' + i + '" data-slot="' + j + '"' +
          (clicavel ? '' : ' disabled') + '><span class="hora">' + esc(x.hhmm) + '</span>' +
          '<span class="quem-slot">' + esc(textoSlot(x)) + '</span></button>'
      }
      html += '</div></section>'
    }
    elGrade.innerHTML = html
  }

  elGrade.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('.slot') : null
    if (!b || b.disabled) return
    var dia = estado.semana.dias[Number(b.dataset.dia)]
    var slot = dia.slots[Number(b.dataset.slot)]
    if (estado.remarcando) return confirmarRemarcar(dia, slot)
    if (slot.estado === 'livre') return abrirMarcar(dia, slot)
    abrirDetalhe(dia, slot)
  })

  // --- janelas ---
  function abrir(titulo, corpo, acoes) {
    dlgTitulo.textContent = titulo
    dlgCorpo.innerHTML = corpo
    dlgErro.textContent = ''
    dlgAcoes.innerHTML = ''
    for (var i = 0; i < acoes.length; i++) {
      (function (a) {
        var b = document.createElement('button')
        b.type = 'button'
        b.textContent = a.texto
        if (a.classe) b.className = a.classe
        b.addEventListener('click', function () { a.ao(b) })
        dlgAcoes.appendChild(b)
      })(acoes[i])
    }
    if (!dlg.open) dlg.showModal()
  }

  function fechar() { if (dlg.open) dlg.close() }

  function executar(botao, promessa) {
    var todos = dlgAcoes.querySelectorAll('button')
    for (var i = 0; i < todos.length; i++) todos[i].disabled = true
    dlgErro.textContent = ''
    var rotulo = botao.textContent
    botao.textContent = 'Aguarde…'
    promessa.then(function (d) {
      fechar()
      aviso(d.mensagem || 'Pronto!')
      return carregar(estado.inicio)
    }).catch(function (e) {
      dlgErro.textContent = e.message
      botao.textContent = rotulo
      for (var i = 0; i < todos.length; i++) todos[i].disabled = false
      if (/não existe mais|acabou de ser ocupado/.test(e.message)) carregar(estado.inicio)
    })
  }

  function abrirMarcar(dia, slot) {
    if (!exigirProfessor()) return
    abrir('Marcar avaliação', '<p>' + esc(dia.rotulo) + ' às <b>' + esc(slot.hhmm) + '</b></p>' +
      '<label for="c-nome">Nome do cliente</label><input id="c-nome" autocomplete="off" maxlength="60">' +
      '<label for="c-wa">WhatsApp (com DDD)</label><input id="c-wa" inputmode="tel" autocomplete="off" maxlength="20" placeholder="(11) 99999-8888">' +
      '<label for="c-obs">Observação (opcional)</label><textarea id="c-obs" rows="2" maxlength="300"></textarea>',
      [
        { texto: 'Cancelar', classe: 'leve', ao: fechar },
        { texto: 'Marcar', ao: function (b) {
          executar(b, pedir('/api/marcar', {
            data: dia.data, hhmm: slot.hhmm, professor: estado.professor,
            nome: document.getElementById('c-nome').value,
            whatsapp: document.getElementById('c-wa').value,
            obs: document.getElementById('c-obs').value
          }))
        } }
      ])
    setTimeout(function () { document.getElementById('c-nome').focus() }, 50)
  }

  function abrirDetalhe(dia, slot) {
    var o = null
    for (var i = 0; i < slot.ocupantes.length; i++) if (slot.ocupantes[i].ehAvaliacao) { o = slot.ocupantes[i]; break }
    if (!o) o = slot.ocupantes[0]
    if (!o) return
    var corpo = '<p>' + esc(dia.rotulo) + ' às <b>' + esc(slot.hhmm) + '</b></p><div class="dados">' +
      '<div><b>' + esc(o.cliente) + '</b></div>' +
      (o.whatsapp ? '<div>WhatsApp: <a href="https://wa.me/' + esc(o.whatsapp) + '" target="_blank" rel="noopener noreferrer">+' + esc(o.whatsapp) + '</a></div>' : '<div>WhatsApp: não informado</div>') +
      '<div>Marcado por: ' + esc(o.marcadoPor || 'não informado') + '</div></div>'
    var acoes = [{ texto: 'Fechar', classe: 'leve', ao: fechar }]
    if (slot.podeAnotar && o.ehAvaliacao) {
      corpo += '<p class="pergunta-presenca">' + (o.comparecimento ? 'Anotado: <b>' + esc(ROTULO_PRESENCA[o.comparecimento]) + '</b>. Mudou? Escolha de novo.' : 'O cliente veio?') + '</p>'
      var anotar = function (status, texto, classe) {
        acoes.push({ texto: texto, classe: classe, ao: function (b) {
          if (!exigirProfessor()) return
          executar(b, pedir('/api/comparecimento', { eventoId: o.id, status: status, professor: estado.professor }))
        } })
      }
      anotar('veio', '✅ Veio', 'leve')
      anotar('faltou', '❌ Faltou', 'leve')
      anotar('matriculou', '🏋️ Matriculou', '')
      if (o.comparecimento) anotar('limpar', 'Apagar anotação', 'leve')
    }
    if (slot.podeAlterar && o.ehAvaliacao) {
      acoes.push({ texto: 'Remarcar', classe: 'leve', ao: function () {
        if (!exigirProfessor()) return
        estado.remarcando = { id: o.id, cliente: o.cliente }
        fechar()
        aviso('Agora toque no novo horário (verde) para ' + o.cliente + '.')
      } })
      acoes.push({ texto: 'Desmarcar', classe: 'perigo', ao: function () {
        if (!exigirProfessor()) return
        confirmarDesmarcar(o)
      } })
    }
    abrir(o.ehAvaliacao ? 'Avaliação' : 'Ocupado', corpo, acoes)
  }

  function confirmarDesmarcar(o) {
    abrir('Desmarcar?', '<p>A avaliação de <b>' + esc(o.cliente) + '</b> será apagada da agenda e o horário ficará livre.</p><p>O cliente <b>não</b> é avisado automaticamente.</p>',
      [
        { texto: 'Voltar', classe: 'leve', ao: fechar },
        { texto: 'Sim, desmarcar', classe: 'perigo', ao: function (b) {
          executar(b, pedir('/api/desmarcar', { eventoId: o.id, professor: estado.professor }))
        } }
      ])
  }

  function confirmarRemarcar(dia, slot) {
    if (slot.estado !== 'livre') { aviso('Escolha um horário livre (verde).', true); return }
    var r = estado.remarcando
    abrir('Remarcar', '<p>Mover a avaliação de <b>' + esc(r.cliente) + '</b> para <b>' + esc(dia.rotulo) + ' às ' + esc(slot.hhmm) + '</b>?</p>',
      [
        { texto: 'Cancelar', classe: 'leve', ao: function () { estado.remarcando = null; fechar() } },
        { texto: 'Remarcar', ao: function (b) {
          executar(b, pedir('/api/remarcar', { eventoId: r.id, data: dia.data, hhmm: slot.hhmm, professor: estado.professor })
            .then(function (d) { estado.remarcando = null; return d }))
        } }
      ])
  }

  dlg.addEventListener('close', function () { dlgErro.textContent = '' })
  dlg.addEventListener('cancel', function () { estado.remarcando = null })
  document.getElementById('anterior').addEventListener('click', function () { carregar(estado.semana.anterior) })
  document.getElementById('proxima').addEventListener('click', function () { carregar(estado.semana.proxima) })
  document.getElementById('hoje').addEventListener('click', function () { estado.remarcando = null; carregar('') })
  document.getElementById('atualizar').addEventListener('click', function () { carregar(estado.inicio) })

  montarProfessores()
  carregar('')
  setInterval(function () { if (!dlg.open && !estado.remarcando) carregar(estado.inicio) }, 60000)
})()
</script>
</body>
</html>`
}
