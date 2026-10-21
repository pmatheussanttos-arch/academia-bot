import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { epochLocal } from '../src/agenda.js'
import { PainelAgenda, ErroPainel, ehAvaliacao, nomeDoCliente, normalizarWhatsapp, segundaDaSemana, whatsappDoEvento } from '../src/painel-agenda.js'
import { AGORA, GoogleFalso, SEGUNDA, criarServico } from './helpers.js'

const FUSO = 'America/Sao_Paulo'
const TERCA = '2026-10-20'
const WA = '5511977776666'

function montar(opcoes: { capacidade?: number } = {}) {
  const google = new GoogleFalso()
  const { servico, store } = criarServico({ google, ...opcoes })
  return { google, servico, store, painel: new PainelAgenda(servico, store) }
}

const marcarPedido = (extra = {}) => ({ data: SEGUNDA, hhmm: '10:00', nome: 'Maria Silva', whatsapp: '(11) 97777-6666', obs: 'quer plano VIP', professor: 'Ana', ...extra })

async function erroDe(p: Promise<unknown>): Promise<ErroPainel> {
  try {
    await p
  } catch (e) {
    assert.ok(e instanceof ErroPainel, `esperava ErroPainel, veio ${e}`)
    return e
  }
  assert.fail('esperava um erro')
}

describe('textos e números dos eventos', () => {
  it('reconhece avaliação pelo começo do título, e só ela', () => {
    for (const t of ['Avaliação — Maria', 'avaliacao - João', 'AVALIAÇÃO – Ana', 'Avaliação', ' Avaliação — X']) assert.equal(ehAvaliacao(t), true, t)
    for (const t of ['Reunião', 'FECHADO - feriado', 'Pré-avaliação', 'Minha avaliação', 'Avaliações da semana', 'Aniversário', '']) assert.equal(ehAvaliacao(t), false, t)
  })

  it('tira o nome do cliente do título', () => {
    assert.equal(nomeDoCliente('Avaliação — Maria Silva'), 'Maria Silva')
    assert.equal(nomeDoCliente('avaliacao - João'), 'João')
    assert.equal(nomeDoCliente('Avaliação'), '')
  })

  it('WhatsApp: das marcas internas ou da descrição (eventos do bot e dos professores)', () => {
    assert.equal(whatsappDoEvento({ id: 'a', titulo: '', ocupa: true, privado: { whatsapp: '5511977776666' } }), '5511977776666')
    assert.equal(whatsappDoEvento({ id: 'a', titulo: '', ocupa: true, descricao: 'WhatsApp: +5511977776666\nObs.: x' }), '5511977776666')
    assert.equal(whatsappDoEvento({ id: 'a', titulo: '', ocupa: true, descricao: 'sem número' }), undefined)
  })

  it('normaliza o WhatsApp digitado e recusa o que não é telefone brasileiro', () => {
    assert.equal(normalizarWhatsapp('(11) 97777-6666'), '5511977776666')
    assert.equal(normalizarWhatsapp('+55 11 97777-6666'), '5511977776666')
    assert.equal(normalizarWhatsapp('1133334444'), '551133334444')
    for (const ruim of ['', 'abc', '123', '99999-8888']) assert.throws(() => normalizarWhatsapp(ruim), /WhatsApp inválido/)
  })

  it('a semana começa na segunda', () => {
    assert.equal(segundaDaSemana('2026-10-19'), '2026-10-19')
    assert.equal(segundaDaSemana('2026-10-25'), '2026-10-19', 'domingo')
    assert.equal(segundaDaSemana('2026-10-16'), '2026-10-12', 'sexta')
  })
})

