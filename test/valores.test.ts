import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { FERRAMENTAS, VALORES_RESERVA, responder, textoValores } from '../src/agent.js'
import { MARCA_NOVA_MENSAGEM, dividirEmMensagens, tratarMensagem, type AtendimentoDeps } from '../src/atendimento.js'
import { carregarMensagens } from '../src/mensagens.js'
import type { ClienteWhatsapp } from '../src/whatsapp.js'
import { criarConfigDeTeste, criarDepsDeAgente, texto, usarFerramenta } from './helpers.js'

const CHAT = '5511977776666'

const PARTES = [
  'Temos opções que se encaixam no seu momento:\n\n💪 3x por semana — R$ 89,90\n💪 Acesso todos os dias — R$ 99,90',
  'Mas quem realmente quer resultado escolhe nossos planos VIP, que saem muito mais em conta:\n\n🔥 Trimestral VIP — R$ 89,90/mês\n🔥 Semestral VIP — R$ 79,90/mês\n🔥 Anual VIP — R$ 69,90/mês',
  '✅ Todos com acesso livre\n✅ Avaliação gratuita (nos 3 planos VIP)\n✅ Convidado grátis (15 dias no Trimestral | 1 meses no Anual)\n\nQual desses encaixa melhor no seu objetivo? 💪🏼',
]

describe('mensagem de valores (planos e preços)', () => {
  it('o texto no mensagens.md é o pedido pelo Matheus, em 3 mensagens curtas', () => {
    const cfg = criarConfigDeTeste()
    const v = textoValores(cfg)
    assert.deepEqual(dividirEmMensagens(v), PARTES)
    assert.equal((v.match(/\[\[nova mensagem\]\]/g) ?? []).length, 2)
    for (const parte of PARTES) assert.ok(parte.length < 260, 'cabe na tela do celular')
  })

  it('traz tudo o que precisa: planos básicos, os 3 VIP, benefícios e a pergunta final', () => {
    const v = textoValores(criarConfigDeTeste())
    for (const trecho of ['3x por semana — R$ 89,90', 'Acesso todos os dias — R$ 99,90', 'Trimestral VIP — R$ 89,90/mês', 'Semestral VIP — R$ 79,90/mês', 'Anual VIP — R$ 69,90/mês', 'Todos com acesso livre', 'Avaliação gratuita (nos 3 planos VIP)', 'Convidado grátis (15 dias no Trimestral | 1 meses no Anual)']) {
      assert.ok(v.includes(trecho), trecho)
    }
    assert.ok(v.trimEnd().endsWith('Qual desses encaixa melhor no seu objetivo? 💪🏼'))
    assert.doesNotMatch(v, /Avaliação gratuita \(Trimestral e Anual\)/)
  })

  it('o texto de reserva (se o mensagens.md falhar) é idêntico ao do arquivo', () => {
    assert.equal(VALORES_RESERVA, carregarMensagens('./mensagens.md').valores)
  })

  it('o dono pode editar a seção "valores"; sem a seção ou com arquivo ilegível, vale a reserva', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'valores-'))
    const base = readFileSync('./mensagens.md', 'utf8')
    const editado = join(pasta, 'm.md')
    writeFileSync(editado, base.replace('Temos opções que se encaixam no seu momento:', 'TEXTO NOVO DO DONO:'))
    assert.match(textoValores(criarConfigDeTeste({ MENSAGENS_PATH: editado })), /^TEXTO NOVO DO DONO:/)

    const semSecao = join(pasta, 'sem.md')
    writeFileSync(semSecao, base.slice(0, base.indexOf('## valores')))
    assert.equal(textoValores(criarConfigDeTeste({ MENSAGENS_PATH: semSecao })), VALORES_RESERVA)

    const quebrado = join(pasta, 'quebrado.md')
    writeFileSync(quebrado, 'sem as seções obrigatórias')
    assert.equal(textoValores(criarConfigDeTeste({ MENSAGENS_PATH: quebrado })), VALORES_RESERVA)
  })
})

