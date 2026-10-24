import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { responder } from '../src/agent.js'
import { tratarMensagem, type AtendimentoDeps } from '../src/atendimento.js'
import type { ClienteWhatsapp, MensagemRecebida } from '../src/whatsapp.js'
import { criarDepsDeAgente, texto, usarFerramenta } from './helpers.js'

const CHAT = '553288465841' // sem o 9
const LID = '277038426505415'
const MATRICULA = { nome: 'Andressa Oliveira de Paula', telefone: '', email: '', nascimento: '', plano: 'Anual VIP', pagamento: 'pix', observacao: '', ja_pagou: true }

function montar(respostas: Parameters<typeof criarDepsDeAgente>[0], extra: Record<string, string> = {}) {
  const base = criarDepsDeAgente(respostas, { WHATSAPP_MODO: 'qr', ...extra })
  const enviadas: string[] = []
  const wa: ClienteWhatsapp = {
    async enviarTexto(_p, t) {
      enviadas.push(t)
    },
    async marcarLida() {},
  }
  const deps: AtendimentoDeps = { ...base.deps, wa, avisarErro: async () => {}, pausaEntreMensagensMs: 0 }
  return { ...base, deps, enviadas }
}
const msg = (extra: Partial<MensagemRecebida> = {}): MensagemRecebida => ({ wamid: `w${Math.random()}`, from: CHAT, nome: 'Perfil', tipo: 'text', texto: 'oi', ...extra })

describe('cadastro depois do pagamento (ja_pagou)', () => {
  it('usa o telefone do WhatsApp sem perguntar, avisa a equipe para conferir o comprovante e não repete Pix nem link', async () => {
    const t = montar([usarFerramenta('registrar_matricula', MATRICULA), texto('ok')])
    t.store.adicionarMensagem(CHAT, 'user', 'Andressa Oliveira de Paula')
    await responder(t.deps, CHAT, 'Perfil')
    const salva = t.store.matriculas()[0]!
    assert.equal(salva.telefone, CHAT, 'o telefone veio do chat')
    assert.equal(salva.nome, 'Andressa Oliveira de Paula')
    assert.match(t.avisos.at(-1)!, /JÁ PAGOU: confira o comprovante antes de finalizar/)
    const resultado = JSON.stringify(t.chamadas[1]!.messages.at(-1)!.content)
    assert.match(resultado, /Prontinho, Andressa!/)
    assert.match(resultado, /A recepção vai conferir o seu comprovante e finalizar tudo/)
    assert.doesNotMatch(resultado, /35\.950\.235|infinitepay/i, 'já pagou: nada de chave Pix nem link')
    assert.doesNotMatch(resultado.split('\\n---\\n')[1]!, /pagamento (foi )?(recebido|confirmado)|tudo pago/i, 'a mensagem ao cliente não confirma pagamento')
  })

  it('sem ja_pagou (ainda vai pagar) continua mandando a chave Pix; com o link no cartão', async () => {
    const pix = montar([usarFerramenta('registrar_matricula', { ...MATRICULA, ja_pagou: false }), texto('ok')])
    pix.store.adicionarMensagem(CHAT, 'user', 'fechar')
    await responder(pix.deps, CHAT, undefined)
    assert.match(JSON.stringify(pix.chamadas[1]!.messages.at(-1)!.content), /35\.950\.235/)
    assert.doesNotMatch(pix.avisos.at(-1)!, /JÁ PAGOU/)

    const cartao = montar([usarFerramenta('registrar_matricula', { ...MATRICULA, pagamento: 'cartao', ja_pagou: false }), texto('ok')])
    cartao.store.adicionarMensagem(CHAT, 'user', 'fechar')
    await responder(cartao.deps, CHAT, undefined)
    assert.match(JSON.stringify(cartao.chamadas[1]!.messages.at(-1)!.content), /link\.infinitepay\.io/)
  })

  it('telefone que o cliente informou vale mais que o do chat; chat sem telefone (código interno) pede o telefone', async () => {
    const t = montar([usarFerramenta('registrar_matricula', { ...MATRICULA, telefone: '(32) 99999-1111' }), texto('ok')])
    t.store.adicionarMensagem(CHAT, 'user', 'fechar')
    await responder(t.deps, CHAT, undefined)
    assert.equal(t.store.matriculas()[0]!.telefone, '5532999991111')

    const lid = montar([usarFerramenta('registrar_matricula', MATRICULA), texto('ok')])
    lid.store.adicionarMensagem(LID, 'user', 'fechar')
    await responder(lid.deps, LID, undefined)
    assert.equal(lid.store.matriculas().length, 0, 'sem telefone válido não registra')
    const bloco = (lid.chamadas[1]!.messages.at(-1)!.content as Array<{ is_error?: boolean; content: string }>)[0]!
    assert.equal(bloco.is_error, true)
    assert.match(bloco.content, /Telefone inválido/)
  })
})

