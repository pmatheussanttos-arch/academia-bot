import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { FERRAMENTAS, responder, textoMatricula } from '../src/agent.js'
import { IDADE_MINIMA, avisoDeMatricula, idadeEm, normalizarNascimento, normalizarTelefone, validarMatricula } from '../src/matricula.js'
import { REGRAS_FIXAS } from '../src/prompt.js'
import { AGORA, criarDepsDeAgente, texto, usarFerramenta } from './helpers.js'

const CHAT = '5511977776666'
const COMPLETO = { nome: 'Maria Silva Souza', telefone: '(11) 97777-6666', email: 'maria@email.com', nascimento: '25/03/1990', plano: 'Anual VIP (12x de R$ 69,90)', pagamento: 'pix', observacao: '' }
const instrucoes = () => readFileSync('./instrucoes.md', 'utf8')

describe('dados da matrícula', () => {
  it('telefone: aceita formatos comuns e recusa o que não é telefone', () => {
    assert.equal(normalizarTelefone('(11) 97777-6666'), '5511977776666')
    assert.equal(normalizarTelefone('+55 11 97777 6666'), '5511977776666')
    assert.equal(normalizarTelefone('1133334444'), '551133334444')
    for (const ruim of ['', '123', 'abc', '99999']) assert.equal(normalizarTelefone(ruim), '', ruim)
  })

  it('nascimento: aceita 25/03/1990, 25-03-1990 e 1990-03-25; recusa data que não existe', () => {
    for (const bom of ['25/03/1990', '25-03-1990', '1990-03-25', '5/3/1990']) assert.match(normalizarNascimento(bom), /^1990-03-0?[25]|^1990-03-25$/, bom)
    assert.equal(normalizarNascimento('25/03/1990'), '1990-03-25')
    assert.equal(normalizarNascimento('1990-03-25'), '1990-03-25')
    for (const ruim of ['31/02/1990', '25/13/1990', 'ontem', '1990', '']) assert.equal(normalizarNascimento(ruim), '', ruim)
  })

  it('idade: conta certo antes e depois do aniversário', () => {
    assert.equal(idadeEm('1990-03-25', new Date('2026-10-22T12:00:00Z')), 36)
    assert.equal(idadeEm('1990-12-25', new Date('2026-10-22T12:00:00Z')), 35, 'ainda não fez aniversário')
    assert.equal(idadeEm('2026-10-22', new Date('2026-10-22T12:00:00Z')), 0)
  })

  it('aceita o cadastro completo e normaliza tudo', () => {
    const v = validarMatricula(COMPLETO, AGORA)
    assert.ok(v.ok)
    assert.deepEqual(v.dados, { nome: 'Maria Silva Souza', telefone: '5511977776666', email: 'maria@email.com', nascimento: '1990-03-25', plano: 'Anual VIP (12x de R$ 69,90)', pagamento: 'pix', observacao: '' })
  })

  it('e-mail e nascimento são opcionais; cartão também vale', () => {
    const v = validarMatricula({ ...COMPLETO, email: '', nascimento: '', pagamento: 'cartão' }, AGORA)
    assert.ok(v.ok)
    assert.deepEqual([v.dados.email, v.dados.nascimento, v.dados.pagamento], ['', '', 'cartao'])
  })

  it('diz o que falta, em português, para o assistente perguntar de novo', () => {
    const casos: Array<[Record<string, string>, RegExp]> = [
      [{ nome: 'Maria' }, /nome e o sobrenome/],
      [{ nome: '   ' }, /nome e o sobrenome/],
      [{ telefone: '123' }, /Telefone inválido/],
      [{ email: 'maria@' }, /E-mail inválido/],
      [{ nascimento: '31/02/1990' }, /Data de nascimento inválida/],
      [{ nascimento: '25/03/1890' }, /fora do comum/],
      [{ plano: '' }, /Falta o plano/],
      [{ pagamento: '' }, /Pix ou no cartão/],
      [{ pagamento: 'boleto' }, /Pix ou no cartão/],
    ]
    for (const [mudanca, regex] of casos) {
      const v = validarMatricula({ ...COMPLETO, ...mudanca }, AGORA)
      assert.equal(v.ok, false, JSON.stringify(mudanca))
      assert.match(!v.ok ? v.motivo : '', regex)
    }
  })

  it('menor de 13 anos não é matriculado: manda chamar a equipe', () => {
    const v = validarMatricula({ ...COMPLETO, nascimento: '25/03/2020' }, AGORA)
    assert.equal(v.ok, false)
    assert.match(!v.ok ? v.motivo : '', new RegExp(`idade mínima é ${IDADE_MINIMA}.*chamar_humano`, 's'))
  })

  it('o aviso para a equipe traz tudo o que ela precisa lançar', () => {
    const v = validarMatricula(COMPLETO, AGORA)
    assert.ok(v.ok)
    const aviso = avisoDeMatricula(v.dados, CHAT)
    assert.match(aviso, /MATRÍCULA PELO WHATSAPP/)
    assert.match(aviso, /Nome: Maria Silva Souza/)
    assert.match(aviso, /Telefone: \+5511977776666/)
    assert.match(aviso, /E-mail: maria@email\.com/)
    assert.match(aviso, /Nascimento: 25\/03\/1990/)
    assert.match(aviso, /Plano: Anual VIP/)
    assert.match(aviso, /Pagamento: Pix.*confira o comprovante/)
    assert.match(aviso, /Conversa: \+5511977776666/)

    const semDados = validarMatricula({ ...COMPLETO, email: '', nascimento: '', pagamento: 'cartao' }, AGORA)
    assert.ok(semDados.ok)
    const outro = avisoDeMatricula(semDados.dados, CHAT)
    assert.match(outro, /E-mail: \(não informado\)/)
    assert.match(outro, /Pagamento: cartão na recepção/)
  })
})