describe('ver a semana', () => {
  it('mostra segunda a sexta (sem fim de semana), 20 horários por dia, livres quando vazio', async () => {
    const { painel } = montar()
    const s = await painel.semana(SEGUNDA)
    assert.equal(s.inicio, '2026-10-19')
    assert.equal(s.anterior, '2026-10-12')
    assert.equal(s.proxima, '2026-10-26')
    assert.equal(s.rotulo, '19/10 a 23/10')
    assert.deepEqual(s.dias.map((d) => d.curto), ['19/10', '20/10', '21/10', '22/10', '23/10'])
    assert.equal(s.dias[0]!.rotulo, 'Segunda-feira, 19/10')
    for (const d of s.dias) {
      assert.equal(d.slots.length, 20)
      assert.ok(d.slots.every((x) => x.estado === 'livre' && x.ocupantes.length === 0 && !x.podeAlterar))
    }
    assert.equal(s.dias[0]!.slots[0]!.periodo, 'manha')
    assert.equal(s.dias[0]!.slots[8]!.periodo, 'tarde')
    assert.equal(s.dias[0]!.slots[19]!.periodo, 'noite')
  })

  it('ocupados mostram cliente, WhatsApp e quem marcou (professor, assistente ou direto no Google)', async () => {
    const { painel, google } = montar()
    const inicio = (h: string) => epochLocal(SEGUNDA, h, FUSO)
    google.eventos.push(
      { id: 'p', titulo: 'Avaliação — Maria', ocupa: true, inicio: inicio('10:00'), fim: inicio('10:30'), descricao: 'WhatsApp: +5511977776666', privado: { origem: 'painel-professores', marcadoPor: 'Ana', whatsapp: '5511977776666' } },
      { id: 'b', titulo: 'Avaliação — João', ocupa: true, inicio: inicio('14:00'), fim: inicio('14:30'), descricao: 'WhatsApp: +5511966665555', privado: { origem: 'assistente-whatsapp', whatsapp: '5511966665555' } },
      { id: 'g', titulo: 'Avaliação — Beto', ocupa: true, inicio: inicio('15:00'), fim: inicio('15:30') },
      { id: 'r', titulo: 'Reunião da equipe', ocupa: true, inicio: inicio('16:00'), fim: inicio('17:00') },
      { id: 'l', titulo: 'Lembrete', ocupa: false, inicio: inicio('18:00'), fim: inicio('18:30') },
    )
    const dia = (await painel.semana(SEGUNDA)).dias[0]!
    const slot = (h: string) => dia.slots.find((s) => s.hhmm === h)!

    const maria = slot('10:00')
    assert.equal(maria.estado, 'ocupado')
    assert.deepEqual([maria.ocupantes[0]!.cliente, maria.ocupantes[0]!.whatsapp, maria.ocupantes[0]!.marcadoPor, maria.podeAlterar], ['Maria', '5511977776666', 'Ana', true])
    assert.equal(slot('14:00').ocupantes[0]!.marcadoPor, 'Assistente (WhatsApp)')
    assert.equal(slot('15:00').ocupantes[0]!.marcadoPor, '', 'criado direto no Google')
    assert.equal(slot('15:00').podeAlterar, true)

    for (const h of ['16:00', '16:30']) {
      assert.equal(slot(h).estado, 'ocupado', 'reunião de 1h ocupa os dois horários')
      assert.equal(slot(h).ocupantes[0]!.cliente, 'Reunião da equipe')
      assert.equal(slot(h).ocupantes[0]!.ehAvaliacao, false)
      assert.equal(slot(h).podeAlterar, false, 'reunião não pode ser mexida aqui')
    }
    assert.equal(slot('18:00').estado, 'livre', 'evento marcado como "livre" não ocupa')
  })

  it('feriado (agenda.json) e evento "Fechado" fecham o dia inteiro', async () => {
    const { painel, google, servico } = montar()
    servico.regras.diasFechados.push(TERCA)
    google.eventos.push({ id: 'f', titulo: 'FECHADO - manutenção', ocupa: true, diaInteiro: { de: '2026-10-21', ate: '2026-10-22' } })
    google.eventos.push({ id: 'n', titulo: 'Aniversário do João', ocupa: true, diaInteiro: { de: '2026-10-22', ate: '2026-10-23' } })
    const s = await painel.semana(SEGUNDA)
    const dia = (d: string) => s.dias.find((x) => x.data === d)!
    assert.equal(dia(TERCA).fechado, 'Fechado (feriado)')
    assert.ok(dia(TERCA).slots.every((x) => x.estado === 'fechado'))
    assert.equal(dia('2026-10-21').fechado, 'FECHADO - manutenção')
    assert.equal(dia('2026-10-22').fechado, undefined, 'evento de dia inteiro comum é ignorado')
    assert.ok(dia('2026-10-22').slots.every((x) => x.estado === 'livre'))
  })

  it('o que já passou não aparece como livre; hoje respeita a hora atual', async () => {
    const { painel } = montar()
    const s = await painel.semana('2026-10-16') // hoje: sexta, 09:00
    const sexta = s.dias.find((d) => d.hoje)!
    assert.equal(sexta.data, '2026-10-16')
    const estado = (h: string) => sexta.slots.find((x) => x.hhmm === h)!.estado
    assert.equal(estado('07:00'), 'passado')
    assert.equal(estado('09:00'), 'passado', 'o horário que já começou')
    assert.equal(estado('09:30'), 'livre')
    assert.ok(s.dias.filter((d) => d.data < '2026-10-16').every((d) => d.slots.every((x) => x.estado === 'passado')))
  })

  it('data inválida cai na semana de hoje; Google fora do ar vira erro claro', async () => {
    const { painel, google } = montar()
    assert.equal((await painel.semana('lixo')).inicio, '2026-10-12')
    google.falhar = true
    await assert.rejects(painel.semana(SEGUNDA))
  })
})

