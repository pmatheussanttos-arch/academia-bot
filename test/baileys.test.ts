import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classificar, conteudoReal, ehChatPrivado, ehLid, interpretarConteudo, numeroDeJid, telefoneDaChave, type MensagemBaileys } from '../src/baileys-parse.js'

const PN = '5511999998888@s.whatsapp.net'

describe('JID do WhatsApp', () => {
  it('reconhece chats de pessoa e descarta grupos/status/transmissão', () => {
    assert.equal(ehChatPrivado(PN), true)
    assert.equal(ehChatPrivado('123@lid'), true)
    assert.equal(ehChatPrivado('120363@g.us'), false)
    assert.equal(ehChatPrivado('status@broadcast'), false)
    assert.equal(ehChatPrivado('123@broadcast'), false)
    assert.equal(ehChatPrivado(null), false)
    assert.equal(ehChatPrivado(undefined), false)
  })
  it('extrai só os dígitos do número, sem o sufixo de aparelho', () => {
    assert.equal(numeroDeJid(PN), '5511999998888')
    assert.equal(numeroDeJid('5511999998888:12@s.whatsapp.net'), '5511999998888')
    assert.equal(numeroDeJid('123@lid'), '123')
    assert.equal(numeroDeJid(undefined), '')
  })
})

describe('interpretar conteúdo da mensagem', () => {
  it('texto simples e texto estendido', () => {
    assert.deepEqual(interpretarConteudo({ conversation: 'Oi' }), { tipo: 'text', texto: 'Oi' })
    assert.deepEqual(interpretarConteudo({ extendedTextMessage: { text: 'Quanto custa?' } }), { tipo: 'text', texto: 'Quanto custa?' })
  })
  it('descasca mensagem temporária e "ver uma vez"', () => {
    assert.deepEqual(conteudoReal({ ephemeralMessage: { message: { conversation: 'x' } } }), { conversation: 'x' })
    assert.deepEqual(interpretarConteudo({ ephemeralMessage: { message: { conversation: 'temporária' } } }), { tipo: 'text', texto: 'temporária' })
    assert.deepEqual(interpretarConteudo({ viewOnceMessageV2: { message: { imageMessage: { caption: 'foto' } } } }), { tipo: 'image', texto: 'foto' })
  })
  it('mídia com e sem legenda', () => {
    assert.deepEqual(interpretarConteudo({ imageMessage: { caption: 'comprovante' } }), { tipo: 'image', texto: 'comprovante' })
    assert.deepEqual(interpretarConteudo({ imageMessage: {} }), { tipo: 'image', texto: undefined })
    assert.deepEqual(interpretarConteudo({ audioMessage: { seconds: 5 } }), { tipo: 'audio' })
    assert.deepEqual(interpretarConteudo({ documentMessage: { caption: 'doc', fileName: 'x.pdf' } }), { tipo: 'document', texto: 'doc' })
  })
  it('clique em botão e item de lista viram texto', () => {
    assert.deepEqual(interpretarConteudo({ buttonsResponseMessage: { selectedDisplayText: 'Sim' } }), { tipo: 'text', texto: 'Sim' })
    assert.deepEqual(interpretarConteudo({ listResponseMessage: { title: 'Plano 3x' } }), { tipo: 'text', texto: 'Plano 3x' })
  })
  it('reação, protocolo e desconhecido são marcados como tais', () => {
    assert.equal(interpretarConteudo({ reactionMessage: { text: '👍' } }).tipo, 'reaction')
    assert.equal(interpretarConteudo({ protocolMessage: {} }).tipo, 'protocol')
    assert.equal(interpretarConteudo({}).tipo, 'unknown')
    assert.equal(interpretarConteudo(null).tipo, 'unknown')
  })
})

const msg = (over: Partial<MensagemBaileys> & { key?: Partial<MensagemBaileys['key']> } = {}): MensagemBaileys => ({
  key: { remoteJid: PN, fromMe: false, id: 'ABC123', ...over.key },
  message: over.message ?? { conversation: 'Oi' },
  pushName: over.pushName ?? 'Maria',
})

