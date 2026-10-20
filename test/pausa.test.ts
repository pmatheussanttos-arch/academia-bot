import assert from 'node:assert/strict'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { criarApp, type AppDeps } from '../src/app.js'
import { tratarMensagem, type AtendimentoDeps } from '../src/atendimento.js'
import { FilaPorChave } from '../src/fila.js'
import { PAUSA_PADRAO_HORAS, ehPalavraTransferido, interpretarComando, quando, respostaComando } from '../src/pausa.js'
import { Store } from '../src/store.js'
import type { ClienteWhatsapp, MensagemRecebida } from '../src/whatsapp.js'
import { AGORA, chamarHumano, criarDepsDeAgente, pastaTemporaria, texto } from './helpers.js'

const FUSO = 'America/Sao_Paulo'
const HORA = 3_600_000
const EQUIPE = '5511988887777'
const CLIENTE = '5511977776666'
const QR = { WHATSAPP_MODO: 'qr', NUMEROS_AVISOS: '11988887777', ADMIN_TOKEN: 'segredo-admin' }

describe('palavras de comando (pausa geral)', () => {
  it('reconhece só mensagens que SÃO o comando, com ou sem acento, maiúsculas, barra ou pontuação', () => {
    assert.deepEqual(interpretarComando('pausar'), { acao: 'pausar', horas: PAUSA_PADRAO_HORAS })
    assert.equal(PAUSA_PADRAO_HORAS, 1)
    assert.deepEqual(interpretarComando('  PAUSAR! '), { acao: 'pausar', horas: 1 })
    assert.deepEqual(interpretarComando('/pausar'), { acao: 'pausar', horas: 1 })
    assert.deepEqual(interpretarComando('pausar 5'), { acao: 'pausar', horas: 5 })
    assert.deepEqual(interpretarComando('pausar 3 horas'), { acao: 'pausar', horas: 3 })
    assert.deepEqual(interpretarComando('pausar 1h'), { acao: 'pausar', horas: 1 })
    assert.deepEqual(interpretarComando('Pausar sempre'), { acao: 'pausar', horas: null })
    assert.deepEqual(interpretarComando('retomar'), { acao: 'retomar' })
    assert.deepEqual(interpretarComando('Reativar.'), { acao: 'retomar' })
    assert.deepEqual(interpretarComando('status'), { acao: 'status' })
    assert.deepEqual(interpretarComando('ajuda'), { acao: 'ajuda' })
  })

  it('frases comuns e palavras parecidas NÃO são comando; "transferido" é de conversa, não de pausa geral', () => {
    for (const t of ['quero pausar meu plano', 'pausar o plano', 'oi', 'voltar', 'ativar', 'parar', 'pausa', 'retomar o treino amanhã', 'qual o status do meu plano?', 'transferido', '', undefined]) {
      assert.equal(interpretarComando(t), undefined, String(t))
    }
  })

  it('prazo fora de 1 a 72 horas mostra a ajuda em vez de pausar por um valor absurdo', () => {
    assert.deepEqual(interpretarComando('pausar 0'), { acao: 'ajuda' })
    assert.deepEqual(interpretarComando('pausar 500'), { acao: 'ajuda' })
  })

  it('palavra "transferido": com ou sem acento, ponto, maiúsculas e no feminino; frases não valem', () => {
    for (const t of ['transferido', 'Transferido.', ' TRANSFERIDO ', 'transferida', '/transferido']) assert.equal(ehPalavraTransferido(t), true, t)
    for (const t of ['cliente transferido', 'transferido para o financeiro', 'transferir', 'oi', '', undefined]) assert.equal(ehPalavraTransferido(t), false, String(t))
  })

  it('a confirmação diz o prazo e como voltar; retomar e status respondem ao estado', () => {
    const s = new Store(':memory:')
    const agora = AGORA.getTime() // 09:00 em Brasília
    assert.match(respostaComando(s, { acao: 'pausar', horas: 1 }, FUSO, agora), /pausado por 1 hora: volta sozinho às 10:00[\s\S]*envie: retomar/)
    assert.match(respostaComando(s, { acao: 'pausar', horas: 5 }, FUSO, agora), /por 5 horas: volta sozinho às 14:00/)
    assert.match(respostaComando(s, { acao: 'status' }, FUSO, agora), /pausado: volta sozinho às 14:00/)
    assert.match(respostaComando(s, { acao: 'pausar', horas: null }, FUSO, agora), /pausado até você reativar/)
    assert.deepEqual(s.pausa(agora), { ate: null })
    assert.match(respostaComando(s, { acao: 'retomar' }, FUSO, agora), /reativado/)
    assert.equal(s.pausa(agora), undefined)
    assert.match(respostaComando(s, { acao: 'retomar' }, FUSO, agora), /já estava ativo/)
    assert.match(respostaComando(s, { acao: 'status' }, FUSO, agora), /ativo/)
    assert.match(respostaComando(s, { acao: 'ajuda' }, FUSO, agora), /pausar sempre/)
  })
})