describe('marcar', () => {
  it('cria o evento no mesmo formato do bot e registra quem marcou', async () => {
    const { painel, google, store, servico } = montar()
    const r = await painel.marcar(marcarPedido())
    assert.match(r.mensagem, /Avaliação de Maria Silva marcada para Segunda-feira, 19\/10 às 10:00/)
    const { evento } = google.criados[0]!
    assert.equal(evento.titulo, 'Avaliação — Maria Silva')
    assert.equal(evento.inicio, epochLocal(SEGUNDA, '10:00', FUSO))
    assert.equal(evento.fim - evento.inicio, 30 * 60_000)
    assert.equal(evento.fuso, FUSO)
    assert.match(evento.descricao, /^WhatsApp: \+5511977776666\nObs\.: quer plano VIP\n\nMarcado por Ana/)
    assert.deepEqual(evento.privado, { origem: 'painel-professores', whatsapp: WA, marcadoPor: 'Ana' })

    const acao = store.acoesAgenda()[0]!
    assert.deepEqual([acao.professor, acao.acao, acao.cliente, acao.whatsapp, acao.detalhe], ['Ana', 'marcou', 'Maria Silva', WA, 'Segunda-feira, 19/10 às 10:00'])
    assert.ok(acao.ts > 0)

    // o bot passa a saber: o mesmo cliente não marca outra avaliação por lá
    const pelaIA = await servico.solicitar({ chat: WA, nomeContato: 'Maria', nomeCliente: 'Maria', tipo: 'avaliacao_fisica', dataISO: TERCA, hhmm: '10:00', obs: '', jaEAluno: false, planoVip: false })
    assert.equal(pelaIA.ok, false)
    assert.match(!pelaIA.ok ? pelaIA.motivo : '', /já tem uma avaliação agendada: Segunda-feira, 19\/10 às 10:00/)
  })

  it('não precisa de observação; o horário aparece ocupado em seguida', async () => {
    const { painel, google } = montar()
    await painel.marcar(marcarPedido({ obs: undefined }))
    assert.doesNotMatch(google.criados[0]!.evento.descricao, /Obs\./)
    const slot = (await painel.semana(SEGUNDA)).dias[0]!.slots.find((s) => s.hhmm === '10:00')!
    assert.equal(slot.estado, 'ocupado')
    assert.equal(slot.ocupantes[0]!.cliente, 'Maria Silva')
  })

  it('recusa passado, fora da grade, feriado, longe demais, dados ruins — sem criar nada', async () => {
    const { painel, google, servico } = montar()
    servico.regras.diasFechados.push(TERCA)
    const casos: Array<[Record<string, unknown>, RegExp, string]> = [
      [{ data: '2026-10-15' }, /já passou/, 'passado'],
      [{ data: '2026-10-16', hhmm: '09:00' }, /já passou/, 'horário que já começou'],
      [{ hhmm: '10:15' }, /não existe na grade/, 'fora dos 30 min'],
      [{ hhmm: '12:00' }, /não existe na grade/, 'intervalo do almoço'],
      [{ hhmm: '20:00' }, /não existe na grade/, 'depois da última janela'],
      [{ data: '2026-10-24' }, /Não há avaliações nesse dia/, 'sábado'],
      [{ data: TERCA }, /fechado \(feriado\)/, 'feriado'],
      [{ data: '2027-12-01' }, /até 180 dias/, 'longe'],
      [{ data: '2026-13-45' }, /Data inválida/, 'data inválida'],
      [{ nome: '   ' }, /nome do cliente/, 'sem nome'],
      [{ whatsapp: '123' }, /WhatsApp inválido/, 'whatsapp'],
    ]
    for (const [extra, regex, rotulo] of casos) {
      const e = await erroDe(painel.marcar(marcarPedido(extra)))
      assert.match(e.message, regex, rotulo)
      assert.equal(e.status, 400, rotulo)
    }
    assert.equal(google.criados.length, 0)
  })

  it('reconfere na hora de gravar: horário ocupado por outra pessoa vira aviso, nunca marcação por cima', async () => {
    const { painel, google } = montar()
    const aberto = (await painel.semana(SEGUNDA)).dias[0]!.slots.find((s) => s.hhmm === '10:00')!
    assert.equal(aberto.estado, 'livre') // o professor vê verde…
    google.ocupar(SEGUNDA, '10:00', 30, 'Avaliação — Carlos') // …e alguém marca antes
    const e = await erroDe(painel.marcar(marcarPedido()))
    assert.equal(e.status, 409)
    assert.match(e.message, /acabou de ser ocupado \(Carlos\)/)
    assert.equal(google.criados.length, 0)
  })

  it('evento que encosta no horário (reunião 10:15–10:45) também bloqueia; "Fechado" no meio do dia também', async () => {
    const { painel, google } = montar()
    google.ocupar(SEGUNDA, '10:15', 30, 'Reunião')
    assert.equal((await erroDe(painel.marcar(marcarPedido({ hhmm: '10:00' })))).status, 409)
    assert.equal((await erroDe(painel.marcar(marcarPedido({ hhmm: '10:30' })))).status, 409)
    google.eventos.push({ id: 'f', titulo: 'Fechado', ocupa: true, diaInteiro: { de: TERCA, ate: '2026-10-21' } })
    assert.match((await erroDe(painel.marcar(marcarPedido({ data: TERCA })))).message, /fechado na agenda/)
  })

  it('Google fora do ar: erro claro, nada criado, nada registrado', async () => {
    const { painel, google, store } = montar()
    google.falhar = true
    const e = await erroDe(painel.marcar(marcarPedido()))
    assert.equal(e.status, 502)
    assert.match(e.message, /Nada foi alterado/)
    assert.equal(store.acoesAgenda().length, 0)
  })

  it('dois professores marcando o mesmo horário ao mesmo tempo: só um consegue', async () => {
    const { painel, google } = montar()
    google.atraso = 15
    const r = await Promise.allSettled([painel.marcar(marcarPedido({ professor: 'Ana' })), painel.marcar(marcarPedido({ professor: 'Bia', nome: 'Outra', whatsapp: '11966665555' }))])
    assert.deepEqual(r.map((x) => x.status).sort(), ['fulfilled', 'rejected'])
    assert.equal(google.criados.length, 1)
    const perdeu = r.find((x) => x.status === 'rejected') as PromiseRejectedResult
    assert.equal((perdeu.reason as ErroPainel).status, 409)
  })

  it('o assistente e um professor pedindo o mesmo horário ao mesmo tempo: só um consegue (mesma trava)', async () => {
    const { painel, google, servico } = montar()
    google.atraso = 15
    const [professor, bot] = await Promise.all([
      painel.marcar(marcarPedido()).then(() => 'ok', () => 'recusado'),
      servico.solicitar({ chat: '5511966665555', nomeContato: 'Beto', nomeCliente: 'Beto', tipo: 'avaliacao_fisica', dataISO: SEGUNDA, hhmm: '10:00', obs: '', jaEAluno: false, planoVip: false }).then((r) => (r.ok && r.agendada ? 'ok' : 'recusado')),
    ])
    assert.equal([professor, bot].filter((x) => x === 'ok').length, 1, `${professor}/${bot}`)
    assert.equal(google.criados.filter((c) => c.evento.inicio === epochLocal(SEGUNDA, '10:00', FUSO)).length, 1)
  })
})