describe('ferramenta enviar_valores', () => {
  const ferramenta = FERRAMENTAS.find((f) => f.name === 'enviar_valores')!

  it('existe, sem parâmetros, e manda usar em vez de montar a lista', () => {
    assert.ok(ferramenta)
    assert.deepEqual(ferramenta.input_schema, { type: 'object', properties: {}, additionalProperties: false })
    assert.match(ferramenta.description!, /Não precisa perguntar antes se ela quer treinar 3x por semana ou todos os dias/)
    assert.match(ferramenta.description!, /Nunca monte a lista de valores por conta própria/)
  })

  it('devolve o texto oficial com a ordem de enviar exatamente como está', async () => {
    const t = criarDepsDeAgente([usarFerramenta('enviar_valores', {}), texto('ok')])
    t.store.adicionarMensagem(CHAT, 'user', 'quero saber dos planos')
    await responder(t.deps, CHAT, undefined)
    const resultado = JSON.stringify(t.chamadas[1]!.messages.at(-1)!.content)
    assert.match(resultado, /EXATAMENTE/)
    assert.match(resultado, /\[\[nova mensagem\]\]/)
    assert.match(resultado, /Trimestral VIP — R\$ 89,90\/mês/)
    assert.match(resultado, /não faça outra/)
  })

  it('ponta a ponta: o cliente recebe 3 mensagens separadas, na ordem, sem pergunta de frequência', async () => {
    const base = criarDepsDeAgente([usarFerramenta('enviar_valores', {}), texto(textoValores(criarConfigDeTeste()))])
    const enviadas: string[] = []
    const wa: ClienteWhatsapp = {
      async enviarTexto(_p, t) {
        enviadas.push(t)
      },
      async marcarLida() {},
    }
    const deps: AtendimentoDeps = { ...base.deps, wa, avisarErro: async () => {}, pausaEntreMensagensMs: 0 }
    await tratarMensagem(deps, { wamid: 'w1', from: CHAT, nome: '', tipo: 'text', texto: 'Planos' })
    assert.deepEqual(enviadas, PARTES)
    assert.ok(!enviadas.join('').includes('3x por semana ou todos os dias?'))
    assert.ok(!enviadas.some((m) => m.includes(MARCA_NOVA_MENSAGEM)), 'as marcas nunca chegam ao cliente')
  })
})

describe('regras nas instruções para a mensagem de valores', () => {
  const i = readFileSync('./instrucoes.md', 'utf8')

  it('Trimestral VIP passa a ter convidado de 15 dias; Anual segue com 1 mês', () => {
    assert.match(i, /Trimestral VIP: \*\*3x de R\$ 89,90\*\* no cartão, ou \*\*R\$ 269,70 à vista\*\* — inclui ainda 1 convidado por 15 dias/)
    assert.match(i, /Anual VIP: \*\*12x de R\$ 69,90\*\* no cartão, ou \*\*R\$ 838,80 à vista\*\* — inclui ainda 1 convidado por 1 mês/)
  })

  it('a exceção ao limite de 3 frases e à regra de uma mensagem só está escrita', () => {
    assert.match(i, /com uma única exceção: a mensagem de valores/)
    assert.match(i, /A única exceção é a mensagem de valores da ferramenta `enviar_valores`/)
    assert.match(i, /\(valores, avaliação agendada, pedido recebido, transferência\)/)
    assert.match(i, /ela vem com duas marcas e você a envia exatamente como veio/)
  })

  it('a pergunta de frequência e a de objetivo antigas saíram do fluxo', () => {
    assert.doesNotMatch(i, /3x por semana ou todos os dias\?"/)
    assert.doesNotMatch(i, /Qual é o seu objetivo hoje\? Assim consigo/)
    assert.doesNotMatch(i, /Modelo da etapa 4/)
  })

  it('o VIP continua sendo explicado como parcelado no cartão quando a pessoa pergunta como paga', () => {
    assert.match(i, /explique que é \*\*parcelado no cartão\*\*/)
    assert.match(i, /à vista\*\*, pelo valor total|à vista, pelo valor total/)
  })
})
