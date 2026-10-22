import { createHash, timingSafeEqual } from 'node:crypto'
import { Hono, type Context } from 'hono'
import QRCode from 'qrcode'
import type { EstadoWhatsapp } from './baileys.js'
import { tratarMensagem, type AtendimentoDeps } from './atendimento.js'
import type { Config, ConfigWhatsapp } from './config.js'
import type { FilaPorChave } from './fila.js'
import { rotulo } from './agenda.js'
import { nascimentoBonito } from './matricula.js'
import type { HandoffAtivo, MatriculaSalva } from './store.js'
import { AcessoAgenda } from './acesso-agenda.js'
import { paginaAgenda } from './pagina-agenda.js'
import { paginaTeste } from './pagina-teste.js'
import { SalaDeTeste } from './sala-de-teste.js'
import { ErroPainel, PainelAgenda } from './painel-agenda.js'
import { PAUSA_MAX_HORAS, aplicarPausa, descreverPausa, quando } from './pausa.js'
import { calcularStatus } from './status.js'
import { carregarInstrucoes, instrucoesIncompletas } from './prompt.js'
import { extrairMensagens, verificarAssinatura } from './whatsapp.js'

export interface AppDeps extends AtendimentoDeps {
  fila: FilaPorChave
  /** Só no modo Cloud (API oficial da Meta). */
  whatsappCfg?: ConfigWhatsapp
  /** Só no modo QR: estado da conexão para a página do QR code. */
  whatsappEstado?: () => EstadoWhatsapp
  iniciadoEm: number
}