describe('pausa guardada no banco', () => {
  it('pausa com prazo vence sozinha; pausa "sempre" fica até reativar', () => {
    const s = new Store(':memory:')
    assert.equal(s.pausa(AGORA.getTime()), undefined)
    s.pausar(AGORA.getTime() + HORA)
    assert.deepEqual(s.pausa(AGORA.getTime()), { ate: AGORA.getTime() + HORA })
    assert.equal(s.pausa(AGORA.getTime() + HORA + 1), undefined, 'venceu')
    s.pausar(null)
    assert.deepEqual(s.pausa(AGORA.getTime() + 1000 * HORA), { ate: null })
    assert.equal(s.retomar(), true)
    assert.equal(s.pausa(), undefined)
    assert.equal(s.retomar(), false, 'já estava ativo')
  })

  it('sobrevive a reinício (deploy): o bot não volta a responder sozinho', () => {
    const arquivo = join(pastaTemporaria(), 'bot.db')
    const antes = new Store(arquivo)
    antes.pausar(null)
    antes.fechar()
    const depois = new Store(arquivo)
    assert.deepEqual(depois.pausa(), { ate: null })
    depois.fechar()
  })

  it('formata o horário no fuso da academia', () => {
    const agora = AGORA.getTime() // 09:00 em Brasília
    assert.equal(quando(agora + 2 * HORA, FUSO, agora), 'às 11:00')
    assert.equal(quando(agora + 24 * HORA, FUSO, agora), 'em 17/10 às 09:00')
  })
})

