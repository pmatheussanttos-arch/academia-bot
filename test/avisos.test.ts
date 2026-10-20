import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { tratarMensagem, type AtendimentoDeps } from '../src/atendimento.js'
import { DriverBaileys } from '../src/baileys.js'
import { carregarConfig, ehNumeroDaEquipe, numeroNaLista, remetentePermitido } from '../src/config.js'
import { criarNotificador } from '../src/notify.js'
import { formatarWhatsapp } from '../src/recepcao.js'
import type { ClienteWhatsapp, MensagemRecebida } from '../src/whatsapp.js'
import { chamarHumano, criarDepsDeAgente, texto } from './helpers.js'

const QR = { WHATSAPP_MODO: 'qr' }
const DONO = '5511999998888'
const LID = '277038426505415'
const RECEPCAO = '5511988887777'

describe('configuração dos avisos à equipe (NUMEROS_AVISOS)', () => {
  it('normaliza, tira repetidos e aceita vários números', () => {
    const cfg = carregarConfig({ ...QR, NUMEROS_AVISOS: '(11) 98888-7777, 11977776666, 11988887777' })
    assert.deepEqual(cfg.numerosAvisos, ['5511988887777', '5511977776666'])
  })

  it('o NUMERO_RECEPCAO nunca vira destino de aviso: só NUMEROS_AVISOS, e sem ele fica vazio', () => {
    assert.deepEqual(carregarConfig({ ...QR, NUMERO_RECEPCAO: '11988887777' }).numerosAvisos, [])
    assert.deepEqual(carregarConfig({ ...QR }).numerosAvisos, [])
    assert.deepEqual(carregarConfig({ ...QR, NUMERO_RECEPCAO: '11988887777', NUMEROS_AVISOS: '11977776666' }).numerosAvisos, ['5511977776666'])
  })

  it('no modo oficial (cloud) não há avisos por WhatsApp, mesmo com NUMERO_RECEPCAO', () => {
    assert.deepEqual(carregarConfig({ NUMERO_RECEPCAO: '11988887777', NUMEROS_AVISOS: '11977776666' }).numerosAvisos, [])
  })

  it('número inválido derruba a inicialização com a variável certa no erro', () => {
    assert.throws(() => carregarConfig({ ...QR, NUMEROS_AVISOS: '11977776666, recepção' }), /NUMEROS_AVISOS inválido/)
  })
})

describe('filtro do modo de teste com código interno do WhatsApp', () => {
  const cfg = { numerosPermitidos: [DONO] }

  it('aceita o telefone, mesmo quando o WhatsApp identificou o remetente pelo código', () => {
    assert.equal(remetentePermitido(cfg, DONO, LID), true)
    assert.equal(remetentePermitido(cfg, '551199998888', LID), true, 'com ou sem o 9 extra')
  })

  it('quem já colocou o código na lista continua passando (telefone resolvido ou não)', () => {
    assert.equal(remetentePermitido({ numerosPermitidos: [LID] }, DONO, LID), true)
    assert.equal(remetentePermitido({ numerosPermitidos: [LID] }, LID), true)
  })

  it('barra desconhecidos, e lista vazia libera todos', () => {
    assert.equal(remetentePermitido(cfg, '5511911112222', '999999999999999'), false)
    assert.equal(remetentePermitido({ numerosPermitidos: [] }, '5511911112222'), true)
    assert.equal(numeroNaLista(DONO, []), false, 'numeroNaLista: vazia = ninguém')
  })

  it('o fluxo real: remetente @lid com telefone descoberto é atendido; outro número é ignorado', async () => {
    const t = montar([texto('Oi! O acesso livre custa R$ 99,90.')], { ...QR, NUMEROS_PERMITIDOS: '(11) 99999-8888' })
    await tratarMensagem(t.deps, msg({ from: DONO, lid: LID }))
    await tratarMensagem(t.deps, msg({ from: '5511911112222', lid: '111111111111111' }))
    assert.equal(t.enviadas.length, 1)
    assert.equal(t.chamadas.length, 1)
    assert.equal(t.store.historico(DONO, 10).length, 2, 'o histórico fica no telefone, não no código')
  })

  it('telefone oculto: o código sozinho na lista também libera o teste', async () => {
    const t = montar([texto('Oi!')], { ...QR, NUMEROS_PERMITIDOS: LID })
    await tratarMensagem(t.deps, msg({ from: LID }))
    assert.equal(t.enviadas.length, 1)
  })
})

