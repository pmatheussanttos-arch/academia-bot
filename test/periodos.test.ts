import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { FERRAMENTAS, responder } from '../src/agent.js'
import { carregarAgenda, periodoDe } from '../src/agenda.js'
import { SEGUNDA, GoogleFalso, criarDepsDeAgente, criarServico, pastaTemporaria, texto, usarFerramenta } from './helpers.js'

const HORAS_MANHA = ['07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00', '10:30']
const HORAS_TARDE = ['14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30']
const HORAS_NOITE = ['18:00', '18:30', '19:00', '19:30']

describe('períodos do dia (agenda.json)', () => {
  const agenda = carregarAgenda('./agenda.json')

  it('cada horário da grade cai no período certo, inclusive nas bordas', () => {
    for (const h of HORAS_MANHA) assert.equal(periodoDe(agenda, h), 'manha', h)
    for (const h of HORAS_TARDE) assert.equal(periodoDe(agenda, h), 'tarde', h)
    for (const h of HORAS_NOITE) assert.equal(periodoDe(agenda, h), 'noite', h)
    assert.equal(periodoDe(agenda, '11:59'), 'manha')
    assert.equal(periodoDe(agenda, '12:00'), 'tarde')
    assert.equal(periodoDe(agenda, '17:59'), 'tarde')
    assert.equal(periodoDe(agenda, '18:00'), 'noite')
  })

  it('sem "periodos" no arquivo, usa o padrão; com faixa inválida, avisa qual', () => {
    const pasta = pastaTemporaria()
    const base = JSON.parse(readFileSync('./agenda.json', 'utf8'))
    delete base.periodos
    writeFileSync(join(pasta, 'a.json'), JSON.stringify(base))
    const padrao = carregarAgenda(join(pasta, 'a.json'))
    assert.equal(periodoDe(padrao, '15:00'), 'tarde')
    for (const [h, p] of [['00:00', 'manha'], ['11:59', 'manha'], ['12:00', 'tarde'], ['17:59', 'tarde'], ['18:00', 'noite'], ['23:59', 'noite']] as const) assert.equal(periodoDe(padrao, h), p, h)

    base.periodos = { manha: ['00:00', '12:59'], tarde: ['13:00', '17:59'], noite: ['18:00', '23:59'] }
    writeFileSync(join(pasta, 'b.json'), JSON.stringify(base))
    assert.equal(periodoDe(carregarAgenda(join(pasta, 'b.json')), '12:30'), 'manha', 'o dono pode mudar as faixas')

    base.periodos = { manha: ['10:00', '09:00'] }
    writeFileSync(join(pasta, 'c.json'), JSON.stringify(base))
    assert.throws(() => carregarAgenda(join(pasta, 'c.json')), /periodos\.manha/)
  })
})

