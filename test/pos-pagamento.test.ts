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
  it('avisa a equipe, NÃO silencia o bot e deixa o bot seguir a conversa', async () => {
    const t = montar([texto('Recebi, obrigado! A equipe vai conferir o pagamento ✅ Tem mais alguma dúvida?')])
    await tratarMensagem(t.deps, msg({ tipo: 'image', texto: 'segue o comprovante' }))
    assert.match(t.avisos[0]!, /📎 Cliente enviou uma imagem com a legenda "segue o comprovante"/)
    assert.match(t.avisos[0]!, /WhatsApp: \+553288465841/)
    assert.match(t.avisos[0]!, /O bot continua atendendo/)
    assert.equal(t.store.emHandoff(CHAT), false)
    assert.deepEqual(t.enviadas, ['Recebi, obrigado! A equipe vai conferir o pagamento ✅ Tem mais alguma dúvida?'])
    assert.equal(t.chamadas.length, 1, 'quem responde é o modelo')
    assert.match(JSON.stringify(t.chamadas[0]!.messages.at(-1)), /\[imagem enviado: segue o comprovante\]/)
  })

  it('a conversa continua: o cliente diz que não tem dúvida e o bot responde (não fica mudo)', async () => {
    const t = montar([texto('Recebi!'), texto('Perfeito! Qual é o seu nome completo?')])
    await tratarMensagem(t.deps, msg({ tipo: 'document', texto: undefined }))
    await tratarMensagem(t.deps, msg({ texto: 'não, só isso' }))
    assert.equal(t.enviadas.length, 2)
    assert.equal(t.enviadas[1], 'Perfeito! Qual é o seu nome completo?')
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