describe('ferramenta registrar_matricula', () => {
  const ferramenta = FERRAMENTAS.find((f) => f.name === 'registrar_matricula')!

  it('existe, pede todos os campos e deixa claro que não confirma pagamento', () => {
    const schema = ferramenta.input_schema as { properties: Record<string, { enum?: string[] }>; required: string[] }
    assert.deepEqual(schema.required.sort(), ['email', 'ja_pagou', 'nascimento', 'nome', 'observacao', 'pagamento', 'plano', 'telefone'])
    assert.deepEqual(schema.properties.pagamento!.enum, ['pix', 'cartao'])
    assert.match(ferramenta.description!, /Não confirma pagamento: quem confere é a recepção/)
  })

  it('Pix: registra, avisa a equipe e manda a mensagem com a chave', async () => {
    const t = criarDepsDeAgente([usarFerramenta('registrar_matricula', COMPLETO), texto('ok')])
    t.store.adicionarMensagem(CHAT, 'user', 'quero fechar o anual')
    await responder(t.deps, CHAT, 'Maria')

    const salva = t.store.matriculas()[0]!
    assert.deepEqual([salva.nome, salva.telefone, salva.plano, salva.pagamento, salva.chat], ['Maria Silva Souza', '5511977776666', 'Anual VIP (12x de R$ 69,90)', 'pix', CHAT])
    assert.match(t.avisos.at(-1)!, /MATRÍCULA PELO WHATSAPP[\s\S]*Maria Silva Souza/)

    const resultado = JSON.stringify(t.chamadas[1]!.messages.at(-1)!.content)
    assert.match(resultado, /EXATAMENTE/)
    assert.match(resultado, /Não diga que o pagamento foi recebido/)
    assert.match(resultado, /35\.950\.235\/0001-29/)
    assert.match(resultado, /Prontinho, Maria!/, 'usa só o primeiro nome')
    assert.match(resultado, /Anual VIP/)
  })

  it('cartão com plano que tem link: a mensagem traz o link seguro e NÃO traz a chave Pix', async () => {
    const t = criarDepsDeAgente([usarFerramenta('registrar_matricula', { ...COMPLETO, pagamento: 'cartao' }), texto('ok')])
    t.store.adicionarMensagem(CHAT, 'user', 'vou de cartão')
    await responder(t.deps, CHAT, 'Maria')
    const resultado = JSON.stringify(t.chamadas[1]!.messages.at(-1)!.content)
    assert.match(resultado, /https:\/\/link\.infinitepay\.io\/garagefitacad\/VC1DLUMtSQ-htztVZNxF4-838,80/, 'o link do Anual VIP')
    assert.match(resultado, /nunca por aqui/)
    assert.match(resultado, /me enviar o comprovante/)
    assert.doesNotMatch(resultado, /35\.950\.235/, 'no cartão a chave Pix não aparece')
  })

  it('cartão com plano SEM link: cai na recepção, como antes', async () => {
    const t = criarDepsDeAgente([usarFerramenta('registrar_matricula', { ...COMPLETO, plano: 'Plano especial', pagamento: 'cartao' }), texto('ok')])
    t.store.adicionarMensagem(CHAT, 'user', 'vou de cartão')
    await responder(t.deps, CHAT, 'Maria')
    const resultado = JSON.stringify(t.chamadas[1]!.messages.at(-1)!.content)
    assert.match(resultado, /recepção da academia/)
    assert.doesNotMatch(resultado, /infinitepay/)
    assert.doesNotMatch(resultado, /35\.950\.235/)
  })

  it('dado faltando: nada é registrado e o motivo volta para o assistente perguntar', async () => {
    const t = criarDepsDeAgente([usarFerramenta('registrar_matricula', { ...COMPLETO, nome: 'Maria' }), texto('Qual é o seu sobrenome?')])
    t.store.adicionarMensagem(CHAT, 'user', 'quero fechar')
    await responder(t.deps, CHAT, 'Maria')
    assert.equal(t.store.matriculas().length, 0)
    assert.equal(t.avisos.length, 0, 'a equipe não é avisada de uma matrícula incompleta')
    assert.match(JSON.stringify(t.chamadas[1]!.messages.at(-1)!.content), /nome e o sobrenome/)
  })

  it('o texto vem do mensagens.md, que o dono pode editar', () => {
    const { cfg } = criarDepsDeAgente([])
    const pix = textoMatricula(cfg, 'pix', 'Maria', 'Anual VIP')
    assert.match(pix, /Prontinho, Maria!/)
    assert.match(pix, /35\.950\.235\/0001-29/)
    assert.match(pix, /Anual VIP/)
    assert.doesNotMatch(pix, /\{nome\}|\{plano\}/, 'os campos foram preenchidos')

    const semArquivo = textoMatricula({ ...cfg, mensagensPath: '/nao/existe.md' }, 'pix', 'Ana', 'Mensal')
    assert.match(semArquivo, /Prontinho, Ana!/, 'sem o arquivo, usa a reserva do código')
    assert.match(semArquivo, /35\.950\.235\/0001-29/)
  })
})