describe('classificar mensagem recebida', () => {
  const semIds = new Set<string>()

  it('cliente: vira MensagemRecebida com número, nome, tipo e texto', () => {
    const c = classificar(msg(), semIds)
    assert.equal(c.acao, 'cliente')
    if (c.acao !== 'cliente') return
    assert.equal(c.jid, PN)
    assert.deepEqual(c.msg, { wamid: 'ABC123', from: '5511999998888', nome: 'Maria', tipo: 'text', texto: 'Oi' })
  })

  it('eco: mensagem que o próprio bot enviou é ignorada', () => {
    const c = classificar(msg({ key: { fromMe: true, id: 'BOT1' } }), new Set(['BOT1']))
    assert.equal(c.acao, 'eco')
  })

  it('humano: mensagem fromMe que NÃO foi o bot = a equipe respondeu pelo celular', () => {
    const c = classificar(msg({ key: { fromMe: true, id: 'MANUAL1' } }), new Set(['BOT1']))
    assert.equal(c.acao, 'humano')
    if (c.acao !== 'humano') return
    assert.equal(c.numero, '5511999998888')
  })

  it('ignora grupos, status, reações e tipos sem conteúdo útil', () => {
    assert.equal(classificar(msg({ key: { remoteJid: '120@g.us' } }), semIds).acao, 'ignorar')
    assert.equal(classificar(msg({ key: { remoteJid: 'status@broadcast' } }), semIds).acao, 'ignorar')
    assert.equal(classificar(msg({ message: { reactionMessage: { text: '❤️' } } }), semIds).acao, 'ignorar')
    assert.equal(classificar(msg({ message: { protocolMessage: {} } }), semIds).acao, 'ignorar')
    assert.equal(classificar(msg({ message: {} }), semIds).acao, 'ignorar')
  })

  it('áudio e imagem passam como cliente (o atendimento decide o que fazer)', () => {
    assert.equal(classificar(msg({ message: { audioMessage: {} } }), semIds).acao, 'cliente')
    const img = classificar(msg({ message: { imageMessage: { caption: 'comprovante' } } }), semIds)
    assert.equal(img.acao, 'cliente')
    if (img.acao === 'cliente') assert.equal(img.msg.tipo, 'image')
  })
})

describe('contato identificado por código interno (@lid)', () => {
  const LID = '277038426505415@lid'
  const semIds = new Set<string>()

  it('telefoneDaChave: usa o chat se já for telefone, ou o telefone que o WhatsApp mandou ao lado do código', () => {
    assert.equal(telefoneDaChave({ remoteJid: PN }), '5511999998888')
    assert.equal(telefoneDaChave({ remoteJid: LID, remoteJidAlt: '5511999998888@s.whatsapp.net' }), '5511999998888')
    assert.equal(telefoneDaChave({ remoteJid: LID, remoteJidAlt: '5511999998888:3@s.whatsapp.net' }), '5511999998888')
    assert.equal(telefoneDaChave({ remoteJid: LID }), undefined)
    assert.equal(telefoneDaChave({ remoteJid: LID, remoteJidAlt: '123@lid' }), undefined)
    assert.equal(ehLid(LID), true)
    assert.equal(ehLid(PN), false)
  })

  it('cliente: "from" é o telefone (não o código), o código fica em "lid" e a resposta vai para o chat original', () => {
    const c = classificar(msg({ key: { remoteJid: LID, remoteJidAlt: PN } }), semIds)
    assert.equal(c.acao, 'cliente')
    if (c.acao !== 'cliente') return
    assert.equal(c.msg.from, '5511999998888')
    assert.equal(c.msg.lid, '277038426505415')
    assert.equal(c.jid, LID, 'responder no endereço que o WhatsApp usou')
  })

  it('telefone descoberto pela tabela de conversão da biblioteca (fora da mensagem)', () => {
    const c = classificar(msg({ key: { remoteJid: LID } }), semIds, '5511999998888')
    assert.equal(c.acao === 'cliente' && c.msg.from, '5511999998888')
    assert.equal(c.acao === 'cliente' && c.msg.lid, '277038426505415')
  })

  it('sem telefone em lugar nenhum: usa o próprio código, sem inventar "lid"', () => {
    const c = classificar(msg({ key: { remoteJid: LID } }), semIds)
    assert.equal(c.acao, 'cliente')
    if (c.acao !== 'cliente') return
    assert.equal(c.msg.from, '277038426505415')
    assert.equal('lid' in c.msg, false)
  })

  it('a equipe respondendo no celular também é identificada pelo telefone (senão o silêncio vai para o cliente errado)', () => {
    const c = classificar(msg({ key: { remoteJid: LID, remoteJidAlt: PN, fromMe: true, id: 'MANUAL' } }), semIds)
    assert.equal(c.acao, 'humano')
    if (c.acao === 'humano') assert.equal(c.numero, '5511999998888')
  })

  it('o mesmo cliente chegando por telefone ou por código dá o mesmo "from"', () => {
    const a = classificar(msg(), semIds)
    const b = classificar(msg({ key: { remoteJid: LID, remoteJidAlt: PN } }), semIds)
    assert.equal(a.acao === 'cliente' && a.msg.from, b.acao === 'cliente' && b.msg.from)
  })
})
