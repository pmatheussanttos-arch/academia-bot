import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { DICA_ANUNCIO, EVENTO_ANUNCIO, ehTextoDeAnuncio } from '../src/anuncio.js'
import { classificar, interpretarConteudo } from '../src/baileys-parse.js'
import { tratarMensagem, type AtendimentoDeps } from '../src/atendimento.js'
import type { MensagemRecebida } from '../src/whatsapp.js'
import { criarDepsDeAgente, texto } from './helpers.js'

const CLIENTE = '5532999990000'
const TEXTO_PRONTO = 'Olá! Posso ter mais informações sobre isso?'
const CARTAO = {
  extendedTextMessage: {
    text: TEXTO_PRONTO,
    contextInfo: {
      externalAdReply: { title: 'GarageFit', body: 'Você aí , está esperando oque para iniciar ? Boora!', sourceUrl: 'https://fb.me/a4vZvIrl5', sourceType: 'ad' },
    },
  },
}

function montar(respostas: Parameters<typeof criarDepsDeAgente>[0]) {
  const base = criarDepsDeAgente(respostas)
  const enviadas: string[] = []
  const deps: AtendimentoDeps = {
    ...base.deps,
    wa: { async enviarTexto(_p, t) { enviadas.push(t) }, async marcarLida() {} },
    avisarErro: async () => {},
  }
  return { ...base, deps, enviadas }
}
const msg = (extra: Partial<MensagemRecebida> = {}): MensagemRecebida => ({ wamid: `w${Math.random()}`, from: CLIENTE, nome: 'Lead', tipo: 'text', texto: TEXTO_PRONTO, ...extra })
const sistema = (c: { system?: unknown }) => (c.system as Array<{ text: string }>).map((b) => b.text).join('\n')

describe('quem veio do anúncio', () => {
  it('lê o cartão do anúncio que o WhatsApp manda junto da mensagem', () => {
    assert.deepEqual(interpretarConteudo(CARTAO), { tipo: 'text', texto: TEXTO_PRONTO, anuncio: 'GarageFit — Você aí , está esperando oque para iniciar ? Boora!' })
    const c = classificar({ key: { remoteJid: `${CLIENTE}@s.whatsapp.net`, fromMe: false, id: 'A1' }, message: CARTAO, pushName: 'Lead' }, new Set())
    assert.equal(c.acao, 'cliente')
    assert.equal(c.acao === 'cliente' && c.msg.anuncio, 'GarageFit — Você aí , está esperando oque para iniciar ? Boora!')
  })

  it('mensagem comum não é marcada como anúncio', () => {
    assert.deepEqual(interpretarConteudo({ extendedTextMessage: { text: 'oi', contextInfo: { quotedMessage: {} } } }), { tipo: 'text', texto: 'oi' })
    assert.deepEqual(interpretarConteudo({ conversation: 'oi' }), { tipo: 'text', texto: 'oi' })
  })

  it('reconhece o texto pronto do botão do anúncio, mesmo sem o cartão', () => {
    assert.equal(ehTextoDeAnuncio(TEXTO_PRONTO), true)
    assert.equal(ehTextoDeAnuncio('olá! posso ter mais informacoes sobre isso'), true)
    assert.equal(ehTextoDeAnuncio('Olá! Tenho interesse e queria mais informações, por favor.'), true)
    assert.equal(ehTextoDeAnuncio('Oi, qual o valor?'), false)
    assert.equal(ehTextoDeAnuncio(undefined), false)
  })

  it('registra uma vez e avisa a IA para pedir o nome, sem perguntar se quer a promoção', async () => {
    const t = montar([texto('Oi! Que bom que você veio 🖤'), texto('Prazer, Ana!')])
    await tratarMensagem(t.deps, msg({ anuncio: 'GarageFit — Boora!' }))
    await tratarMensagem(t.deps, msg({ texto: 'Ana' }))
    assert.equal(t.store.eventosRecentes(EVENTO_ANUNCIO).length, 1)
    assert.equal(t.store.eventosRecentes(EVENTO_ANUNCIO)[0]!.detalhe, 'GarageFit — Boora!')
    for (const chamada of t.chamadas) assert.match(sistema(chamada), /chegou clicando num ANÚNCIO/)
    assert.match(DICA_ANUNCIO, /NÃO pergunte se ela quer conhecer a promoção/)
    assert.match(DICA_ANUNCIO, /Peça o NOME primeiro, sozinho/)
  })

  it('só o texto pronto (sem cartão) também conta; conversa comum não', async () => {
    const t = montar([texto('a')])
    await tratarMensagem(t.deps, msg())
    assert.equal(t.store.teveEvento(CLIENTE, [EVENTO_ANUNCIO], 0), true)
    const t2 = montar([texto('b')])
    await tratarMensagem(t2.deps, msg({ texto: 'Boa tarde' }))
    assert.equal(t2.store.teveEvento(CLIENTE, [EVENTO_ANUNCIO], 0), false)
    assert.doesNotMatch(sistema(t2.chamadas[0]!), /ANÚNCIO/)
  })

  it('o roteiro da Black pede o nome primeiro e vai até o link de pagamento', () => {
    const c = readFileSync(new URL('../campanha.md', import.meta.url), 'utf8')
    assert.match(c, /ROTEIRO PARA QUEM VEIO DO ANÚNCIO/)
    assert.match(c, /Pra eu te explicar tudo certinho, qual é o seu nome\?/)
    assert.match(c, /1b\) Depois que a pessoa disser o nome:\nPrazer, \{nome\}!/)
    assert.match(c, /Qual dos dois combina mais com você\?/)
    assert.match(c, /O NOME vem primeiro, sempre/)
    assert.doesNotMatch(c, /qual é o seu nome e o seu objetivo/)
  })
})

describe('saúde, dor ou medo: acolhe e conduz, sem transferir', () => {
  const i = readFileSync(new URL('../instrucoes.md', import.meta.url), 'utf8')
  it('instruções: não transfere, 2 mensagens curtas, leva para a avaliação', async () => {
    const { REGRAS_FIXAS } = await import('../src/prompt.js')
    assert.match(i, /### Saúde, dor, medo ou insegurança: acolha e direcione \(NÃO transfira\)/)
    assert.match(i, /\*\*Não chame a equipe por isso\.\*\*/)
    assert.match(i, /no máximo 2 mensagens curtas/)
    assert.match(i, /O primeiro passo você já deu: querer começar! 💪 O próximo é a avaliação física\. Vamos marcar\?/)
    assert.match(i, /não diga se ela pode ou não treinar com a doença e não prometa melhora/)
    assert.doesNotMatch(i, /^- Problema de saúde ou lesão\.$/m)
    assert.match(REGRAS_FIXAS, /Se a pessoa só contar que tem um problema de saúde, NÃO chame a equipe/)
    assert.doesNotMatch(REGRAS_FIXAS, /Oriente a procurar um profissional de saúde e chame a equipe/)
  })
})