describe('desmarcar', () => {
  async function comAvaliacao() {
    const m = montar()
    await m.painel.marcar(marcarPedido())
    return { ...m, id: m.google.criados[0]!.id }
  }

  it('apaga o evento, libera o horário, avisa na tela e registra quem desmarcou', async () => {
    const { painel, google, store, servico, id } = await comAvaliacao()
    const r = await painel.desmarcar(id, 'Bia')
    assert.match(r.mensagem, /Avaliação de Maria Silva desmarcada\. O horário de Segunda-feira, 19\/10 às 10:00 voltou a ficar livre\./)
    assert.deepEqual(r.liberado, { data: SEGUNDA, hhmm: '10:00' })
    assert.equal(google.eventos.length, 0)
    assert.equal((await painel.semana(SEGUNDA)).dias[0]!.slots.find((s) => s.hhmm === '10:00')!.estado, 'livre')
    const acao = store.acoesAgenda()[0]!
    assert.deepEqual([acao.professor, acao.acao, acao.cliente, acao.whatsapp], ['Bia', 'desmarcou', 'Maria Silva', WA])
    // o cliente volta a poder marcar pelo bot
    assert.equal(store.agendamentoAtivo(WA, AGORA.getTime()), undefined)
    const denovo = await servico.solicitar({ chat: WA, nomeContato: 'Maria', nomeCliente: 'Maria', tipo: 'avaliacao_fisica', dataISO: TERCA, hhmm: '10:00', obs: '', jaEAluno: false, planoVip: false })
    assert.equal(denovo.ok, true)
  })

  it('NUNCA apaga o que não é avaliação: feriado, reunião, evento de dia inteiro', async () => {
    const { painel, google } = montar()
    google.eventos.push(
      { id: 'f', titulo: 'FECHADO - feriado', ocupa: true, diaInteiro: { de: TERCA, ate: '2026-10-21' } },
      { id: 'r', titulo: 'Reunião da equipe', ocupa: true, inicio: epochLocal(SEGUNDA, '16:00', FUSO), fim: epochLocal(SEGUNDA, '17:00', FUSO) },
      { id: 'p', titulo: 'Pré-avaliação do João', ocupa: true, inicio: epochLocal(SEGUNDA, '15:00', FUSO), fim: epochLocal(SEGUNDA, '15:30', FUSO) },
    )
    for (const id of ['f', 'r', 'p']) {
      const e = await erroDe(painel.desmarcar(id, 'Ana'))
      assert.equal(e.status, 403, id)
      assert.match(e.message, /Só dá para mudar eventos de avaliação/)
    }
    assert.equal(google.chamadas.remover, 0)
    assert.equal(google.eventos.length, 3)
  })

  it('evento que não existe mais, avaliação que já começou e Google fora do ar', async () => {
    const { painel, google } = montar()
    assert.equal((await erroDe(painel.desmarcar('nao-existe', 'Ana'))).status, 404)
    google.eventos.push({ id: 'h', titulo: 'Avaliação — Hoje', ocupa: true, inicio: epochLocal('2026-10-16', '09:00', FUSO), fim: epochLocal('2026-10-16', '09:30', FUSO) })
    const e = await erroDe(painel.desmarcar('h', 'Ana'))
    assert.match(e.message, /já começou ou já passou/)
    assert.equal(google.eventos.length, 1)
    google.eventos.push({ id: 'x', titulo: 'Avaliação — X', ocupa: true, inicio: epochLocal(SEGUNDA, '08:00', FUSO), fim: epochLocal(SEGUNDA, '08:30', FUSO) })
    google.falhar = true
    assert.equal((await erroDe(painel.desmarcar('x', 'Ana'))).status, 502)
  })
})

