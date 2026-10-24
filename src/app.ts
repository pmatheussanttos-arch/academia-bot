import { createHash, timingSafeEqual } from 'node:crypto'
import { Hono, type Context } from 'hono'
import QRCode from 'qrcode'
import type { EstadoWhatsapp } from './baileys.js'
import { tratarMensagem, type AtendimentoDeps } from './atendimento.js'
import type { Config, ConfigWhatsapp } from './config.js'
import type { FilaPorChave } from './fila.js'
import { Metricas } from './metricas.js'
import { abaValida, paginaPainel } from './painel-dono.js'
import { nomeInformado } from './acompanhamento.js'
import { AUTOMATICAS_POR_DIA, enviadasHoje } from './automaticas.js'
import { definirRotina, rotinaLigada } from './rotinas.js'
import { AcessoAgenda } from './acesso-agenda.js'
import { paginaAgenda } from './pagina-agenda.js'
import { paginaTeste } from './pagina-teste.js'
import { SalaDeTeste } from './sala-de-teste.js'
import { ErroPainel, PainelAgenda } from './painel-agenda.js'
import { PAUSA_MAX_HORAS, aplicarPausa, descreverPausa } from './pausa.js'
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

export function criarApp(deps: AppDeps): Hono {
  const { cfg, store, fila, whatsappCfg } = deps
  const app = new Hono()
  const acesso = new AcessoAgenda(store, cfg.professores)
  const sala = new SalaDeTeste(cfg, deps.claude, Date.now, (u) => store.registrarUsoIa(u))
  const painel = new PainelAgenda(deps.agenda, store)
  const metricas = new Metricas({ store, cfg, servico: deps.agenda, estado: deps.whatsappEstado })

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
      // Sem aba escolhida: conectado abre o "Hoje"; desconectado abre o "Bot", onde está o QR code.
      const aba = abaValida(c.req.query('aba')) ?? (estado.status === 'conectado' ? 'hoje' : 'bot')
      let imagem: string | undefined
      if (aba === 'bot' && estado.status === 'aguardando_qr' && estado.qr) {
        imagem = await QRCode.toDataURL(estado.qr, { margin: 1, width: 300 }).catch(() => undefined)
      }
      c.header('Cache-Control', 'no-store')
      c.header('X-Robots-Tag', 'noindex, nofollow')
      return c.html(
        paginaPainel({
          token: token!,
          aba,
          origem: new URL(c.req.url).origin,
          fuso: deps.agenda.fuso,
          estado,
          imagemQr: imagem,
          resumo: await metricas.resumo(),
          pausa: store.pausa(),
          conversas: store.handoffsAtivos(),
          profs: acesso.estado(),
          matriculas: store.matriculas(50),
          toleranciaQuedaMin: cfg.toleranciaQuedaMin,
          rotinas: {
            resumo: { ligada: rotinaLigada(store, 'resumo'), ...(store.lerAjuste('resumo_ultimo') ? { ultimo: store.lerAjuste('resumo_ultimo')!.split('-').reverse().join('/') } : {}) },
            lembrete: { ligada: rotinaLigada(store, 'lembrete'), enviadosNaSemana: store.contarLembretes(Date.now() - 7 * 86_400_000, 'enviado'), disponivel: cfg.modoWhatsapp === 'qr' },
            gastoLimiteReais: cfg.gastoLimiteMensalReais,
          },
          retomada: {
            ligada: rotinaLigada(store, 'retomada'),
            avisoEquipeLigado: rotinaLigada(store, 'alerta_espera'),
            disponivel: cfg.modoWhatsapp === 'qr',
            automaticasHoje: enviadasHoje(store, deps.agenda),
            limiteDia: AUTOMATICAS_POR_DIA,
            avisosEquipeNaSemana: store.contarAcompanhamentos(Date.now() - 7 * 86_400_000, 'alerta_equipe_'),
            lembretes: store.acompanhamentos(Date.now() - 30 * 86_400_000, 'lembrete_', 30).map((l) => ({
              ts: l.ts,
              chat: l.chat,
              nome: nomeInformado(store.historico(l.chat, 300)),
              tipo: l.tipo,
              resultado: l.resultado,
              texto: l.contexto,
            })),
          },
          aviso: c.req.query('aviso')?.slice(0, 200),
        }),
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
  acaoAgenda('comparecimento', async (d, professor) => {
    const status = d.status
    if (status !== 'veio' && status !== 'faltou' && status !== 'matriculou' && status !== 'limpar') {
      throw new ErroPainel('Escolha se o cliente veio, faltou ou matriculou.', 400, 'status')
    }
    const r = await painel.comparecimento({ eventoId: texto(d.eventoId, 200), status, por: professor })
    metricas.esquecerCache()
    return r
  })
  acaoAgenda('remarcar', (d, professor) => painel.remarcar({ eventoId: texto(d.eventoId, 200), data: texto(d.data, 10), hhmm: texto(d.hhmm, 5), professor }))

  /** Depois de um botão do painel, volta para a mesma aba. Devolve undefined quando a chamada não veio do painel (é a API em JSON). */
  const voltarAoPainel = (c: Context, dados: Record<string, unknown>, aviso?: string) => {
    const token = c.req.query('token')
    if (dados.voltar !== 'conectar' || !token) return undefined
    const aba = abaValida(dados.aba)
    return c.redirect(`/conectar?token=${encodeURIComponent(token)}${aba ? `&aba=${aba}` : ''}${aviso ? `&aviso=${encodeURIComponent(aviso)}` : ''}`, 303)
  }

  const lerDados = async (c: Context): Promise<Record<string, unknown>> => {
    const json = (c.req.header('content-type') ?? '').includes('json')
    return (json ? await c.req.json().catch(() => ({})) : await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>
  }

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

    const voltou = voltarAoPainel(c, dados)
    if (voltou) return voltou
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
    store.registrarEvento('equipe_respondeu', numero, 'devolvida ao bot pelo painel')
    if (liberado) console.log(`[pausa] conversa de +${numero} devolvida ao bot pelo painel`)
    const voltou = voltarAoPainel(c, dados)
    if (voltou) return voltou
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

  // Liga e desliga as rotinas automáticas (resumo semanal e lembrete ao cliente).
  app.post('/admin/rotinas', async (c) => {
    if (!autorizado(c.req.header('authorization'), c.req.query('token'))) return c.json({ erro: 'não autorizado' }, 401)
    const dados = await lerDados(c)
    const rotina = dados.rotina
    if (rotina !== 'resumo' && rotina !== 'lembrete' && rotina !== 'retomada' && rotina !== 'alerta_espera') {
      return c.json({ erro: 'informe "rotina": "resumo", "lembrete", "retomada" ou "alerta_espera"' }, 400)
    }
    const ligar = dados.ligar === '1' || dados.ligar === 1 || dados.ligar === true
    const NOMES = { resumo: 'Resumo da semana', lembrete: 'Lembrete da avaliação (véspera)', retomada: 'Lembrete ao cliente (retomada de conversa)', alerta_espera: 'Aviso à equipe de cliente esperando' }
    if (rotina !== 'resumo' && ligar && cfg.modoWhatsapp !== 'qr') {
      return voltarAoPainel(c, dados, `${NOMES[rotina]} só funciona no modo QR.`) ?? c.json({ erro: 'só funciona no modo QR' }, 400)
    }
    definirRotina(store, rotina, ligar)
    console.log(`[rotinas] ${rotina} ${ligar ? 'ligado' : 'desligado'} pelo painel`)
    return voltarAoPainel(c, dados, `${NOMES[rotina]} ${ligar ? 'ligado' : 'desligado'}.`) ?? c.json({ rotina, ligada: ligar })
  })

  // "Já lancei na plataforma": a recepção marca (ou desmarca) uma matrícula feita pelo WhatsApp.
  app.post('/admin/matricula-lancada', async (c) => {
    if (!autorizado(c.req.header('authorization'), c.req.query('token'))) return c.json({ erro: 'não autorizado' }, 401)
    const dados = await lerDados(c)
    const id = Number(dados.id)
    if (!Number.isInteger(id) || id <= 0) return c.json({ erro: 'informe "id" da matrícula' }, 400)
    const lancada = dados.lancada === '1' || dados.lancada === 1 || dados.lancada === true
    const achou = store.marcarMatriculaLancada(id, lancada, 'painel')
    if (!achou) {
      return voltarAoPainel(c, dados, 'Essa matrícula não existe mais.') ?? c.json({ erro: 'matrícula não encontrada' }, 404)
    }
    return voltarAoPainel(c, dados) ?? c.json({ ok: true, lancada })
  })

  // Anota se o cliente veio, faltou ou matriculou depois da avaliação (o painel do dono; os professores têm a rota deles).
  app.post('/admin/comparecimento', async (c) => {
    if (!autorizado(c.req.header('authorization'), c.req.query('token'))) return c.json({ erro: 'não autorizado' }, 401)
    const dados = await lerDados(c)
    const eventoId = typeof dados.eventoId === 'string' ? dados.eventoId.slice(0, 200) : ''
    const status = dados.status
    if (!eventoId || (status !== 'veio' && status !== 'faltou' && status !== 'matriculou' && status !== 'limpar')) {
      return c.json({ erro: 'informe "eventoId" e "status" (veio, faltou, matriculou ou limpar)' }, 400)
    }
    try {
      const r = await painel.comparecimento({ eventoId, status, por: 'Painel do dono' })
      metricas.esquecerCache()
      return voltarAoPainel(c, dados, r.mensagem) ?? c.json(r)
    } catch (err) {
      if (err instanceof ErroPainel) return voltarAoPainel(c, dados, err.message) ?? c.json({ erro: err.message, codigo: err.codigo }, err.status as 400)
      throw err
    }
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
        const voltou = voltarAoPainel(c, dados)
        if (voltou) return voltou
        return c.json({ erro: 'Defina AGENDA_PROFESSORES com os nomes dos professores antes de ligar a página.' }, 400)
      }
      const codigo = acesso.ligar()
      paginas.clear()
      console.log(`[agenda-professores] página ${dados.acao === 'ligar' ? 'ligada' : 'com endereço novo'} pelo painel`)
      const voltou = voltarAoPainel(c, dados)
      if (voltou) return voltou
      return c.json({ ligada: true, caminho: `/agenda/${codigo}` })
    }
    if (dados.acao === 'desligar') {
      acesso.desligar()
      paginas.clear()
      console.log('[agenda-professores] página desligada pelo painel')
      const voltou = voltarAoPainel(c, dados)
      if (voltou) return voltou
      return c.json({ ligada: false, caminho: null })
    }
    return c.json({ erro: 'informe "acao": "ligar", "novo_link" ou "desligar"' }, 400)
  })

  return app
}