describe('quem recebe os avisos é equipe, não cliente', () => {
  const cfg = carregarConfig({ ...QR, NUMEROS_AVISOS: '11988887777' })

  it('ignora a equipe, exceto quem está testando (também em NUMEROS_PERMITIDOS)', () => {
    assert.equal(ehNumeroDaEquipe(cfg, RECEPCAO), true)
    assert.equal(ehNumeroDaEquipe(cfg, '551188887777'), true, 'com ou sem o 9 extra')
    assert.equal(ehNumeroDaEquipe(cfg, DONO), false)
    const testando = carregarConfig({ ...QR, NUMEROS_AVISOS: '11999998888', NUMEROS_PERMITIDOS: '11999998888' })
    assert.equal(ehNumeroDaEquipe(testando, DONO), false)
    assert.equal(ehNumeroDaEquipe(testando, DONO, LID), false)
  })

  it('se a recepção responder ao aviso, o bot não responde como se fosse cliente', async () => {
    const t = montar([texto('não deveria aparecer')], { ...QR, NUMEROS_AVISOS: '11988887777' })
    await tratarMensagem(t.deps, msg({ from: RECEPCAO, texto: 'ok, já ligo pra ele' }))
    assert.equal(t.enviadas.length, 0)
    assert.equal(t.chamadas.length, 0)
    assert.equal(t.store.historico(RECEPCAO, 10).length, 0)
  })

  it('cliente comum continua sendo atendido normalmente com avisos configurados', async () => {
    const t = montar([texto('Oi!')], { ...QR, NUMEROS_AVISOS: '11988887777' })
    await tratarMensagem(t.deps, msg())
    assert.equal(t.enviadas.length, 1)
  })
})

describe('texto do WhatsApp do cliente nos avisos', () => {
  it('mostra telefone de verdade e esconde código interno', () => {
    assert.equal(formatarWhatsapp('5511999998888'), '+5511999998888')
    assert.match(formatarWhatsapp(LID), /telefone oculto/)
    assert.doesNotMatch(formatarWhatsapp(LID), /277038/)
  })

  it('o aviso de atendimento humano usa o telefone resolvido', async () => {
    const t = montar([chamarHumano('Quer cancelar'), texto('ok')], { ...QR })
    await tratarMensagem(t.deps, msg({ from: DONO, lid: LID }))
    assert.match(t.avisos[0]!, /WhatsApp: \+5511999998888/)
    const oculto = montar([chamarHumano('Quer cancelar'), texto('ok')], { ...QR })
    await tratarMensagem(oculto.deps, msg({ from: LID }))
    assert.match(oculto.avisos[0]!, /telefone oculto/)
  })
})