describe('consultar horários por período', () => {
  it('manhã, tarde e noite devolvem só os horários do período, com o nome dele na frase', async () => {
    const { servico } = criarServico({ google: new GoogleFalso() })
    const manha = await servico.consultar('avaliacao_fisica', SEGUNDA, 'manha')
    assert.match(manha, /^Horários livres para avaliação em Segunda-feira, 19\/10 de manhã: 07:00, 07:30, 08:00, 08:30, 09:00, 09:30, 10:00, 10:30\./)
    assert.doesNotMatch(manha, /14:00|18:00/)
    const tarde = await servico.consultar('avaliacao_fisica', SEGUNDA, 'tarde')
    assert.match(tarde, /19\/10 à tarde: 14:00, 14:30, 15:00, 15:30, 16:00, 16:30, 17:00, 17:30\./)
    assert.doesNotMatch(tarde, /10:30|18:00/)
    const noite = await servico.consultar('avaliacao_fisica', SEGUNDA, 'noite')
    assert.match(noite, /19\/10 à noite: 18:00, 18:30, 19:00, 19:30\./)
    assert.doesNotMatch(noite, /Ofereça só/, 'poucos horários: sem pedir para resumir')
  })

  it('horário ocupado some da lista do período; lista longa pede para oferecer só 3 ou 4', async () => {
    const google = new GoogleFalso()
    google.ocupar(SEGUNDA, '15:00')
    const { servico } = criarServico({ google })
    const tarde = await servico.consultar('avaliacao_fisica', SEGUNDA, 'tarde')
    assert.doesNotMatch(tarde, /15:00/)
    assert.match(tarde, /14:30, 15:30/)
    assert.match(tarde, /Ofereça só 3 ou 4 desses, bem espalhados/)
  })

  it('período cheio: diz isso e mostra o que há nos outros períodos', async () => {
    const google = new GoogleFalso()
    for (const h of HORAS_NOITE) google.ocupar(SEGUNDA, h)
    const { servico } = criarServico({ google })
    const t = await servico.consultar('avaliacao_fisica', SEGUNDA, 'noite')
    assert.match(t, /^Não há horários livres para avaliação à noite em Segunda-feira, 19\/10\./)
    assert.match(t, /Há horários de manhã: 07:00.*10:30; à tarde: 14:00.*17:30\./)
    assert.match(t, /Pergunte se a pessoa prefere outro período ou outro dia/)
    assert.doesNotMatch(t, /18:00|19:30/)
  })

  it('dia inteiro cheio continua pedindo outro dia; sem período ("qualquer") fica como antes', async () => {
    const google = new GoogleFalso()
    const { servico } = criarServico({ google })
    const todos = await servico.consultar('avaliacao_fisica', SEGUNDA)
    assert.equal(todos, await servico.consultar('avaliacao_fisica', SEGUNDA, 'qualquer'))
    assert.match(todos, /Horários livres para avaliação em Segunda-feira, 19\/10: 07:00.*19:30\. Ofereça só 3 ou 4/)
    for (const h of [...HORAS_MANHA, ...HORAS_TARDE, ...HORAS_NOITE]) google.ocupar(SEGUNDA, h)
    assert.match(await servico.consultar('avaliacao_fisica', SEGUNDA, 'tarde'), /Não há horários livres para avaliação em Segunda-feira, 19\/10\. Sugira outro dia/)
  })

  it('modo manual (sem Google) e aula experimental também filtram pela grade', async () => {
    const manual = criarServico({}).servico
    const t = await manual.consultar('aula_experimental', SEGUNDA, 'noite')
    assert.match(t, /^Horários da grade em Segunda-feira, 19\/10 à noite: 18:00, 18:30, 19:00, 19:30\. Você não sabe quais já estão ocupados/)
    assert.doesNotMatch(t, /07:00|14:00/)
  })

  it('hoje: só o que ainda dá tempo (60 min de antecedência) dentro do período', async () => {
    const { servico } = criarServico({ google: new GoogleFalso() }) // sexta 16/10, 09:00
    const manha = await servico.consultar('avaliacao_fisica', '2026-10-16', 'manha')
    assert.match(manha, /16\/10 de manhã: 10:00, 10:30\./)
    assert.doesNotMatch(manha, /09:/)
  })

  it('Google fora do ar: ainda filtra pelo período, avisando que não sabe o que está ocupado', async () => {
    const google = new GoogleFalso()
    google.falhar = true
    const t = await criarServico({ google }).servico.consultar('avaliacao_fisica', SEGUNDA, 'tarde')
    assert.match(t, /^A agenda está indisponível agora\. Horários da grade em Segunda-feira, 19\/10 à tarde: 14:00/)
    assert.match(t, /equipe confirma a disponibilidade/)
  })
})

describe('ferramenta consultar_horarios com período', () => {
  it('o esquema exige o período (com as 4 opções) e o modelo é mandado perguntar antes', () => {
    const f = FERRAMENTAS.find((x) => x.name === 'consultar_horarios')!
    const schema = f.input_schema as { properties: Record<string, { enum?: string[]; description?: string }>; required: string[] }
    assert.deepEqual(schema.properties.periodo!.enum, ['manha', 'tarde', 'noite', 'qualquer'])
    assert.ok(schema.required.includes('periodo'))
    assert.match(schema.properties.periodo!.description!, /Prefere de manhã, à tarde ou à noite/)
  })

  it('o período escolhido chega à agenda; valor inválido ou ausente vira "qualquer"', async () => {
    const volta = async (entrada: Record<string, unknown>) => {
      const t = criarDepsDeAgente([usarFerramenta('consultar_horarios', { tipo: 'avaliacao_fisica', data: SEGUNDA, ...entrada }), texto('ok')], {}, { google: new GoogleFalso() })
      t.store.adicionarMensagem('5511977776666', 'user', 'quero avaliação')
      await responder(t.deps, '5511977776666', 'M')
      return JSON.stringify(t.chamadas[1]!.messages.at(-1)!.content)
    }
    const tarde = await volta({ periodo: 'tarde' })
    assert.match(tarde, /à tarde: 14:00/)
    assert.doesNotMatch(tarde, /07:00/)
    for (const entrada of [{ periodo: 'madrugada' }, {}]) assert.match(await volta(entrada), /19\/10: 07:00/)
  })

  it('as instruções mandam perguntar o período antes de listar horários', () => {
    const instrucoes = readFileSync('./instrucoes.md', 'utf8')
    assert.match(instrucoes, /pergunte antes: "Prefere de manhã, à tarde ou à noite\?"/)
    assert.match(instrucoes, /Não liste horários antes disso/)
    assert.match(instrucoes, /não pergunte de novo/)
    assert.match(instrucoes, /consultar_horarios \(tipo, data AAAA-MM-DD e periodo\)/)
  })
})
