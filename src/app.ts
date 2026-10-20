import { createHash, timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import QRCode from 'qrcode'
import type { EstadoWhatsapp } from './baileys.js'
import { tratarMensagem, type AtendimentoDeps } from './atendimento.js'
import type { Config, ConfigWhatsapp } from './config.js'
import type { FilaPorChave } from './fila.js'
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

function paginaQr(estado: EstadoWhatsapp, imagemQr: string | undefined, token: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
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
    <meta name="viewport" content="width=device-width, initial-scale=1">${refresh}
    <title>Conectar o assistente</title>
    <style>
      body{font-family:system-ui,sans-serif;max-width:460px;margin:40px auto;padding:0 16px;text-align:center;color:#222}
      img{border:1px solid #ddd;border-radius:12px;padding:8px;background:#fff}
      .ok{font-size:1.3rem;color:#0a7a2f;margin:16px 0}
      .aguarde{font-size:1.1rem;color:#8a5a00;margin:24px 0}
      .dica{color:#666;font-size:.9rem}
      h1{font-size:1.2rem}
    </style></head><body>
    <h1>Assistente da GarageFit</h1>${miolo}
    </body></html>`
}

export function criarApp(deps: AppDeps): Hono {
  const { cfg, store, fila, whatsappCfg } = deps
  const app = new Hono()

  app.onError((err, c) => {
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
      return c.html(paginaQr(estado, imagem, token!))
    })
  }

  // --- Administração (só existe se ADMIN_TOKEN estiver definido) ---
  app.get('/admin/handoffs', (c) => {
    if (!autorizado(c.req.header('authorization'), c.req.query('token'))) return c.json({ erro: 'não autorizado' }, 401)
    return c.json({ handoffs: store.handoffsAtivos() })
  })

  app.post('/admin/liberar', async (c) => {
    if (!autorizado(c.req.header('authorization'), c.req.query('token'))) return c.json({ erro: 'não autorizado' }, 401)
    const { numero } = (await c.req.json().catch(() => ({}))) as { numero?: string }
    if (!numero) return c.json({ erro: 'informe "numero"' }, 400)
    return c.json({ liberado: store.liberarHandoff(numero.replace(/\D/g, '')) })
  })

  return app
}