describe('assistente pausado (atendimento)', () => {
  function montar(respostas: Parameters<typeof criarDepsDeAgente>[0], extra: Record<string, string> = {}) {
    const base = criarDepsDeAgente(respostas, extra)
    const enviadas: Array<{ para: string; texto: string }> = []
    const lidas: string[] = []
    const wa: ClienteWhatsapp = {
      async enviarTexto(para, t) {
        enviadas.push({ para, texto: t })
      },
      async marcarLida(w) {
        lidas.push(w)
      },
    }
    const deps: AtendimentoDeps = { ...base.deps, wa, avisarErro: async () => {} }
    return { ...base, deps, enviadas, lidas }
  }
  const msg = (extra: Partial<MensagemRecebida> = {}): MensagemRecebida => ({ wamid: `w${Math.random()}`, from: CLIENTE, nome: 'Maria', tipo: 'text', texto: 'Quanto custa?', ...extra })

  it('pausado: não responde, não chama a IA, não marca como lida, mas guarda a mensagem', async () => {
    const t = montar([texto('não deveria sair')])
    t.store.pausar(null)
    const m = msg()
    await tratarMensagem(t.deps, m)
    assert.equal(t.enviadas.length, 0)
    assert.equal(t.chamadas.length, 0)
    assert.deepEqual(t.lidas, [], 'a equipe precisa ver a mensagem ainda não lida no celular')
    assert.equal(t.store.historico(CLIENTE, 10).length, 1)
  })

  it('reativado, volta a responder e a marcar como lida', async () => {
    const t = montar([texto('O acesso livre custa R$ 99,90.')])
    t.store.pausar(null)
    await tratarMensagem(t.deps, msg())
    t.store.retomar()
    const m = msg()
    await tratarMensagem(t.deps, m)
    assert.equal(t.enviadas.length, 1)
    assert.deepEqual(t.lidas, [m.wamid])
  })

  it('pausa com prazo vencido não segura o bot', async () => {
    const t = montar([texto('Oi!')])
    t.store.pausar(AGORA.getTime() - 1)
    await tratarMensagem(t.deps, msg())
    assert.equal(t.enviadas.length, 1)
  })

  it('conversa que passou para a equipe também não é marcada como lida', async () => {
    const t = montar([chamarHumano('Quer cancelar'), texto('ok')], { WHATSAPP_MODO: 'qr' })
    await tratarMensagem(t.deps, msg({ texto: 'quero cancelar' }))
    t.lidas.length = 0
    await tratarMensagem(t.deps, msg({ texto: 'alô?' }))
    assert.deepEqual(t.lidas, [])
    assert.equal(t.chamadas.length, 2, 'a segunda mensagem não chegou à IA')
  })

  it('depois de devolvida a conversa, o bot volta a responder aquele cliente na hora', async () => {
    const t = montar([texto('Voltei! Em que posso ajudar?')], QR)
    t.store.definirHandoff(CLIENTE, 1, 'Transferido pela equipe.', AGORA.getTime())
    await tratarMensagem(t.deps, msg())
    assert.equal(t.enviadas.length, 0, 'calado enquanto a equipe cuida')
    t.store.liberarHandoff(CLIENTE)
    await tratarMensagem(t.deps, msg({ texto: 'alô?' }))
    assert.equal(t.enviadas.length, 1)
  })

  describe('quem NÃO pode pausar', () => {
    it('SEGURANÇA: cliente que digita "pausar" ou "transferido" NÃO pausa nada; é conversa normal', async () => {
      const t = montar([texto('Para pausar o plano, vou chamar a equipe.'), texto('Certo!')], QR)
      await tratarMensagem(t.deps, msg({ from: CLIENTE, texto: 'pausar' }))
      await tratarMensagem(t.deps, msg({ from: CLIENTE, texto: 'transferido' }))
      assert.equal(t.store.pausa(), undefined)
      assert.equal(t.store.emHandoff(CLIENTE, AGORA.getTime()), false)
      assert.equal(t.chamadas.length, 2, 'as duas foram para a IA como qualquer mensagem')
    })

    it('SEGURANÇA: números da equipe (NUMEROS_AVISOS) também NÃO pausam; só o celular da academia manda', async () => {
      const t = montar([texto('não deveria sair')], QR)
      for (const palavra of ['pausar', 'pausar sempre', 'transferido', 'retomar']) await tratarMensagem(t.deps, msg({ from: EQUIPE, texto: palavra }))
      assert.equal(t.store.pausa(), undefined)
      assert.equal(t.enviadas.length, 0, 'nem resposta, nem confirmação')
      assert.equal(t.chamadas.length, 0)
    })
  })

  describe('janela de 1 hora sem interação humana', () => {
    const MIN = 60_000
    it('o bot volta a responder 1h depois da última mensagem da equipe; cada mensagem da equipe renova a janela', async () => {
      const t = montar([texto('Voltei! O acesso livre custa R$ 99,90.')], QR)
      const inicio = AGORA.getTime()
      const em = (min: number) => () => new Date(inicio + min * MIN)

      t.store.definirHandoff(CLIENTE, 1, 'A equipe respondeu pelo WhatsApp.', inicio)
      t.deps.agora = em(59)
      await tratarMensagem(t.deps, msg())
      assert.equal(t.enviadas.length, 0, 'aos 59 min ainda está em silêncio')

      t.store.definirHandoff(CLIENTE, 1, 'A equipe respondeu pelo WhatsApp.', inicio + 59 * MIN) // equipe fala de novo
      t.deps.agora = em(100)
      await tratarMensagem(t.deps, msg())
      assert.equal(t.enviadas.length, 0, 'a nova mensagem da equipe renovou: aos 100 min ainda em silêncio')

      t.deps.agora = em(120)
      await tratarMensagem(t.deps, msg())
      assert.equal(t.enviadas.length, 1, '61 min depois da última mensagem humana o bot responde sozinho')
      assert.equal(t.chamadas.length, 1)
    })

    it('depois de o bot transferir (chamar_humano) e ninguém atender, volta em 1h', async () => {
      const t = montar([chamarHumano('Quer falar com atendente'), texto('Ok!'), texto('Oi de novo! Posso ajudar?')], QR)
      await tratarMensagem(t.deps, msg({ texto: 'quero falar com um atendente' })) // o silêncio começa com o relógio real
      t.enviadas.length = 0
      t.deps.agora = () => new Date(Date.now() + 30 * MIN)
      await tratarMensagem(t.deps, msg({ texto: 'alô?' }))
      assert.equal(t.enviadas.length, 0, 'aos 30 min o bot ainda espera a equipe')
      t.deps.agora = () => new Date(Date.now() + 61 * MIN)
      await tratarMensagem(t.deps, msg({ texto: 'alguém aí?' }))
      assert.equal(t.enviadas.length, 1, 'passada 1h sem ninguém da equipe, o bot volta a responder')
    })
  })
})