describe('comprovante (imagem ou documento) no modo QR', () => {
  it('só diz que recebeu e que a equipe vai olhar: sem pedir nome, sem chamar o modelo, sem silenciar', async () => {
    const t = montar([])
    await tratarMensagem(t.deps, msg({ tipo: 'image', texto: undefined }))
    assert.deepEqual(t.enviadas, ['Recebi a imagem! 😊 A equipe vai dar uma olhada e já te retorna.'])
    assert.doesNotMatch(t.enviadas[0]!, /nome|\?/i, 'nenhuma pergunta')
    assert.equal(t.chamadas.length, 0, 'resposta fixa: o modelo nem é chamado (e por isso não pergunta o nome)')
    assert.equal(t.store.emHandoff(CHAT), false, 'e o bot não se cala')
    assert.match(t.avisos[0]!, /📎 Cliente enviou uma imagem/)
    assert.match(t.avisos[0]!, /WhatsApp: \+553288465841/)
    assert.doesNotMatch(t.enviadas[0]!, /confirmad|recebido o pagamento|tudo pago/i, 'não confirma pagamento')
  })

  it('documento e vídeo têm a mesma resposta, com o nome certo do arquivo', async () => {
    const t = montar([])
    await tratarMensagem(t.deps, msg({ tipo: 'document', texto: undefined }))
    await tratarMensagem(t.deps, msg({ tipo: 'video', texto: undefined }))
    assert.equal(t.enviadas[0], 'Recebi o documento! 😊 A equipe vai dar uma olhada e já te retorna.')
    assert.equal(t.enviadas[1], 'Recebi o vídeo! 😊 A equipe vai dar uma olhada e já te retorna.')
  })

  it('o texto pode ser editado no mensagens.md (seção arquivo-recebido)', async () => {
    const { mkdtempSync, readFileSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const pasta = mkdtempSync(join(tmpdir(), 'arq-'))
    const arq = join(pasta, 'm.md')
    writeFileSync(arq, readFileSync('./mensagens.md', 'utf8').replace('Recebi {arquivo}! 😊 A equipe vai dar uma olhada e já te retorna.', 'Chegou {arquivo}, obrigado!'))
    const t = montar([], { MENSAGENS_PATH: arq })
    await tratarMensagem(t.deps, msg({ tipo: 'image', texto: undefined }))
    assert.equal(t.enviadas[0], 'Chegou a imagem, obrigado!')
  })

  it('a conversa continua depois: o cliente escreve e o bot responde (não fica mudo)', async () => {
    const t = montar([texto('Claro! Posso ajudar em mais alguma coisa?')])
    await tratarMensagem(t.deps, msg({ tipo: 'image', texto: undefined }))
    await tratarMensagem(t.deps, msg({ texto: 'uma dúvida: que horas abre sábado?' }))
    assert.equal(t.enviadas.length, 2)
    assert.equal(t.enviadas[1], 'Claro! Posso ajudar em mais alguma coisa?')
    assert.match(JSON.stringify(t.chamadas[0]!.messages), /\[imagem enviado\]/, 'o modelo vê que houve um envio de imagem')
  })

  it('modo oficial da Meta: continua passando o arquivo para a equipe (lá o bot não enxerga as imagens)', async () => {
    const t = montar([], { WHATSAPP_MODO: 'cloud' })
    await tratarMensagem(t.deps, msg({ tipo: 'image', texto: undefined }))
    assert.equal(t.store.emHandoff(CHAT), true)
    assert.equal(t.chamadas.length, 0)
  })

  it('áudio continua pedindo para escrever, sem chamar o modelo', async () => {
    const t = montar([])
    await tratarMensagem(t.deps, msg({ tipo: 'audio', texto: undefined }))
    assert.equal(t.chamadas.length, 0)
    assert.match(t.enviadas[0]!, /só consigo ler texto/)
  })
})

describe('cliente que escreve 2 vezes depois de transferido: o bot volta', () => {
  function transferido(t: ReturnType<typeof montar>, motivo = 'quer remarcar a avaliação') {
    const ts = Date.now() - 60_000
    t.store.adicionarMensagem(CHAT, 'user', 'quero mudar meu horário', ts - 1000)
    t.store.adicionarMensagem(CHAT, 'assistant', 'Ok, vou te transferir para um atendente.', ts)
    t.store.definirHandoff(CHAT, 5, motivo, ts)
  }

  it('1 mensagem: o bot fica em silêncio; 2ª mensagem: volta e responde', async () => {
    const t = montar([texto('Oi! Posso te ajudar com o quê?')])
    transferido(t)
    await tratarMensagem(t.deps, msg({ texto: 'ok fico no aguardo' }))
    assert.equal(t.enviadas.length, 0, 'a primeira só aguarda')
    assert.equal(t.store.emHandoff(CHAT), true)
    await tratarMensagem(t.deps, msg({ texto: 'alguém aí?' }))
    assert.deepEqual(t.enviadas, ['Oi! Posso te ajudar com o quê?'])
    assert.equal(t.store.emHandoff(CHAT), false, 'conversa devolvida ao bot')
    assert.equal(t.store.contarEventos('retomado_pelo_cliente', 0), 1)
  })

  it('só conta o que o cliente escreveu DEPOIS da transferência', async () => {
    const t = montar([texto('resposta')])
    transferido(t) // a mensagem de antes da transferência não conta
    await tratarMensagem(t.deps, msg({ texto: 'uma só' }))
    assert.equal(t.enviadas.length, 0)
  })

  it('se uma PESSOA da equipe assumiu, o bot nunca volta por este caminho', async () => {
    for (const motivo of ['A equipe respondeu pelo WhatsApp.', 'Transferido pela equipe.']) {
      const t = montar([texto('não deveria falar')])
      transferido(t, motivo)
      for (const texto of ['um', 'dois', 'três', 'quatro']) await tratarMensagem(t.deps, msg({ texto }))
      assert.equal(t.enviadas.length, 0, motivo)
      assert.equal(t.store.emHandoff(CHAT), true, motivo)
    }
  })

  it('com o bot pausado pelo dono, continua em silêncio', async () => {
    const t = montar([texto('não deveria falar')])
    transferido(t)
    t.store.pausar(null)
    await tratarMensagem(t.deps, msg({ texto: 'um' }))
    await tratarMensagem(t.deps, msg({ texto: 'dois' }))
    assert.equal(t.enviadas.length, 0)
  })
})
