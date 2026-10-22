import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { MARCA_NOVA_MENSAGEM, dividirEmMensagens, tratarMensagem, type AtendimentoDeps } from '../src/atendimento.js'
import { FERRAMENTAS } from '../src/agent.js'
import { REGRAS_FIXAS } from '../src/prompt.js'
import type { ClienteWhatsapp, MensagemRecebida } from '../src/whatsapp.js'
import { criarDepsDeAgente, texto } from './helpers.js'

const CHAT = '5511977776666'
const instrucoes = () => readFileSync('./instrucoes.md', 'utf8')

describe('identidade e condução da conversa (GFIT)', () => {
  const i = instrucoes()

  it('o bot se apresenta como GFIT com a frase exata da primeira mensagem', () => {
    assert.match(i, /Você é o \*\*GFIT\*\*, atendente virtual da \*\*GarageFit Academia\*\*/)
    assert.match(i, /"Olá! Eu sou o GFIT, atendente virtual aqui da GarageFit 😊 Vou te ajudar\. Primeiramente, qual o seu nome\?"/)
    assert.match(i, /mesmo que a pessoa já chegue perguntando preço ou plano/)
  })

  it('mensagens curtas, uma pergunta só, nada de despejar planos', () => {
    assert.match(i, /no máximo \*\*3 frases curtas\*\* e termina com \*\*UMA pergunta só\*\*/)
    assert.match(i, /Nunca mande vários planos, vários valores ou textos longos de uma vez/)
    assert.match(i, /Nunca despejar vários planos, vários valores ou textos longos de uma vez, nem fazer duas perguntas na mesma mensagem/)
  })

  it('nunca inventa o nome: pergunta e depois usa', () => {
    assert.match(i, /nunca presuma nem invente o nome da pessoa, e nunca use o nome do perfil do WhatsApp/i)
    assert.match(i, /"Prazer, \[nome\]! O que você busca hoje\? Quer saber dos planos ou é outra coisa\?"/)
    assert.match(REGRAS_FIXAS, /Nunca invente, deduza ou chute o nome do cliente/)
    const nome = (FERRAMENTAS.find((f) => f.name === 'solicitar_avaliacao')!.input_schema as { properties: Record<string, { description: string }> }).properties.nome!.description
    assert.match(nome, /Nunca invente nem use o nome do perfil/)
  })

  it('pergunta a frequência antes de dar preço', () => {
    assert.match(i, /"Você gostaria de treinar 3x por semana ou todos os dias\?" Não dê nenhum preço antes de saber isso/)
    assert.match(i, /\*\*Só dê preço depois de saber o que a pessoa quer\*\*/)
    assert.match(i, /Nunca dar preço antes de saber a frequência/)
  })

  it('objetivo, recomendação do VIP maior e aceitar o "não"', () => {
    assert.match(i, /"Qual é o seu objetivo hoje\? Assim consigo te indicar o melhor plano\."/)
    assert.match(i, /recomende o VIP de maior duração/)
    assert.match(i, /R\$ 69,90, menos que o 3x por semana de R\$ 89,90/)
    assert.match(i, /aceite na hora, sem insistir.*no máximo uma vez/s)
    assert.match(i, /Se ela perguntar por um plano mais barato, nunca esconda/)
  })

  it('conduz para aula experimental ou avaliação', () => {
    assert.match(i, /conduza para o próximo passo: aula experimental gratuita ou avaliação física/)
  })
})

describe('como os preços são explicados', () => {
  const i = instrucoes()

  it('básicos: mensal, sem fidelidade, sem parcelamento', () => {
    assert.match(i, /3x por semana: \*\*R\$ 89,90 por mês\*\*/)
    assert.match(i, /Acesso livre: \*\*R\$ 99,90 por mês\*\*/)
    assert.match(i, /\*\*mensal\*\*, \*\*sem fidelidade\*\* e \*\*sem parcelamento\*\*/)
  })

  it('VIP: parcelas no cartão e o total à vista, nunca "por mês"', () => {
    assert.match(i, /Trimestral VIP: \*\*3x de R\$ 89,90\*\* no cartão, ou \*\*R\$ 269,70 à vista\*\*/)
    assert.match(i, /Semestral VIP: \*\*6x de R\$ 79,90\*\* no cartão, ou \*\*R\$ 479,40 à vista\*\*/)
    assert.match(i, /Anual VIP: \*\*12x de R\$ 69,90\*\* no cartão, ou \*\*R\$ 838,80 à vista\*\*/)
    assert.match(i, /nunca diga "R\$ X por mês" sozinho/)
    assert.doesNotMatch(i, /Trimestral VIP: R\$ 89,90\/mês|Semestral VIP: R\$ 79,90\/mês|Anual VIP: R\$ 69,90\/mês/, 'o formato antigo "por mês" não pode ter sobrado')
  })

  it('as contas do à vista batem com as parcelas (o desconto já está no plano)', () => {
    for (const [parcelas, valor, total] of [[3, 89.9, 269.7], [6, 79.9, 479.4], [12, 69.9, 838.8]] as const) {
      assert.equal(Math.round(parcelas * valor * 100) / 100, total, `${parcelas}x de ${valor}`)
    }
    assert.match(i, /O valor à vista é exatamente a soma das parcelas/)
  })

  it('VIP inclui avaliação grátis e acesso livre', () => {
    assert.match(i, /Planos VIP\*\* — incluem \*\*avaliação física grátis\*\* e \*\*acesso livre\*\*/)
  })

  it('formas de pagamento: Pix e cartão, e nada além disso', () => {
    assert.match(i, /só \*\*Pix\*\* e \*\*cartão\*\*\. Não invente boleto, débito automático nem outra forma/)
    assert.match(i, /a chave é o CNPJ 35\.950\.235\/0001-29/)
    assert.match(i, /\*\*Cartão:\*\* é passado \*\*na recepção da academia\*\*/)
    assert.match(i, /- \*\*Formas de pagamento:\*\* \*\*Pix\*\* \(chave CNPJ: 35\.950\.235\/0001-29\) e \*\*cartão\*\*/)
    assert.equal((i.match(/boleto/gi) ?? []).length, 1, 'a palavra "boleto" só aparece na proibição')
    assert.match(i, /Não invente boleto/)
  })

  it('a chave Pix não é solta no meio da conversa: só na hora de fechar', () => {
    assert.match(i, /Só passe a chave na hora de fechar a matrícula, usando a ferramenta `registrar_matricula`/)
    assert.match(i, /não solte a chave no meio da conversa/)
  })

  it('o que NÃO podia mudar continua igual: GoNutri, Desconto Fácil, avaliação e parcerias', () => {
    assert.match(i, /3x por semana \+ GoNutri: R\$ 110,00\/mês/)
    assert.match(i, /Acesso livre \+ GoNutri: R\$ 129,90\/mês/)
    assert.match(i, /3x por semana: de R\$ 89,90 por R\$ 80,00/)
    assert.match(i, /Acesso livre: de R\$ 99,90 por R\$ 89,90/)
    assert.match(i, /\*\*Avaliação física:\*\* R\$ 35,00 \(grátis nos planos VIP\)/)
    assert.match(i, /no ato[^.]*avaliação[^.]*mensalidade do primeiro mês/i)
    for (const p of ['Wellhub', 'TotalPass', 'TP GO', 'Asserv', 'Bahamas Mix']) assert.ok(i.includes(p), p)
  })
})