describe('remarcar', () => {
  async function comAvaliacao() {
    const m = montar()
    await m.painel.marcar(marcarPedido())
    return { ...m, id: m.google.criados[0]!.id }
  }

  it('move o evento mantendo nome e WhatsApp, libera o horário antigo e registra', async () => {
    const { painel, google, store, servico, id } = await comAvaliacao()
    const r = await painel.remarcar({ eventoId: id, data: TERCA, hhmm: '14:30', professor: 'Bia' })
    assert.match(r.mensagem, /Avaliação de Maria Silva remarcada para Terça-feira, 20\/10 às 14:30\. O horário de Segunda-feira, 19\/10 às 10:00 voltou a ficar livre\./)
    assert.deepEqual(r.liberado, { data: SEGUNDA, hhmm: '10:00' })
    const ev = google.eventos.find((e) => e.id === id)!
    assert.equal(ev.titulo, 'Avaliação — Maria Silva', 'nome mantido')
    assert.equal(ev.inicio, epochLocal(TERCA, '14:30', FUSO))
    assert.equal(ev.fim! - ev.inicio!, 30 * 60_000)
    assert.match(ev.descricao!, /^WhatsApp: \+5511977776666\nObs\.: quer plano VIP\n\nMarcado por Ana na agenda dos professores\.\nRemarcado por Bia em \d\d\/\d\d \d\d:\d\d: de Segunda-feira, 19\/10 às 10:00 para Terça-feira, 20\/10 às 14:30\.$/)
    assert.deepEqual(ev.privado, { origem: 'painel-professores', whatsapp: WA, marcadoPor: 'Ana', remarcadoPor: 'Bia' })

    const s = await painel.semana(SEGUNDA)
    assert.equal(s.dias[0]!.slots.find((x) => x.hhmm === '10:00')!.estado, 'livre')
    assert.equal(s.dias[1]!.slots.find((x) => x.hhmm === '14:30')!.ocupantes[0]!.cliente, 'Maria Silva')
    const acao = store.acoesAgenda()[0]!
    assert.deepEqual([acao.professor, acao.acao, acao.cliente], ['Bia', 'remarcou', 'Maria Silva'])
    assert.match(acao.detalhe, /de Segunda-feira, 19\/10 às 10:00 para Terça-feira, 20\/10 às 14:30/)
    assert.equal(store.agendamentoAtivo(WA, AGORA.getTime())!.inicio, epochLocal(TERCA, '14:30', FUSO), 'o bot fala o horário novo')
    assert.match(
      await servico.solicitar({ chat: WA, nomeContato: 'M', nomeCliente: 'M', tipo: 'avaliacao_fisica', dataISO: SEGUNDA, hhmm: '15:00', obs: '', jaEAluno: false, planoVip: false }).then((x) => (!x.ok ? x.motivo : 'marcou')),
      /Terça-feira, 20\/10 às 14:30/,
    )
  })

  it('pode ir para o horário vizinho (o próprio evento não conta como ocupando)', async () => {
    const { painel, google, id } = await comAvaliacao()
    await painel.remarcar({ eventoId: id, data: SEGUNDA, hhmm: '10:30', professor: 'Ana' })
    assert.equal(google.eventos[0]!.inicio, epochLocal(SEGUNDA, '10:30', FUSO))
  })

  it('recusa horário ocupado, fora da grade, passado, feriado, o mesmo horário e eventos que não são avaliação', async () => {
    const { painel, google, servico, id } = await comAvaliacao()
    google.ocupar(TERCA, '15:00', 30, 'Avaliação — Carlos')
    servico.regras.diasFechados.push('2026-10-21')
    const casos: Array<[Record<string, unknown>, number, RegExp]> = [
      [{ data: TERCA, hhmm: '15:00' }, 409, /acabou de ser ocupado \(Carlos\)/],
      [{ data: TERCA, hhmm: '12:00' }, 400, /não existe na grade/],
      [{ data: '2026-10-15', hhmm: '10:00' }, 400, /já passou/],
      [{ data: '2026-10-21', hhmm: '10:00' }, 400, /fechado/],
      [{ data: SEGUNDA, hhmm: '10:00' }, 400, /já está nesse horário/],
    ]
    for (const [extra, status, regex] of casos) {
      const e = await erroDe(painel.remarcar({ eventoId: id, data: SEGUNDA, hhmm: '10:00', professor: 'Ana', ...extra }))
      assert.equal(e.status, status, JSON.stringify(extra))
      assert.match(e.message, regex)
    }
    google.eventos.push({ id: 'r', titulo: 'Reunião', ocupa: true, inicio: epochLocal(SEGUNDA, '16:00', FUSO), fim: epochLocal(SEGUNDA, '17:00', FUSO) })
    assert.equal((await erroDe(painel.remarcar({ eventoId: 'r', data: TERCA, hhmm: '09:00', professor: 'Ana' }))).status, 403)
    assert.equal(google.chamadas.mover, 0, 'nada foi movido')
    assert.equal(google.eventos.find((e) => e.id === id)!.inicio, epochLocal(SEGUNDA, '10:00', FUSO))
  })

  it('dois professores remarcando para o mesmo horário ao mesmo tempo: só um consegue', async () => {
    const { painel, google } = montar()
    await painel.marcar(marcarPedido({ hhmm: '09:00' }))
    await painel.marcar(marcarPedido({ hhmm: '09:30', nome: 'Outro', whatsapp: '11966665555' }))
    const [a, b] = google.criados.map((c) => c.id)
    google.atraso = 15
    const r = await Promise.allSettled([painel.remarcar({ eventoId: a!, data: TERCA, hhmm: '10:00', professor: 'Ana' }), painel.remarcar({ eventoId: b!, data: TERCA, hhmm: '10:00', professor: 'Bia' })])
    assert.deepEqual(r.map((x) => x.status).sort(), ['fulfilled', 'rejected'])
    assert.equal(google.eventos.filter((e) => e.inicio === epochLocal(TERCA, '10:00', FUSO)).length, 1)
  })
})
