import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { FERRAMENTAS, responder } from '../src/agent.js'
import { epochLocal } from '../src/agenda.js'
import { alterarAvaliacao } from '../src/minha-avaliacao.js'
import { GoogleFalso, SEGUNDA, criarDepsDeAgente, criarServico, texto, usarFerramenta } from './helpers.js'

const FUSO = 'America/Sao_Paulo'
const CHAT = '553288887777' // o WhatsApp guardou sem o 9
const NO_EVENTO = '5532988887777' // na agenda, com o 9
const MIN = 60_000

function aval(google: GoogleFalso, data: string, hhmm: string, nome: string, whatsapp?: string, id = `ev-${data}-${hhmm}`) {
  const inicio = epochLocal(data, hhmm, FUSO)
  google.eventos.push({ id, titulo: `Avaliação — ${nome}`, ocupa: true, inicio, fim: inicio + 30 * MIN, ...(whatsapp ? { privado: { whatsapp } } : {}) })
  return id
}

function montar() {
  const google = new GoogleFalso()
  const { servico, store, avisos } = criarServico({ google })
  const notificar = async (t: string) => void avisos.push(t)
  return { google, servico, store, avisos, deps: { servico, store, notificar } }
}

describe('o bot troca o nome ou o horário da avaliação do próprio cliente (sem transferir)', () => {
  it('corrige o nome: muda o título na agenda, registra e avisa a equipe', async () => {
    const t = montar()
    aval(t.google, SEGUNDA, '10:00', 'Carla', NO_EVENTO)
    const r = await alterarAvaliacao(t.deps, CHAT, { novoNome: 'Carla Jesus', data: '', hhmm: '' })
    assert.deepEqual(r, { ok: true, mensagem: 'Prontinho! O nome na avaliação agora é Carla Jesus ✅' })
    assert.equal(t.google.eventos[0]!.titulo, 'Avaliação — Carla Jesus')
    assert.match(t.avisos.at(-1)!, /Avaliação alterada pelo próprio cliente[\s\S]*Nome: de "Carla" para "Carla Jesus"/)
    assert.equal(t.store.acoesAgenda()[0]!.acao, 'renomeou')
    assert.equal(t.store.acoesAgenda()[0]!.professor, 'Assistente (WhatsApp)')
  })

  it('troca o horário no mesmo dia e avisa de onde para onde', async () => {
    const t = montar()
    aval(t.google, SEGUNDA, '10:00', 'Carla', NO_EVENTO)
    const r = await alterarAvaliacao(t.deps, CHAT, { novoNome: '', data: '', hhmm: '15:00' })
    assert.deepEqual(r, { ok: true, mensagem: 'Prontinho! Sua avaliação ficou para Segunda-feira, 19/10 às 15:00 ✅' })
    assert.equal(t.google.eventos[0]!.inicio, epochLocal(SEGUNDA, '15:00', FUSO))
    assert.match(t.avisos.at(-1)!, /Horário: de Segunda-feira, 19\/10 às 10:00 para Segunda-feira, 19\/10 às 15:00/)
  })

  it('troca dia e horário e o nome de uma vez', async () => {
    const t = montar()
    aval(t.google, SEGUNDA, '10:00', 'Carla', NO_EVENTO)
    const r = await alterarAvaliacao(t.deps, CHAT, { novoNome: 'Carla Jesus', data: '2026-10-20', hhmm: '18:30' })
    assert.equal(r.ok, true)
    assert.match(r.ok ? r.mensagem : '', /Sua avaliação ficou para Terça-feira, 20\/10 às 18:30, e o nome na avaliação agora é Carla Jesus ✅/)
    assert.equal(t.google.eventos[0]!.titulo, 'Avaliação — Carla Jesus')
    assert.equal(t.google.eventos[0]!.inicio, epochLocal('2026-10-20', '18:30', FUSO))
  })

  it('horário ocupado: mostra os livres e NUNCA o nome de quem ocupa; nada muda', async () => {
    const t = montar()
    aval(t.google, SEGUNDA, '10:00', 'Carla', NO_EVENTO)
    aval(t.google, SEGUNDA, '15:00', 'Fulana Secreta', '5511911112222')
    const r = await alterarAvaliacao(t.deps, CHAT, { novoNome: '', data: '', hhmm: '15:00' })
    assert.equal(r.ok, false)
    const motivo = !r.ok ? r.motivo : ''
    assert.match(motivo, /15:00 já está ocupado nesse dia/)
    assert.match(motivo, /Horários livres para avaliação em Segunda-feira, 19\/10/)
    assert.doesNotMatch(motivo, /Fulana/)
    assert.equal(t.google.eventos[0]!.inicio, epochLocal(SEGUNDA, '10:00', FUSO))
  })

  it('só mexe na avaliação DESTE cliente: sem avaliação dele, não acha (e não mexe na dos outros)', async () => {
    const t = montar()
    aval(t.google, SEGUNDA, '10:00', 'Outra Pessoa', '5511911112222')
    const r = await alterarAvaliacao(t.deps, CHAT, { novoNome: 'Carla', data: '', hhmm: '' })
    assert.equal(r.ok, false)
    assert.match(!r.ok ? r.motivo : '', /Não encontrei nenhuma avaliação futura marcada para este WhatsApp/)
    assert.equal(t.google.eventos[0]!.titulo, 'Avaliação — Outra Pessoa')
  })

  it('avaliação que já passou não conta; pega a próxima', async () => {
    const t = montar()
    aval(t.google, '2026-10-16', '08:00', 'Passada', NO_EVENTO) // hoje 09:00: já passou
    aval(t.google, SEGUNDA, '10:00', 'Carla', NO_EVENTO)
    await alterarAvaliacao(t.deps, CHAT, { novoNome: 'Carla Jesus', data: '', hhmm: '' })
    assert.equal(t.google.eventos[0]!.titulo, 'Avaliação — Passada')
    assert.equal(t.google.eventos[1]!.titulo, 'Avaliação — Carla Jesus')
  })

  it('acha também a avaliação que o próprio bot marcou, mesmo sem o WhatsApp no evento', async () => {
    const t = montar()
    const id = aval(t.google, SEGUNDA, '10:00', 'Carla')
    t.store.registrarAgendamento({ chat: CHAT, eventoId: id, inicio: epochLocal(SEGUNDA, '10:00', FUSO), nome: 'Carla' }, Date.UTC(2026, 9, 16))
    const r = await alterarAvaliacao(t.deps, CHAT, { novoNome: 'Carla Jesus', data: '', hhmm: '' })
    assert.equal(r.ok, true)
  })

  it('horário fora da grade, nada para mudar, mesmo horário e agenda desligada: explica sem quebrar', async () => {
    const t = montar()
    aval(t.google, SEGUNDA, '10:00', 'Carla', NO_EVENTO)
    const fora = await alterarAvaliacao(t.deps, CHAT, { novoNome: '', data: '', hhmm: '12:00' })
    assert.match(!fora.ok ? fora.motivo : '', /não existe na grade/)
    const nada = await alterarAvaliacao(t.deps, CHAT, { novoNome: '', data: '', hhmm: '' })
    assert.match(!nada.ok ? nada.motivo : '', /Diga o que mudar/)
    const igual = await alterarAvaliacao(t.deps, CHAT, { novoNome: '', data: '', hhmm: '10:00' })
    assert.match(!igual.ok ? igual.motivo : '', /já está nesse dia e horário/)
    const semGoogle = criarServico({})
    const r = await alterarAvaliacao({ servico: semGoogle.servico, store: semGoogle.store, notificar: async () => {} }, CHAT, { novoNome: 'X Y', data: '', hhmm: '' })
    assert.match(!r.ok ? r.motivo : '', /chamar_humano/)
  })

  it('pela conversa: a ferramenta devolve a confirmação para o cliente', async () => {
    const google = new GoogleFalso()
    aval(google, SEGUNDA, '10:00', 'Carla', NO_EVENTO)
    const t = criarDepsDeAgente([usarFerramenta('alterar_avaliacao', { novo_nome: 'Carla Jesus', nova_data: '', novo_horario: '' }), texto('ok')], {}, { google })
    t.store.adicionarMensagem(CHAT, 'user', 'pode trocar o nome da avaliação para Carla Jesus?')
    await responder(t.deps, CHAT, undefined)
    const resultado = JSON.stringify(t.chamadas[1]!.messages.at(-1)!.content)
    assert.match(resultado, /Prontinho! O nome na avaliação agora é Carla Jesus ✅/)
    assert.equal(t.store.emHandoff(CHAT), false, 'não transferiu')
  })
})