describe('botão na página /conectar e rotas /admin/pausa', () => {
  function montarApp() {
    const base = criarDepsDeAgente([], QR)
    const wa: ClienteWhatsapp = { async enviarTexto() {}, async marcarLida() {} }
    const deps: AppDeps = { ...base.deps, wa, avisarErro: async () => {}, fila: new FilaPorChave(), whatsappEstado: () => ({ status: 'conectado', numero: '5511900000000', desde: Date.now() }), iniciadoEm: Date.now() }
    return { app: criarApp(deps), store: base.store }
  }
  const T = 'token=segredo-admin'
  const form = (corpo: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(corpo).toString() })

  it('ativo: mostra os três botões de pausar; o formulário leva o token', async () => {
    const { app } = montarApp()
    const html = await (await app.request(`/conectar?${T}`)).text()
    assert.match(html, /Assistente ATIVO/)
    assert.match(html, /Pausar 1 hora/)
    assert.match(html, /Pausar 4 horas/)
    assert.match(html, /Pausar até eu reativar/)
    assert.match(html, /action="\/admin\/pausa\?token=segredo-admin"/)
    assert.doesNotMatch(html, /Reativar agora/)
  })

  it('clicar em pausar volta para a página já mostrando "PAUSADO" e o botão de reativar; /health acompanha', async () => {
    const { app, store } = montarApp()
    const res = await app.request(`/admin/pausa?${T}`, form({ acao: 'pausar', horas: '1', voltar: 'conectar' }))
    assert.equal(res.status, 303)
    assert.equal(res.headers.get('location'), '/conectar?token=segredo-admin')
    assert.ok(store.pausa())

    const html = await (await app.request(`/conectar?${T}`)).text()
    assert.match(html, /Assistente PAUSADO/)
    assert.match(html, /volta sozinho/)
    assert.match(html, /Reativar agora/)
    assert.doesNotMatch(html, /Pausar 1 hora/)
    assert.equal(((await (await app.request('/health')).json()) as { pausado: boolean }).pausado, true)

    await app.request(`/admin/pausa?${T}`, form({ acao: 'retomar', voltar: 'conectar' }))
    assert.equal(store.pausa(), undefined)
    assert.match(await (await app.request(`/conectar?${T}`)).text(), /Assistente ATIVO/)
    assert.equal(((await (await app.request('/health')).json()) as { pausado: boolean }).pausado, false)
  })

  it('lista as conversas em que o bot está calado, com botão para devolver; devolver tira da lista', async () => {
    const { app, store } = montarApp()
    assert.match(await (await app.request(`/conectar?${T}`)).text(), /Nenhuma\. O bot está respondendo todas/)

    store.definirHandoff('5511977776666', 1, 'Transferido pela equipe.')
    store.definirHandoff('5511966665555', 1, 'Quer cancelar o plano')
    store.definirHandoff('277038426505415', 1, 'A equipe respondeu pelo WhatsApp.')
    const html = await (await app.request(`/conectar?${T}`)).text()
    assert.match(html, /Conversas com a equipe \(3\)/)
    assert.match(html, /\+55 \(11\) 97777-6666/)
    assert.match(html, /\+55 \(11\) 96666-5555/)
    assert.match(html, /telefone oculto\) 277038426505415/)
    assert.match(html, /Quer cancelar o plano\. O bot volta às \d\d:\d\d/, 'a pontuação não fica quebrada')
    assert.equal((html.match(/Devolver ao bot/g) ?? []).length, 3)
    assert.match(html, /action="\/admin\/liberar\?token=segredo-admin"/)

    const res = await app.request(`/admin/liberar?${T}`, form({ numero: '5511977776666', voltar: 'conectar' }))
    assert.equal(res.status, 303)
    assert.equal(res.headers.get('location'), '/conectar?token=segredo-admin')
    assert.equal(store.emHandoff('5511977776666'), false)
    assert.equal(store.emHandoff('5511966665555'), true, 'as outras continuam')
    assert.match(await (await app.request(`/conectar?${T}`)).text(), /Conversas com a equipe \(2\)/)
  })

  it('o motivo vindo do cliente/IA aparece escapado na página (sem injetar HTML)', async () => {
    const { app, store } = montarApp()
    store.definirHandoff('5511977776666', 1, '<img src=x onerror=alert(1)> "oi"')
    const html = await (await app.request(`/conectar?${T}`)).text()
    assert.doesNotMatch(html, /<img src=x/)
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  })

  it('devolver exige a senha e continua aceitando JSON', async () => {
    const { app, store } = montarApp()
    store.definirHandoff('5511977776666', 1, 'x')
    assert.equal((await app.request('/admin/liberar', form({ numero: '5511977776666' }))).status, 401)
    assert.equal(store.emHandoff('5511977776666'), true)
    const r = await app.request('/admin/liberar', { method: 'POST', headers: { authorization: 'Bearer segredo-admin', 'content-type': 'application/json' }, body: JSON.stringify({ numero: '+55 11 97777-6666' }) })
    assert.deepEqual(await r.json(), { liberado: true })
    assert.equal((await app.request(`/admin/liberar?${T}`, form({}))).status, 400)
  })

  it('"pausar até eu reativar" (horas=0) não tem prazo', async () => {
    const { app, store } = montarApp()
    await app.request(`/admin/pausa?${T}`, form({ acao: 'pausar', horas: '0', voltar: 'conectar' }))
    assert.deepEqual(store.pausa(), { ate: null })
    assert.match(await (await app.request(`/conectar?${T}`)).text(), /pausado até você reativar/)
  })

  it('sem token ou com token errado, ninguém pausa nem vê o estado', async () => {
    const { app, store } = montarApp()
    assert.equal((await app.request('/admin/pausa', form({ acao: 'pausar', horas: '1' }))).status, 401)
    assert.equal((await app.request('/admin/pausa?token=errado', form({ acao: 'pausar', horas: '1' }))).status, 401)
    assert.equal((await app.request('/admin/pausa')).status, 401)
    assert.equal(store.pausa(), undefined)
  })

  it('API: JSON com Authorization, estado por GET, e erros claros', async () => {
    const { app, store } = montarApp()
    const auth = { authorization: 'Bearer segredo-admin', 'content-type': 'application/json' }
    const r = await app.request('/admin/pausa', { method: 'POST', headers: auth, body: JSON.stringify({ acao: 'pausar', horas: 3 }) })
    assert.equal(r.status, 200)
    const corpo = (await r.json()) as { pausado: boolean; ate: number }
    assert.equal(corpo.pausado, true)
    assert.ok(corpo.ate > Date.now())
    const estado = (await (await app.request('/admin/pausa', { headers: auth })).json()) as { pausado: boolean; descricao: string }
    assert.equal(estado.pausado, true)
    assert.match(estado.descricao, /pausado/)

    for (const ruim of [{ acao: 'pausar', horas: 500 }, { acao: 'pausar', horas: -1 }, { acao: 'pausar', horas: 'abc' }, { acao: 'dançar' }, {}]) {
      const e = await app.request('/admin/pausa', { method: 'POST', headers: auth, body: JSON.stringify(ruim) })
      assert.equal(e.status, 400, JSON.stringify(ruim))
    }
    assert.ok(store.pausa(), 'pedidos inválidos não mexem na pausa')
    await app.request('/admin/pausa', { method: 'POST', headers: auth, body: JSON.stringify({ acao: 'retomar' }) })
    assert.equal(store.pausa(), undefined)
  })
})

