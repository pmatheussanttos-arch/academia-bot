import { createHash, timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { tratarMensagem, type AtendimentoDeps } from './atendimento.js'
import type { ConfigWhatsapp } from './config.js'
import type { FilaPorChave } from './fila.js'
import { carregarInstrucoes, instrucoesIncompletas } from './prompt.js'
import { extrairMensagens, verificarAssinatura } from './whatsapp.js'

export interface AppDeps extends AtendimentoDeps {
  fila: FilaPorChave
  whatsappCfg: ConfigWhatsapp
  iniciadoEm: number
}

function tokensIguais(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export function criarApp(deps: AppDeps): Hono {
  const { cfg, store, fila, whatsappCfg } = deps
  const app = new Hono()

  app.onError((err, c) => {
    console.error('[http] erro não tratado:', err)
    return c.json({ erro: 'interno' }, 500)
  })

  // A Meta chama este endereço uma vez, ao cadastrar o webhook, para confirmar que ele é seu.
  app.get('/webhook', (c) => {
    const modo = c.req.query('hub.mode')
    const token = c.req.query('hub.verify_token')
    const desafio = c.req.query('hub.challenge')
    if (modo === 'subscribe' && token && tokensIguais(token, whatsappCfg.verifyToken)) {
      return c.text(desafio ?? '', 200)
    }
    return c.text('Forbidden', 403)
  })

  // Mensagens dos clientes chegam aqui.
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
      if (!store.marcarProcessada(msg.wamid)) continue // a Meta reenviou uma mensagem que já tratamos
      void fila.executar(msg.from, () => tratarMensagem(deps, msg))
    }
    // Responder 200 rápido evita que a Meta reenvie; o atendimento continua em segundo plano.
    return c.text('ok', 200)
  })

  app.get('/health', (c) => {
    let instrucoesOk = false
    try {
      instrucoesOk = !instrucoesIncompletas(carregarInstrucoes(cfg.instrucoesPath))
    } catch {
      // arquivo ausente: continua false
    }
    return c.json({
      ok: true,
      uptime_s: Math.floor((Date.now() - deps.iniciadoEm) / 1000),
      conversas_em_andamento: fila.pendentes,
      instrucoes_completas: instrucoesOk,
      modelo: cfg.model,
      agenda: deps.agenda.modo,
    })
  })

  // --- Administração (só existe se ADMIN_TOKEN estiver definido) ---
  const autorizado = (cabecalho: string | undefined): boolean => {
    if (!cfg.adminToken) return false
    const token = cabecalho?.replace(/^Bearer\s+/i, '') ?? ''
    return token !== '' && tokensIguais(token, cfg.adminToken)
  }

  app.get('/admin/handoffs', (c) => {
    if (!autorizado(c.req.header('authorization'))) return c.json({ erro: 'não autorizado' }, 401)
    return c.json({ handoffs: store.handoffsAtivos() })
  })

  // Devolve a conversa ao bot antes do prazo: POST /admin/liberar {"numero":"5511999999999"}
  app.post('/admin/liberar', async (c) => {
    if (!autorizado(c.req.header('authorization'))) return c.json({ erro: 'não autorizado' }, 401)
    const { numero } = (await c.req.json().catch(() => ({}))) as { numero?: string }
    if (!numero) return c.json({ erro: 'informe "numero"' }, 400)
    return c.json({ liberado: store.liberarHandoff(numero.replace(/\D/g, '')) })
  })

  return app
}