describe('regras: entender antes de transferir', () => {
  const i = readFileSync('./instrucoes.md', 'utf8')
  it('as instruções mandam entender o pedido e resolver o que dá antes de chamar a equipe', () => {
    assert.match(i, /\*\*Antes de chamar a equipe, entenda o pedido\.\*\*/)
    assert.match(i, /\*\*resolva você mesmo\*\*/)
    assert.match(i, /Se a mensagem estiver confusa, pergunte o que a pessoa precisa antes de transferir/)
    assert.match(i, /use \*\*alterar_avaliacao\*\*/)
    assert.match(i, /Para \*\*cancelar\*\* uma visita, chame a equipe/)
    assert.doesNotMatch(i, /não consegue mudar nem cancelar uma visita já marcada/)
  })
  it('as ferramentas também: chamar_humano manda resolver antes e aponta alterar_avaliacao', () => {
    const chamar = FERRAMENTAS.find((f) => f.name === 'chamar_humano')!.description!
    assert.match(chamar, /Antes de usar, entenda o pedido/)
    assert.match(chamar, /Para TROCAR o nome, o dia ou o horário da avaliação já marcada, use alterar_avaliacao/)
    const alterar = FERRAMENTAS.find((f) => f.name === 'alterar_avaliacao')!
    assert.match(alterar.description!, /Não cancela/)
    assert.deepEqual((alterar.input_schema as { required: string[] }).required, ['novo_nome', 'nova_data', 'novo_horario'])
  })
})
