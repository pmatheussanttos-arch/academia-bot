import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { carregarAgenda, diaDaSemana, epochLocal, gradeDoDia, hojeISO, horariosDoDia, limitesDoDia, rotulo, somarDias } from '../src/agenda.js'
import { carregarMensagens, renderizar } from '../src/mensagens.js'
import { AGORA, SEGUNDA, pastaTemporaria } from './helpers.js'

const FUSO = 'America/Sao_Paulo'
const agenda = carregarAgenda('./agenda.json')

describe('agenda.json entregue com o projeto', () => {
  it('tem as janelas combinadas: segunda a sexta, 7:00–10:30 e 14:00–19:30, de 30 em 30 minutos', () => {
    const manha = ['07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00', '10:30']
    const tarde = ['14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30']
    for (const dia of ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']) {
      assert.deepEqual(horariosDoDia(agenda, dia), [...manha, ...tarde], dia)
    }
    assert.deepEqual(horariosDoDia(agenda, '2026-10-24'), [], 'sábado')
    assert.deepEqual(horariosDoDia(agenda, '2026-10-25'), [], 'domingo')
    assert.equal(agenda.capacidade, 1)
  })
})

describe('validação do agenda.json', () => {
  const gravar = (conteudo: unknown) => {
    const arq = join(pastaTemporaria(), 'agenda.json')
    writeFileSync(arq, typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo))
    return arq
  }
  const base = { fusoHorario: FUSO, duracaoMin: 30, capacidade: 1, diasMaximoFuturo: 14, janelas: { seg: [['07:00', '10:30']] } }

  it('aceita uma configuração mínima', () => {
    assert.equal(carregarAgenda(gravar(base)).janelas.ter.length, 0)
  })
  it('recusa horários e datas inválidos com mensagem clara', () => {
    assert.throws(() => carregarAgenda(gravar({ ...base, janelas: { seg: [['25:00', '10:30']] } })), /intervalo inválido/)
    assert.throws(() => carregarAgenda(gravar({ ...base, janelas: { seg: [['10:30', '07:00']] } })), /intervalo inválido/)
    assert.throws(() => carregarAgenda(gravar({ ...base, diasFechados: ['2026-02-30'] })), /datas reais/)
    assert.throws(() => carregarAgenda(gravar({ ...base, fusoHorario: 'Marte/Olimpo' })), /fuso horário desconhecido/)
    assert.throws(() => carregarAgenda(gravar({ ...base, duracaoMin: 0 })), /duracaoMin/)
    assert.throws(() => carregarAgenda(gravar('{quebrado')), /Não consegui ler/)
  })
})

describe('datas e horas', () => {
  it('converte a hora de Brasília para o instante certo (UTC-3)', () => {
    assert.equal(new Date(epochLocal(SEGUNDA, '10:00', FUSO)).toISOString(), '2026-10-19T13:00:00.000Z')
    assert.equal(new Date(epochLocal(SEGUNDA, '00:00', FUSO)).toISOString(), '2026-10-19T03:00:00.000Z')
  })
  it('descobre o dia da semana, o "hoje" local e soma dias', () => {
    assert.equal(diaDaSemana(SEGUNDA), 'seg')
    assert.equal(diaDaSemana('2026-10-24'), 'sab')
    assert.equal(hojeISO(AGORA, FUSO), '2026-10-16')
    assert.equal(hojeISO(new Date('2026-10-17T01:30:00Z'), FUSO), '2026-10-16', 'madrugada UTC ainda é o dia anterior em Brasília')
    assert.equal(somarDias('2026-12-31', 1), '2027-01-01')
  })
  it('monta o rótulo em português', () => {
    const r = rotulo(epochLocal(SEGUNDA, '10:00', FUSO), FUSO)
    assert.deepEqual(r, { diaSemana: 'segunda-feira', data: '19/10', hora: '10:00', dia: 'Segunda-feira, 19/10' })
  })
  it('limites do dia cobrem 24 horas locais', () => {
    const { de, ate } = limitesDoDia(agenda, SEGUNDA)
    assert.equal(ate - de, 86_400_000)
    assert.equal(new Date(de).toISOString(), '2026-10-19T03:00:00.000Z')
  })
})

describe('gradeDoDia', () => {
  it('lista os horários de uma segunda futura', () => {
    const g = gradeDoDia(agenda, SEGUNDA, AGORA)
    assert.ok(g.ok)
    assert.equal(g.slots.length, 20)
    assert.equal(g.rotuloDia, 'Segunda-feira, 19/10')
    assert.equal(g.slots[0]?.hhmm, '07:00')
  })
  it('aplica a antecedência mínima no próprio dia (agora é 09:00, mínimo 60 min)', () => {
    const g = gradeDoDia(agenda, '2026-10-16', AGORA)
    assert.ok(g.ok)
    assert.equal(g.slots[0]?.hhmm, '10:00', '10:00 ainda vale, 09:30 não')
    assert.equal(g.slots.at(-1)?.hhmm, '19:30')
  })
  it('recusa passado, sábado, domingo, longe demais, dia fechado e data inválida', () => {
    const erro = (data: string, ag = agenda) => {
      const g = gradeDoDia(ag, data, AGORA)
      assert.ok(!g.ok, data)
      return g.motivo
    }
    assert.match(erro('2026-10-15'), /já passou/)
    assert.match(erro('2026-10-17'), /aos sábados/)
    assert.match(erro('2026-10-18'), /segunda-feira, terça-feira/)
    assert.match(erro('2026-11-30'), /até 14 dias/)
    assert.match(erro('2026-13-45'), /Data inválida/)
    assert.match(erro('amanhã'), /Data inválida/)
    assert.match(erro(SEGUNDA, { ...agenda, diasFechados: [SEGUNDA] }), /Não há visitas/)
  })
  it('depois do último horário do dia, avisa que não há mais', () => {
    const noite = new Date('2026-10-16T22:30:00Z') // 19:30 em Brasília
    const g = gradeDoDia(agenda, '2026-10-16', noite)
    assert.ok(!g.ok)
    assert.match(g.motivo, /Não há mais horários/)
  })
})

describe('mensagens.md entregue com o projeto', () => {
  const m = carregarMensagens('./mensagens.md')
  it('renderiza a avaliação agendada para um novo aluno', () => {
    const t = renderizar(m['avaliacao-agendada']!, { dia: 'Segunda-feira, 19/10', hora: '10:00', linha_valor: m['linha-valor-pago']!, linha_mensalidade: m['linha-mensalidade']! })
    assert.match(t, /^Perfeito! Avaliação agendada! ✅/)
    assert.match(t, /📅 Segunda-feira, 19\/10\n⏰ 10:00/)
    assert.match(t, /R\$ 35,00/)
    assert.match(t, /A mensalidade é paga junto/)
    assert.doesNotMatch(t, /\{|\}/)
  })
  it('sem a linha da mensalidade não sobra linha em branco dupla', () => {
    const t = renderizar(m['avaliacao-agendada']!, { dia: 'x', hora: 'y', linha_valor: m['linha-valor-vip']!, linha_mensalidade: '' })
    assert.match(t, /Avaliação gratuita nos planos VIP\./)
    assert.doesNotMatch(t, /\n\n\n/)
    assert.doesNotMatch(t, /mensalidade/)
  })
  it('recusa um mensagens.md incompleto', () => {
    const arq = join(pastaTemporaria(), 'mensagens.md')
    writeFileSync(arq, '## avaliacao-agendada\nOi')
    assert.throws(() => carregarMensagens(arq), /sem as seções/)
  })
})