describe('envio dos avisos para o WhatsApp da equipe', () => {
  const cfg = (extra: Record<string, string> = {}) => carregarConfig({ ...QR, NUMEROS_AVISOS: '11988887777,11977776666', ...extra })
  const silencio = { esperasMs: [0, 0] }

  it('manda o texto para cada número da equipe', async () => {
    const enviados: Array<[string, string]> = []
    const n = criarNotificador(cfg(), { ...silencio, whatsapp: async (num, t) => void enviados.push([num, t]) })
    await n('🔔 Cliente precisa de atendimento humano')
    await n.aguardarEnvios()
    assert.deepEqual(enviados, [
      ['5511988887777', '🔔 Cliente precisa de atendimento humano'],
      ['5511977776666', '🔔 Cliente precisa de atendimento humano'],
    ])
  })

  it('não bloqueia o atendimento: o aviso retorna antes do envio terminar', async () => {
    let liberar!: () => void
    const trava = new Promise<void>((r) => (liberar = r))
    let concluido = false
    const n = criarNotificador(cfg(), {
      ...silencio,
      whatsapp: async () => {
        await trava
        concluido = true
      },
    })
    await n('aviso')
    assert.equal(concluido, false)
    liberar()
    await n.aguardarEnvios()
    assert.equal(concluido, true)
  })

  it('se falhar, tenta de novo e entrega; só repete o número que falhou', async () => {
    const tentativas = new Map<string, number>()
    const entregues: string[] = []
    const n = criarNotificador(cfg(), {
      ...silencio,
      whatsapp: async (num) => {
        const k = (tentativas.get(num) ?? 0) + 1
        tentativas.set(num, k)
        if (num === '5511988887777' && k < 3) throw new Error('WhatsApp da academia desconectado')
        entregues.push(num)
      },
    })
    await n('aviso')
    await n.aguardarEnvios()
    assert.equal(tentativas.get('5511988887777'), 3)
    assert.equal(tentativas.get('5511977776666'), 1)
    assert.deepEqual(entregues.sort(), ['5511977776666', '5511988887777'])
  })

  it('desiste depois das tentativas, sem lançar erro nem derrubar o atendimento', async () => {
    let chamadas = 0
    const n = criarNotificador(cfg({ NUMEROS_AVISOS: '11988887777' }), {
      ...silencio,
      whatsapp: async () => {
        chamadas++
        throw new Error('fora do ar')
      },
    })
    await assert.doesNotReject(n('aviso'))
    await n.aguardarEnvios()
    assert.equal(chamadas, 3, '1 tentativa + 2 novas')
  })

  it('envio travado estoura o prazo em vez de ficar pendurado', async () => {
    let chamadas = 0
    const n = criarNotificador(cfg({ NUMEROS_AVISOS: '11988887777' }), {
      esperasMs: [],
      prazoEnvioMs: 20,
      whatsapp: () => {
        chamadas++
        return new Promise(() => {})
      },
    })
    await n('aviso')
    await n.aguardarEnvios()
    assert.equal(chamadas, 1)
  })

  it('teto por hora: passou do limite, o aviso fica só no log; a janela libera com o tempo', async () => {
    let agora = 1_000_000
    const enviados: string[] = []
    const n = criarNotificador(cfg({ NUMEROS_AVISOS: '11988887777' }), {
      ...silencio,
      limitePorHora: 2,
      agora: () => agora,
      whatsapp: async (_n, t) => void enviados.push(t),
    })
    for (const t of ['a', 'b', 'c']) await n(t)
    await n.aguardarEnvios()
    assert.deepEqual(enviados, ['a', 'b'])
    agora += 3_600_001
    await n('d')
    await n.aguardarEnvios()
    assert.deepEqual(enviados, ['a', 'b', 'd'])
  })

  it('sem canal de WhatsApp (modo oficial ou desligado) não envia nada; Telegram segue funcionando', async () => {
    const chamadas: string[] = []
    const fetchFn = (async (url: string, init: RequestInit) => {
      chamadas.push(`${url} ${init.body}`)
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const n = criarNotificador(cfg({ TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '42' }), { fetchFn })
    await n('aviso')
    assert.equal(chamadas.length, 1)
    assert.match(chamadas[0]!, /api\.telegram\.org\/bottok\/sendMessage/)
  })

  it('WhatsApp e Telegram juntos: os dois recebem', async () => {
    const quem: string[] = []
    const fetchFn = (async () => {
      quem.push('telegram')
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const n = criarNotificador(cfg({ NUMEROS_AVISOS: '11988887777', TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '42' }), {
      ...silencio,
      fetchFn,
      whatsapp: async () => void quem.push('whatsapp'),
    })
    await n('aviso')
    await n.aguardarEnvios()
    assert.deepEqual(quem.sort(), ['telegram', 'whatsapp'])
  })
})

describe('conexão Baileys (com socket simulado)', () => {
  interface SockFalso {
    enviadas: Array<{ jid: string; texto: string }>
    consultas: string[]
    sock: unknown
  }

  function sockFalso(opcoes: { existe?: boolean; jid?: string; mapa?: Record<string, string>; mapaFalha?: boolean } = {}): SockFalso {
    const f: SockFalso = { enviadas: [], consultas: [], sock: undefined }
    f.sock = {
      async onWhatsApp(n: string) {
        f.consultas.push(n)
        return [{ jid: opcoes.jid ?? `${n}@s.whatsapp.net`, exists: opcoes.existe ?? true }]
      },
      async sendMessage(jid: string, c: { text: string }) {
        f.enviadas.push({ jid, texto: c.text })
        return { key: { id: `ENVIADO${f.enviadas.length}` } }
      },
      signalRepository: {
        lidMapping: {
          async getPNForLID(lid: string) {
            if (opcoes.mapaFalha) throw new Error('armazenamento indisponível')
            return opcoes.mapa?.[lid] ?? null
          },
        },
      },
    }
    return f
  }

  function driver(f: SockFalso, estado: { status?: 'conectado' | 'desconectado'; numero?: string } = {}) {
    const d = new DriverBaileys({ dataDir: '/tmp/nao-usado' })
    d['sock'] = f.sock as never
    d['estadoAtual'] = { status: estado.status ?? 'conectado', numero: estado.numero ?? '5511900000000', desde: 0 }
    return d
  }

  it('enviarAviso: manda para o JID confirmado pelo WhatsApp e só consulta a primeira vez', async () => {
    const f = sockFalso({ jid: '551188887777@s.whatsapp.net' }) // o WhatsApp devolve o número sem o 9 extra
    const d = driver(f)
    await d.enviarAviso('5511988887777', '🔔 teste')
    await d.enviarAviso('5511988887777', '🔔 outro')
    assert.deepEqual(f.consultas, ['5511988887777'])
    assert.deepEqual(f.enviadas.map((e) => e.jid), ['551188887777@s.whatsapp.net', '551188887777@s.whatsapp.net'])
    assert.equal(f.enviadas[0]!.texto, '🔔 teste')
    assert.ok(d['idsDoBot'].has('ENVIADO1'), 'o eco do aviso não pode ser tomado por resposta da equipe')
  })

  it('enviarAviso: recusa com mensagem clara quando desconectado, número inexistente ou o próprio número do bot', async () => {
    await assert.rejects(driver(sockFalso(), { status: 'desconectado' }).enviarAviso('5511988887777', 'x'), /desconectado/)
    await assert.rejects(driver(sockFalso({ existe: false })).enviarAviso('5511988887777', 'x'), /não tem WhatsApp/)
    const f = sockFalso()
    await assert.rejects(driver(f, { numero: '5511988887777' }).enviarAviso('5511988887777', 'x'), /MESMO número/)
    await assert.rejects(driver(f, { numero: '551188887777' }).enviarAviso('5511988887777', 'x'), /MESMO número/, 'com ou sem o 9 extra')
    assert.equal(f.enviadas.length, 0)
  })

  it('mensagem de contato @lid: descobre o telefone na tabela da biblioteca e responde no endereço original', async () => {
    const f = sockFalso({ mapa: { [`${LID}@lid`]: `${DONO}:0@s.whatsapp.net` } })
    const d = driver(f)
    const recebidas: MensagemRecebida[] = []
    d['handlers'] = { dispatch: (m) => void recebidas.push(m), humano: () => {} }
    await d['tratarInbound']({ key: { remoteJid: `${LID}@lid`, fromMe: false, id: 'M1' }, message: { conversation: 'Quanto custa?' }, pushName: 'Matheus' })
    assert.equal(recebidas[0]!.from, DONO)
    assert.equal(recebidas[0]!.lid, LID)
    await d.enviarTexto(DONO, 'R$ 99,90')
    assert.equal(f.enviadas[0]!.jid, `${LID}@lid`, 'responde ao código interno, que é o endereço que o WhatsApp entrega')
  })

  it('sem tabela e sem telefone: segue com o código, sem quebrar', async () => {
    for (const opcoes of [{}, { mapaFalha: true }]) {
      const d = driver(sockFalso(opcoes))
      const recebidas: MensagemRecebida[] = []
      d['handlers'] = { dispatch: (m) => void recebidas.push(m), humano: () => {} }
      await d['tratarInbound']({ key: { remoteJid: `${LID}@lid`, fromMe: false, id: 'M2' }, message: { conversation: 'oi' } })
      assert.equal(recebidas[0]!.from, LID)
    }
  })

  it('a equipe respondendo no celular a um contato @lid silencia o cliente certo (pelo telefone)', async () => {
    const f = sockFalso({ mapa: { [`${LID}@lid`]: `${DONO}:0@s.whatsapp.net` } })
    const d = driver(f)
    const silenciados: string[] = []
    d['handlers'] = { dispatch: () => {}, humano: (n) => void silenciados.push(n) }
    await d['tratarInbound']({ key: { remoteJid: `${LID}@lid`, fromMe: true, id: 'DOCELULAR' }, message: { conversation: 'Já te respondo' } })
    assert.deepEqual(silenciados, [DONO])
  })
})

// --- apoio ---

function msg(extra: Partial<MensagemRecebida> = {}): MensagemRecebida {
  return { wamid: `w${Math.random()}`, from: DONO, nome: 'Maria', tipo: 'text', texto: 'Oi', ...extra }
}

function montar(respostas: Parameters<typeof criarDepsDeAgente>[0], extra: Record<string, string> = {}) {
  const base = criarDepsDeAgente(respostas, extra)
  const enviadas: string[] = []
  const wa: ClienteWhatsapp = {
    async enviarTexto(_p, t) {
      enviadas.push(t)
    },
    async marcarLida() {},
  }
  const deps: AtendimentoDeps = { ...base.deps, wa, avisarErro: async () => {} }
  return { ...base, deps, enviadas }
}