describe('mandar duas mensagens seguidas', () => {
  it('quebra na marca e limpa o texto', () => {
    assert.deepEqual(dividirEmMensagens(`Primeira.\n${MARCA_NOVA_MENSAGEM}\nSegunda?`), ['Primeira.', 'Segunda?'])
    assert.deepEqual(dividirEmMensagens('  [[NOVA MENSAGEM]]  \nSó uma.'), ['Só uma.'], 'marca no começo não vira mensagem vazia')
    assert.deepEqual(dividirEmMensagens('Sem marca nenhuma.'), ['Sem marca nenhuma.'])
    assert.deepEqual(dividirEmMensagens('   '), [])
  })

  it('marca solta no meio da frase é apagada, nunca aparece para o cliente', () => {
    assert.deepEqual(dividirEmMensagens('Olá [[nova mensagem]] tudo bem?'), ['Olá tudo bem?'])
    assert.doesNotMatch(dividirEmMensagens('a\n[[nova mensagem]]\nb [[nova mensagem]] c').join(' '), /nova mensagem/)
  })

  it('o assistente não pode picotar demais: no máximo 3 mensagens', () => {
    const partes = dividirEmMensagens(['a', 'b', 'c', 'd', 'e'].join(`\n${MARCA_NOVA_MENSAGEM}\n`))
    assert.equal(partes.length, 3)
    assert.equal(partes[2], 'c\n\nd\n\ne')
  })

  it('no atendimento, chegam duas mensagens de WhatsApp e uma linha no histórico', async () => {
    const base = criarDepsDeAgente([texto(`O 3x fica R$ 89,90 por mês.\n${MARCA_NOVA_MENSAGEM}\nQual é o seu objetivo hoje?`)])
    const enviadas: string[] = []
    const wa: ClienteWhatsapp = { async enviarTexto(_p, t) { enviadas.push(t) }, async marcarLida() {} }
    const deps: AtendimentoDeps = { ...base.deps, wa, avisarErro: async () => {}, pausaEntreMensagensMs: 0 }
    const msg: MensagemRecebida = { wamid: 'w1', from: CHAT, nome: 'Maria', tipo: 'text', texto: '3x por semana' }
    await tratarMensagem(deps, msg)
    assert.deepEqual(enviadas, ['O 3x fica R$ 89,90 por mês.', 'Qual é o seu objetivo hoje?'])
    const historico = base.store.historico(CHAT, 10)
    assert.equal(historico.filter((h) => h.papel === 'assistant').length, 1)
    assert.doesNotMatch(historico.at(-1)!.conteudo, /nova mensagem/)
  })

  it('resposta sem marca continua sendo uma mensagem só', async () => {
    const base = criarDepsDeAgente([texto('Prazer, Maria! O que você busca hoje?')])
    const enviadas: string[] = []
    const deps: AtendimentoDeps = { ...base.deps, wa: { async enviarTexto(_p, t) { enviadas.push(t) }, async marcarLida() {} }, avisarErro: async () => {}, pausaEntreMensagensMs: 0 }
    await tratarMensagem(deps, { wamid: 'w2', from: CHAT, nome: 'Maria', tipo: 'text', texto: 'Maria' })
    assert.deepEqual(enviadas, ['Prazer, Maria! O que você busca hoje?'])
  })

  it('as instruções explicam a marca e as exceções ao limite de 3 frases', () => {
    const i = instrucoes()
    assert.match(i, /separadas por uma linha com `\[\[nova mensagem\]\]`/)
    assert.match(i, /no máximo uma marca dessas por resposta/)
    assert.match(i, /envie \*\*exatamente\*\* como vieram, mesmo que sejam longas/)
  })
})