describe('o bot explica no log por que não respondeu', () => {
  async function comLog(fn: () => Promise<void>): Promise<string[]> {
    const linhas: string[] = []
    const original = console.log
    console.log = (...a: unknown[]) => void linhas.push(a.join(' '))
    try {
      await fn()
    } finally {
      console.log = original
    }
    return linhas
  }
  const wa: ClienteWhatsapp = { async enviarTexto() {}, async marcarLida() {} }
  const montar = (extra: Record<string, string>) => {
    const base = criarDepsDeAgente([texto('não deveria sair')], extra)
    return { ...base, deps: { ...base.deps, wa, avisarErro: async () => {} } as AtendimentoDeps }
  }
  const msg = (from: string): MensagemRecebida => ({ wamid: `w${Math.random()}`, from, nome: 'Maria', tipo: 'text', texto: 'Oi' })

  it('número de aviso da equipe', async () => {
    const t = montar(QR)
    const linhas = await comLog(() => tratarMensagem(t.deps, msg(EQUIPE)))
    assert.ok(linhas.some((l) => l.includes(`ignorei +${EQUIPE}`) && l.includes('NUMEROS_AVISOS')), linhas.join('\n'))
  })

  it('assistente pausado', async () => {
    const t = montar(QR)
    t.store.pausar(null)
    const linhas = await comLog(() => tratarMensagem(t.deps, msg(CLIENTE)))
    assert.ok(linhas.some((l) => l.includes(`+${CLIENTE}`) && l.includes('pausado')), linhas.join('\n'))
  })

  it('conversa com a equipe', async () => {
    const t = montar(QR)
    t.store.definirHandoff(CLIENTE, 1, 'x', AGORA.getTime())
    const linhas = await comLog(() => tratarMensagem(t.deps, msg(CLIENTE)))
    assert.ok(linhas.some((l) => l.includes(`+${CLIENTE}`) && l.includes('a equipe está na conversa')), linhas.join('\n'))
  })
})