function tokensIguais(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Botões de pausar/reativar o assistente. Cada botão é um formulário POST; o token vai na URL, como no resto do painel. */
function cartaoPausa(pausa: { ate: number | null } | undefined, token: string, fuso: string): string {
  const acao = `/admin/pausa?token=${encodeURIComponent(token)}`
  const form = (campos: string, botao: string, classe = '') =>
    `<form method="post" action="${esc(acao)}"><input type="hidden" name="voltar" value="conectar">${campos}${botao.replace('<button', `<button class="${classe}"`)}</form>`
  const pausar = (horas: number, rotulo: string) =>
    form(`<input type="hidden" name="acao" value="pausar"><input type="hidden" name="horas" value="${horas}">`, `<button type="submit">${rotulo}</button>`, 'pausar')
  if (!pausa) {
    return `<section class="pausa ativo"><div class="titulo">🟢 Assistente ATIVO</div>
      <p>Está respondendo os clientes. Para a equipe atender sozinha por um tempo, pause:</p>
      <div class="botoes">${pausar(1, '⏸️ Pausar 1 hora')}${pausar(4, '⏸️ Pausar 4 horas')}${pausar(0, '⏸️ Pausar até eu reativar')}</div>
      <p class="dica">Pelo celular da academia: na conversa com você mesmo, envie <b>pausar</b> (ou <b>retomar</b>). Para uma conversa só, escreva <b>transferido</b> nela (e <b>retomar</b> nela para devolver ao bot).</p></section>`
  }
  return `<section class="pausa pausado"><div class="titulo">⏸️ Assistente PAUSADO</div>
    <p>${esc(descreverPausa(pausa, fuso).replace('⏸️ ', ''))} Ele não está respondendo ninguém e as mensagens ficam não lidas no celular.</p>
    <div class="botoes">${form('<input type="hidden" name="acao" value="retomar">', '<button type="submit">▶️ Reativar agora</button>', 'reativar')}</div></section>`
}

/** +55 (11) 99999-8888 para telefone brasileiro; o resto aparece como código (telefone que o WhatsApp esconde). */
function rotuloContato(chat: string): string {
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(chat)
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `contato ${chat.length > 13 ? '(telefone oculto) ' : ''}${chat}`
}

/** Conversas em que o bot está calado porque a equipe assumiu, cada uma com um botão para devolvê-la ao bot. */
function cartaoConversas(conversas: HandoffAtivo[], token: string, fuso: string): string {
  const acao = `/admin/liberar?token=${encodeURIComponent(token)}`
  if (conversas.length === 0) {
    return `<section class="conversas"><div class="titulo">💬 Conversas com a equipe</div><p>Nenhuma. O bot está respondendo todas as conversas.</p></section>`
  }
  const linhas = conversas
    .slice(0, 30)
    .map(
      (h) => `<li><div><b>${esc(rotuloContato(h.chat))}</b><br><span>${esc(h.motivo.replace(/[.\s]+$/, ''))}. O bot volta ${esc(quando(h.ate, fuso))}.</span></div>
        <form method="post" action="${esc(acao)}"><input type="hidden" name="voltar" value="conectar"><input type="hidden" name="numero" value="${esc(h.chat)}"><button class="devolver" type="submit">Devolver ao bot</button></form></li>`,
    )
    .join('')
  return `<section class="conversas"><div class="titulo">💬 Conversas com a equipe (${conversas.length})</div>
    <p>O bot está calado nestas conversas. Ele volta sozinho 1 hora depois da última mensagem da equipe, ou antes, se você devolver:</p>
    <ul>${linhas}</ul>${conversas.length > 30 ? '<p class="dica">Mostrando as 30 mais recentes.</p>' : ''}</section>`
}

/** Botões para ligar, copiar, trocar e desligar o endereço da agenda dos professores. */
function cartaoAgendaProfessores(estado: { ligada: boolean; codigo?: string; professores: string[] }, token: string, origem: string): string {
  const acao = `/admin/agenda?token=${encodeURIComponent(token)}`
  const form = (campos: string, rotulo: string, classe: string) =>
    `<form method="post" action="${esc(acao)}"><input type="hidden" name="voltar" value="conectar">${campos}<button class="${classe}" type="submit">${rotulo}</button></form>`
  const botao = (valor: string, rotulo: string, classe: string) => form(`<input type="hidden" name="acao" value="${valor}">`, rotulo, classe)

  if (estado.professores.length === 0) {
    return `<section class="profs"><div class="titulo">👩‍🏫 Agenda dos professores</div>
      <p>Para usar, cadastre na Render a variável <b>AGENDA_PROFESSORES</b> com os nomes da equipe, separados por vírgula (ex.: <i>Ana, Bia, Carlos</i>). Depois volte aqui.</p></section>`
  }
  if (!estado.ligada) {
    return `<section class="profs"><div class="titulo">👩‍🏫 Agenda dos professores</div>
      <p>Página onde a equipe marca, desmarca e remarca avaliações. Hoje está <b>desligada</b>.</p>
      <p class="dica">Professores na lista: ${esc(estado.professores.join(', '))}</p>
      <div class="botoes">${botao('ligar', '🔗 Gerar o link da agenda', 'ligar')}</div></section>`
  }
  const link = `${origem}/agenda/${estado.codigo}`
  return `<section class="profs ligada"><div class="titulo">👩‍🏫 Agenda dos professores: LIGADA</div>
    <p>Mande este endereço no grupo privado da equipe (toque para selecionar e copiar):</p>
    <input class="link" type="text" readonly value="${esc(link)}" onclick="this.select()">
    <div class="botoes"><a class="abrir" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Abrir a agenda</a>
      ${botao('novo_link', '♻️ Gerar outro link', 'leve')}${botao('desligar', 'Desligar', 'perigo')}</div>
    <p class="dica">Quem tiver o link entra sem senha: mande só para a equipe. "Gerar outro link" derruba o endereço antigo na hora.</p></section>`
}

/** Matrículas feitas pelo WhatsApp que a equipe ainda precisa lançar na plataforma. */
function cartaoMatriculas(lista: MatriculaSalva[], fuso: string): string {
  if (lista.length === 0) {
    return `<section class="matriculas"><div class="titulo">📝 Matrículas pelo WhatsApp</div><p>Nenhuma por enquanto. Quando um cliente fechar um plano pela conversa, os dados aparecem aqui.</p></section>`
  }
  const linhas = lista
    .slice(0, 20)
    .map((m) => {
      const q = rotulo(m.ts, fuso)
      const dados = [
        `WhatsApp: <a href="https://wa.me/${esc(m.telefone)}" target="_blank" rel="noopener noreferrer">+${esc(m.telefone)}</a>`,
        m.email ? `E-mail: ${esc(m.email)}` : '',
        m.nascimento ? `Nascimento: ${esc(nascimentoBonito(m.nascimento))}` : '',
        m.observacao ? `Obs.: ${esc(m.observacao)}` : '',
      ].filter(Boolean).join(' · ')
      return `<li><div><b>${esc(m.nome)}</b> — ${esc(m.plano)} <span class="forma">${m.pagamento === 'pix' ? 'Pix' : 'cartão'}</span><br><span>${dados}</span><br><span>${esc(q.dia)} às ${esc(q.hora)}</span></div></li>`
    })
    .join('')
  return `<section class="matriculas"><div class="titulo">📝 Matrículas pelo WhatsApp (${lista.length})</div>
    <p>Lance estes cadastros na plataforma da academia. No Pix, confira o comprovante antes.</p>
    <ul>${linhas}</ul>${lista.length > 20 ? '<p class="dica">Mostrando as 20 mais recentes.</p>' : ''}</section>`
}

/** Link para conversar com o assistente pelo navegador, sem WhatsApp. */
function cartaoTeste(token: string): string {
  return `<section class="teste"><div class="titulo">🧪 Testar o bot sem WhatsApp</div>
    <p>Converse com o GFIT aqui no navegador, como se fosse um cliente. Nada vai para o WhatsApp, para a agenda nem para a lista de matrículas de verdade.</p>
    <div class="botoes"><a class="abrir" href="/teste?token=${encodeURIComponent(token)}" target="_blank" rel="noopener noreferrer">Abrir o teste</a></div></section>`
}

/** Cartão com o endereço de status, para o dono colar num monitor gratuito e receber e-mail se o WhatsApp cair. */
function cartaoMonitor(origem: string, toleranciaMin: number): string {
  const url = `${origem}/status/whatsapp`
  return `<section class="monitor"><div class="titulo">🔔 Aviso se o WhatsApp cair</div>
    <p>Hoje ninguém é avisado quando a conexão cai. Cadastre este endereço num monitor gratuito (UptimeRobot, por exemplo) para receber um e-mail:</p>
    <input class="link" type="text" readonly value="${esc(url)}" onclick="this.select()">
    <p class="dica">Ele responde "tudo certo" enquanto o WhatsApp está conectado e acusa erro quando está fora do ar há mais de ${toleranciaMin} minutos (quedas curtas e reinícios não alarmam). Passo a passo no arquivo AVISO-QUEDA.md.</p></section>`
}

function paginaQr(estado: EstadoWhatsapp, imagemQr: string | undefined, token: string, pausaHtml = '', conversasHtml = '', profsHtml = '', monitorHtml = '', matriculasHtml = '', testeHtml = ''): string {
  let miolo: string
  if (estado.status === 'conectado') {
    miolo = `<div class="ok">✅ Conectado${estado.numero ? ` como <b>+${esc(estado.numero)}</b>` : ''}</div>
      <p>O assistente está no ar e respondendo no WhatsApp.</p>`
  } else if (estado.status === 'aguardando_qr' && imagemQr) {
    miolo = `<p>No celular do número do bot, abra <b>WhatsApp &gt; Aparelhos conectados &gt; Conectar um aparelho</b> e aponte para o código:</p>
      <img src="${imagemQr}" alt="QR code" width="300" height="300" />
      <p class="dica">O código muda sozinho. Se expirar, esta página recarrega e mostra um novo.</p>`
  } else {
    miolo = `<div class="aguarde">⏳ ${esc(estado.detalhe ?? 'Preparando a conexão…')}</div>`
  }
  // Recarrega a cada 5s, exceto quando já conectado.
  const refresh = estado.status === 'conectado' ? '' : `<meta http-equiv="refresh" content="5;url=?token=${encodeURIComponent(token)}">`
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer">${refresh}
    <title>Conectar o assistente</title>
    <style>
      body{font-family:system-ui,sans-serif;max-width:460px;margin:40px auto;padding:0 16px;text-align:center;color:#222}
      img{border:1px solid #ddd;border-radius:12px;padding:8px;background:#fff}
      .ok{font-size:1.3rem;color:#0a7a2f;margin:16px 0}
      .aguarde{font-size:1.1rem;color:#8a5a00;margin:24px 0}
      .dica{color:#666;font-size:.9rem}
      h1{font-size:1.2rem}
      .pausa{margin-top:28px;padding:16px;border-radius:12px;text-align:left}
      .pausa.ativo{background:#eaf7ee;border:1px solid #b7e2c3}
      .pausa.pausado{background:#fff4e0;border:1px solid #f0c987}
      .pausa .titulo{font-weight:700;font-size:1.1rem}
      .pausa p{margin:8px 0;color:#333}
      .pausa .dica{color:#666;font-size:.85rem}
      .botoes{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
      .botoes form{margin:0}
      .botoes button{font:inherit;font-weight:600;padding:12px 14px;min-height:44px;border:0;border-radius:8px;color:#fff;cursor:pointer}
      .botoes button.leve{background:#fff;color:#222;border:1px solid #bcc5d2}
      .botoes button.perigo{background:#c0392b}
      .botoes button.pausar{background:#c2680a}
      .botoes button.reativar{background:#0a7a2f;font-size:1.05rem;padding:12px 18px}
      .conversas{margin-top:20px;padding:16px;border-radius:12px;text-align:left;background:#f1f4f9;border:1px solid #d5dce8}
      .conversas .titulo{font-weight:700;font-size:1.05rem}
      .conversas p{margin:8px 0;color:#333}
      .conversas ul{list-style:none;margin:8px 0 0;padding:0}
      .conversas li{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-top:1px solid #d5dce8}
      .conversas li span{color:#555;font-size:.85rem}
      .conversas li form{margin:0}
      .conversas button.devolver{font:inherit;font-weight:600;padding:8px 12px;border:0;border-radius:8px;color:#fff;background:#2459b8;cursor:pointer;white-space:nowrap}
      .profs{margin-top:20px;padding:16px;border-radius:12px;text-align:left;background:#eef3ff;border:1px solid #c3d2f5}
      .profs.ligada{background:#eaf7ee;border-color:#b7e2c3}
      .profs .titulo{font-weight:700;font-size:1.05rem}
      .profs p{margin:8px 0;color:#333}
      .profs .dica{color:#666;font-size:.85rem}
      .profs .link{width:100%;font:inherit;font-size:.9rem;padding:10px;border:1px solid #c3d2f5;border-radius:8px;background:#fff;color:#222}
      .profs .botoes button.ligar{background:#2459b8}
      .matriculas{margin-top:20px;padding:16px;border-radius:12px;text-align:left;background:#f3f0fb;border:1px solid #d4c9ee}
      .matriculas .titulo{font-weight:700;font-size:1.05rem}
      .matriculas p{margin:8px 0;color:#333}
      .matriculas .dica{color:#666;font-size:.85rem}
      .matriculas ul{list-style:none;margin:8px 0 0;padding:0}
      .matriculas li{padding:10px 0;border-top:1px solid #d4c9ee}
      .matriculas li span{color:#555;font-size:.85rem}
      .matriculas .forma{display:inline-block;font-size:.75rem;font-weight:700;color:#5b3fa8;border:1px solid #5b3fa8;border-radius:999px;padding:1px 8px}
      .teste{margin-top:20px;padding:16px;border-radius:12px;text-align:left;background:#eefaf5;border:1px solid #b5e3d0}
      .teste .titulo{font-weight:700;font-size:1.05rem}
      .teste p{margin:8px 0;color:#333}
      .teste .abrir{display:inline-flex;align-items:center;font-weight:600;padding:12px 14px;min-height:44px;border-radius:8px;background:#0a7a2f;color:#fff;text-decoration:none}
      .monitor{margin-top:20px;padding:16px;border-radius:12px;text-align:left;background:#fff8e8;border:1px solid #f0d9a8}
      .monitor .titulo{font-weight:700;font-size:1.05rem}
      .monitor p{margin:8px 0;color:#333}
      .monitor .dica{color:#666;font-size:.85rem}
      .monitor .link{width:100%;font:inherit;font-size:.9rem;padding:10px;border:1px solid #f0d9a8;border-radius:8px;background:#fff;color:#222}
      .profs .botoes .abrir{display:inline-flex;align-items:center;font-weight:600;padding:12px 14px;min-height:44px;border-radius:8px;background:#0a7a2f;color:#fff;text-decoration:none}
    </style></head><body>
    <h1>Assistente da GarageFit</h1>${miolo}${pausaHtml}${conversasHtml}${matriculasHtml}${testeHtml}${profsHtml}${monitorHtml}
    </body></html>`
}

export function criarApp(deps: AppDeps): Hono {
  const { cfg, store, fila, whatsappCfg } = deps
  const app = new Hono()
  const acesso = new AcessoAgenda(store, cfg.professores)
  const sala = new SalaDeTeste(cfg, deps.claude, Date.now, (u) => store.registrarUsoIa(u))
  const painel = new PainelAgenda(deps.agenda, store)

  app.onError((err, c) => {
    if (err instanceof ErroPainel) {
      if (err.status === 404 && err.codigo === 'sem_acesso') return c.text('Página não encontrada.', 404)
      return c.json({ erro: err.message, codigo: err.codigo }, err.status as 400)
    }
    console.error('[http] erro não tratado:', err)
    return c.json({ erro: 'interno' }, 500)
  })

  // --- Modo Cloud (API oficial da Meta): webhook ---
  if (cfg.modoWhatsapp === 'cloud' && whatsappCfg) {
    app.get('/webhook', (c) => {
      const modo = c.req.query('hub.mode')
      const token = c.req.query('hub.verify_token')
      const desafio = c.req.query('hub.challenge')
      if (modo === 'subscribe' && token && tokensIguais(token, whatsappCfg.verifyToken)) {
        return c.text(desafio ?? '', 200)
      }
      return c.text('Forbidden', 403)
    })

    app.post('/webhook', async (c) => {
      const corpo = await c.req.text()
      if (!verificarAssinatura(corpo, c.req.header('x-hub-signature-256'), whatsappCfg.appSecret)) {
        console.error('[webhook] assinatura inválida (confira o WHATSAPP_APP_SECRET)')
        return c.text('assinatura inválida', 401)
      }
      let payload: unknown
      try {
        payload = JSON.parse(corpo)
      } catch {
        return c.text('ok', 200)
      }
      for (const msg of extrairMensagens(payload, whatsappCfg.phoneNumberId)) {
        if (!store.marcarProcessada(msg.wamid)) continue
        void fila.executar(msg.from, () => tratarMensagem(deps, msg))
      }
      return c.text('ok', 200)
    })
  }

  /**
   * Página de status para um monitor externo (avisa o dono por e-mail quando o WhatsApp cai).
   * Responde 503 quando está fora do ar há mais tempo do que a tolerância. Fica fora do /health
   * de propósito: a Render usa o /health e reiniciaria o serviço sem parar.
   */
  app.get('/status/whatsapp', (c) => {
    const s = calcularStatus(deps.whatsappEstado?.(), Date.now(), cfg.toleranciaQuedaMin)
    c.header('Cache-Control', 'no-store, max-age=0')
    c.header('X-Robots-Tag', 'noindex, nofollow')
    return c.json({ ok: s.ok, estado: s.estado, minutos_fora_do_ar: s.minutosForaDoAr, mensagem: s.mensagem, ...(s.acao ? { acao: s.acao } : {}) }, s.ok ? 200 : 503)
  })

  app.get('/health', (c) => {
    let instrucoesOk = false
    try {
      instrucoesOk = !instrucoesIncompletas(carregarInstrucoes(cfg.instrucoesPath))
    } catch {
      // arquivo ausente: continua false
    }
    const estado = deps.whatsappEstado?.()
    return c.json({
      ok: true,
      uptime_s: Math.floor((Date.now() - deps.iniciadoEm) / 1000),
      conversas_em_andamento: fila.pendentes,
      instrucoes_completas: instrucoesOk,
      modelo: cfg.model,
      agenda: deps.agenda.modo,
      whatsapp: cfg.modoWhatsapp,
      whatsapp_status: estado?.status,
      avisos: { whatsapp: cfg.numerosAvisos.length, telegram: Boolean(cfg.telegram) },
      pausado: store.pausa() !== undefined,
      agenda_professores: acesso.estado().ligada,
    })
  })

  const autorizado = (headerAuth: string | undefined, queryToken: string | undefined): boolean => {
    if (!cfg.adminToken) return false
    const token = queryToken ?? headerAuth?.replace(/^Bearer\s+/i, '') ?? ''
    return token !== '' && tokensIguais(token, cfg.adminToken)
  }

  // --- Modo QR: página para conectar o WhatsApp ---
  if (cfg.modoWhatsapp === 'qr' && deps.whatsappEstado) {
    // A página do QR dá acesso TOTAL à conta de WhatsApp, por isso exige o ADMIN_TOKEN na URL.
    app.get('/', (c) => c.redirect(`/conectar?token=${encodeURIComponent(c.req.query('token') ?? '')}`))
    app.get('/conectar', async (c) => {
      const token = c.req.query('token')
      if (!autorizado(undefined, token)) return c.text('Acesso negado. Abra esta página com ?token=SEU_ADMIN_TOKEN no final do endereço.', 401)
      const estado = deps.whatsappEstado!()
      let imagem: string | undefined
      if (estado.status === 'aguardando_qr' && estado.qr) {
        imagem = await QRCode.toDataURL(estado.qr, { margin: 1, width: 300 }).catch(() => undefined)
      }
      const origem = new URL(c.req.url).origin
      return c.html(
        paginaQr(
          estado,
          imagem,
          token!,
          cartaoPausa(store.pausa(), token!, deps.agenda.fuso),
          cartaoConversas(store.handoffsAtivos(), token!, deps.agenda.fuso),
          cartaoAgendaProfessores(acesso.estado(), token!, origem),
          cartaoMonitor(origem, cfg.toleranciaQuedaMin),
          cartaoMatriculas(store.matriculas(50), deps.agenda.fuso),
          cartaoTeste(token!),
        ),
      )
    })
  }

  // --- Agenda dos professores: /agenda/<código secreto> (sem login; o endereço é o segredo) ---
  const paginas = new Map<string, string>() // código -> HTML pronto

  /** Confere o código do endereço. Quem erra (ou a página desligada) recebe 404: nem dá para saber que existe. */
  const comAcesso = <T>(c: Context, fn: (professorOk: (n: unknown) => string) => T): T => {
    if (!acesso.liberado(c.req.param('codigo'))) throw new ErroPainel('Página não encontrada.', 404, 'sem_acesso')
    return fn((n) => {
      const nome = typeof n === 'string' ? n.trim() : ''
      if (!acesso.professorValido(nome)) throw new ErroPainel('Escolha o seu nome na lista antes de continuar.', 400, 'professor')
      return nome
    })
  }

  /** A página e as respostas não podem ser guardadas nem indexadas: o endereço é secreto. */
  const protegerPagina = (c: Context): void => {
    c.header('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet')
    c.header('Cache-Control', 'no-store, max-age=0')
    c.header('Referrer-Policy', 'no-referrer')
  }

  app.get('/agenda', (c) => c.text('Página não encontrada.', 404))

  app.get('/agenda/:codigo', (c) => {
    const codigo = c.req.param('codigo')
    if (!acesso.liberado(codigo)) return c.text('Página não encontrada.', 404)
    protegerPagina(c)
    c.header('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'")
    let html = paginas.get(codigo)
    if (!html) {
      html = paginaAgenda(`/agenda/${encodeURIComponent(codigo)}`, cfg.professores)
      paginas.clear() // o código mudou: a página antiga não serve mais
      paginas.set(codigo, html)
    }
    return c.html(html)
  })

  app.get('/agenda/:codigo/api/semana', async (c) => {
    return comAcesso(c, async () => {
      protegerPagina(c)
      return c.json(await painel.semana(c.req.query('inicio') ?? ''))
    })
  })

  const acaoAgenda = (caminho: string, executar: (dados: Record<string, unknown>, professor: string) => Promise<unknown>) =>
    app.post(`/agenda/:codigo/api/${caminho}`, async (c) => {
      return comAcesso(c, async (professorOk) => {
        protegerPagina(c)
        const dados = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
        const professor = professorOk(dados.professor)
        return c.json((await executar(dados, professor)) as object)
      })
    })

  const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

  acaoAgenda('marcar', (d, professor) =>
    painel.marcar({ data: texto(d.data, 10), hhmm: texto(d.hhmm, 5), nome: texto(d.nome, 80), whatsapp: texto(d.whatsapp, 30), obs: texto(d.obs, 300), professor }),
  )
  acaoAgenda('desmarcar', (d, professor) => painel.desmarcar(texto(d.eventoId, 200), professor))
  acaoAgenda('remarcar', (d, professor) => painel.remarcar({ eventoId: texto(d.eventoId, 200), data: texto(d.data, 10), hhmm: texto(d.hhmm, 5), professor }))

  // --- Administração (só existe se ADMIN_TOKEN estiver definido) ---
  app.get('/admin/handoffs', (c) => {
    if (!autorizado(c.req.header('authorization'), c.req.query('token'))) return c.json({ erro: 'não autorizado' }, 401)
    return c.json({ handoffs: store.handoffsAtivos() })
  })

  // Pausa geral do assistente. GET mostra o estado; POST pausa ou reativa (formulário da página ou JSON).
  app.get('/admin/pausa', (c) => {
    if (!autorizado(c.req.header('authorization'), c.req.query('token'))) return c.json({ erro: 'não autorizado' }, 401)
    const pausa = store.pausa()
    return c.json({ pausado: pausa !== undefined, ate: pausa?.ate ?? null, descricao: descreverPausa(pausa, deps.agenda.fuso) })
  })

  app.post('/admin/pausa', async (c) => {
    if (!autorizado(c.req.header('authorization'), c.req.query('token'))) return c.json({ erro: 'não autorizado' }, 401)
    const json = (c.req.header('content-type') ?? '').includes('json')
    const dados = (json ? await c.req.json().catch(() => ({})) : await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>

    if (dados.acao === 'pausar') {
      const horas = Number(dados.horas ?? 0)
      if (!Number.isFinite(horas) || horas < 0 || horas > PAUSA_MAX_HORAS) return c.json({ erro: `"horas" deve ir de 1 a ${PAUSA_MAX_HORAS} (ou 0 para pausar até reativar)` }, 400)
      aplicarPausa(store, horas === 0 ? null : horas)
      console.log(`[pausa] assistente pausado pelo painel (${horas === 0 ? 'até reativar' : `${horas}h`})`)
    } else if (dados.acao === 'retomar') {
      store.retomar()
      console.log('[pausa] assistente reativado pelo painel')
    } else {
      return c.json({ erro: 'informe "acao": "pausar" ou "retomar"' }, 400)
    }

    const token = c.req.query('token')
    if (dados.voltar === 'conectar' && token) return c.redirect(`/conectar?token=${encodeURIComponent(token)}`, 303)
    const pausa = store.pausa()
    return c.json({ pausado: pausa !== undefined, ate: pausa?.ate ?? null })
  })

  // Devolve uma conversa ao bot. Aceita JSON ({"numero": "..."}) ou o formulário da página.
  app.post('/admin/liberar', async (c) => {
    if (!autorizado(c.req.header('authorization'), c.req.query('token'))) return c.json({ erro: 'não autorizado' }, 401)
    const json = (c.req.header('content-type') ?? '').includes('json')
    const dados = (json ? await c.req.json().catch(() => ({})) : await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>
    const numero = typeof dados.numero === 'string' ? dados.numero.replace(/\D/g, '') : ''
    if (!numero) return c.json({ erro: 'informe "numero"' }, 400)
    const liberado = store.liberarHandoff(numero)
    if (liberado) console.log(`[pausa] conversa de +${numero} devolvida ao bot pelo painel`)
    const token = c.req.query('token')
    if (dados.voltar === 'conectar' && token) return c.redirect(`/conectar?token=${encodeURIComponent(token)}`, 303)
    return c.json({ liberado })
  })

  // --- Teste do bot pelo navegador, sem WhatsApp (só o dono, com o ADMIN_TOKEN) ---
  app.get('/teste', (c) => {
    const token = c.req.query('token')
    if (!autorizado(undefined, token)) return c.text('Acesso negado. Abra esta página com ?token=SEU_ADMIN_TOKEN no final do endereço.', 401)
    c.header('Cache-Control', 'no-store')
    c.header('X-Robots-Tag', 'noindex, nofollow')
    c.header('Referrer-Policy', 'no-referrer')
    return c.html(paginaTeste(token!))
  })

  app.post('/teste/enviar', async (c) => {
    if (!autorizado(c.req.header('authorization'), c.req.query('token'))) return c.json({ erro: 'não autorizado' }, 401)
    const dados = (await c.req.json().catch(() => ({}))) as { sessao?: unknown; texto?: unknown }
    const id = typeof dados.sessao === 'string' && /^[\w-]{8,80}$/.test(dados.sessao) ? dados.sessao : ''
    const texto = typeof dados.texto === 'string' ? dados.texto.trim().slice(0, 2000) : ''
    if (!id) return c.json({ erro: 'sessão inválida: recarregue a página' }, 400)
    if (!texto) return c.json({ erro: 'escreva uma mensagem' }, 400)
    return c.json(await sala.enviar(id, texto))
  })

  app.post('/teste/novo', async (c) => {
    if (!autorizado(c.req.header('authorization'), c.req.query('token'))) return c.json({ erro: 'não autorizado' }, 401)
    const dados = (await c.req.json().catch(() => ({}))) as { sessao?: unknown }
    const id = typeof dados.sessao === 'string' && /^[\w-]{8,80}$/.test(dados.sessao) ? dados.sessao : ''
    if (!id) return c.json({ erro: 'sessão inválida: recarregue a página' }, 400)
    sala.reiniciar(id)
    return c.json({ ok: true })
  })

  app.get('/admin/matriculas', (c) => {
    if (!autorizado(c.req.header('authorization'), c.req.query('token'))) return c.json({ erro: 'não autorizado' }, 401)
    return c.json({ matriculas: store.matriculas(200) })
  })

  // Ligar, desligar e trocar o endereço da agenda dos professores (só o dono, com o ADMIN_TOKEN).
  app.get('/admin/agenda', (c) => {
    if (!autorizado(c.req.header('authorization'), c.req.query('token'))) return c.json({ erro: 'não autorizado' }, 401)
    const e = acesso.estado()
    return c.json({ ligada: e.ligada, professores: e.professores, caminho: e.codigo ? `/agenda/${e.codigo}` : null, acoes: store.acoesAgenda(100) })
  })

  app.post('/admin/agenda', async (c) => {
    if (!autorizado(c.req.header('authorization'), c.req.query('token'))) return c.json({ erro: 'não autorizado' }, 401)
    const json = (c.req.header('content-type') ?? '').includes('json')
    const dados = (json ? await c.req.json().catch(() => ({})) : await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>
    if (dados.acao === 'ligar' || dados.acao === 'novo_link') {
      if (cfg.professores.length === 0) {
      if (dados.voltar === 'conectar' && c.req.query('token')) return c.redirect(`/conectar?token=${encodeURIComponent(c.req.query('token')!)}`, 303)
      return c.json({ erro: 'Defina AGENDA_PROFESSORES com os nomes dos professores antes de ligar a página.' }, 400)
    }
      const codigo = acesso.ligar()
      paginas.clear()
      console.log(`[agenda-professores] página ${dados.acao === 'ligar' ? 'ligada' : 'com endereço novo'} pelo painel`)
      if (dados.voltar === 'conectar' && c.req.query('token')) return c.redirect(`/conectar?token=${encodeURIComponent(c.req.query('token')!)}`, 303)
      return c.json({ ligada: true, caminho: `/agenda/${codigo}` })
    }
    if (dados.acao === 'desligar') {
      acesso.desligar()
      paginas.clear()
      console.log('[agenda-professores] página desligada pelo painel')
      if (dados.voltar === 'conectar' && c.req.query('token')) return c.redirect(`/conectar?token=${encodeURIComponent(c.req.query('token')!)}`, 303)
      return c.json({ ligada: false, caminho: null })
    }
    return c.json({ erro: 'informe "acao": "ligar", "novo_link" ou "desligar"' }, 400)
  })

  return app
}