describe('instruções da matrícula', () => {
  const i = instrucoes()

  it('conduz sempre para a venda e pede os dados um por mensagem', () => {
    assert.match(i, /levar a pessoa a fechar um plano/)
    assert.match(i, /recolha os dados \*\*um por mensagem\*\*/)
    assert.match(i, /\*\*Nome completo\*\* \(nome e sobrenome\)/)
    assert.match(i, /O \*\*telefone\*\* é o do próprio WhatsApp da conversa: \*\*não pergunte\*\*/)
    assert.match(i, /\*\*E-mail e data de nascimento não são necessários\*\*/)
    assert.match(i, /"Vai ser no Pix ou no cartão\?"/)
    assert.match(i, /ferramenta \*\*registrar_matricula\*\*/)
  })

  it('o bot NUNCA diz que o pagamento caiu; ao receber o comprovante não pede nome nem transfere', () => {
    assert.match(i, /\*\*Nunca\*\* diga que o pagamento foi recebido, confirmado ou que "está tudo pago": você não tem como conferir/)
    assert.match(i, /\*\*Peça SEMPRE o comprovante\*\*/)
    assert.match(i, /o \*\*sistema responde sozinho\*\* \("Recebi a imagem! A equipe vai dar uma olhada\.\.\."\)/)
    assert.match(i, /\*\*Não peça o nome\*\* nem nenhum outro dado por causa do comprovante/)
    assert.match(i, /\*\*Não use chamar_humano\*\* nem diga "vou te transferir para um atendente" por causa do comprovante/)
    assert.doesNotMatch(i, /Pergunte \*\*só\*\*: "Tem mais alguma dúvida\?"/)
    assert.match(REGRAS_FIXAS, /Nunca diga que um pagamento foi recebido, confirmado ou compensado/)
  })
})

describe('matrículas na página do dono', () => {
  it('lista os cadastros com os dados para lançar na plataforma, e escapa o que o cliente escreveu', async () => {
    const { criarApp } = await import('../src/app.js')
    const { FilaPorChave } = await import('../src/fila.js')
    const base = criarDepsDeAgente([], { WHATSAPP_MODO: 'qr', ADMIN_TOKEN: 'segredo-admin' })
    const app = criarApp({ ...base.deps, wa: { async enviarTexto() {}, async marcarLida() {} }, avisarErro: async () => {}, fila: new FilaPorChave(), whatsappEstado: () => ({ status: 'conectado', desde: Date.now() }), iniciadoEm: Date.now() })

    assert.match(await (await app.request('/conectar?token=segredo-admin&aba=vendas')).text(), /Nenhuma por enquanto/)

    base.store.registrarMatricula({ chat: CHAT, nome: 'Maria Silva', telefone: '5511977776666', email: 'maria@email.com', nascimento: '1990-03-25', plano: 'Anual VIP', pagamento: 'pix', observacao: '<b>indicação</b>' })
    const html = await (await app.request('/conectar?token=segredo-admin&aba=vendas')).text()
    assert.match(html, /Matrículas pelo WhatsApp \(1\)/)
    assert.match(html, /Maria Silva/)
    assert.match(html, /Anual VIP/)
    assert.match(html, /25\/03\/1990/)
    assert.match(html, /wa\.me\/5511977776666/)
    assert.doesNotMatch(html, /<b>indicação<\/b>/, 'o que o cliente escreve não vira HTML')
    assert.match(html, /&lt;b&gt;indicação/)

    const api = await app.request('/admin/matriculas?token=segredo-admin')
    assert.equal(api.status, 200)
    assert.equal(((await api.json()) as { matriculas: unknown[] }).matriculas.length, 1)
    assert.equal((await app.request('/admin/matriculas')).status, 401)
  })
})
