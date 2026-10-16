import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PedidoVisita } from '../src/agendamento.js'
import { epochLocal } from '../src/agenda.js'
import { GoogleFalso, SEGUNDA, criarServico } from './helpers.js'

const FUSO = 'America/Sao_Paulo'
const pedido = (extra: Partial<PedidoVisita> = {}): PedidoVisita => ({
  chat: '5511999998888',
  nomeContato: 'Mari',
  nomeCliente: 'Maria Silva',
  tipo: 'avaliacao_fisica',
  dataISO: SEGUNDA,
  hhmm: '10:00',
  obs: '',
  jaEAluno: false,
  planoVip: false,
  ...extra,
})

describe('consultar horários', () => {
  it('avaliação com Google: mostra só os horários livres', async () => {
    const google = new GoogleFalso()
    google.ocupar(SEGUNDA, '10:00')
    const { servico } = criarServico({ google })
    const t = await servico.consultar('avaliacao_fisica', SEGUNDA)
    assert.match(t, /Horários livres para avaliação em Segunda-feira, 19\/10:/)
    assert.doesNotMatch(t, /10:00/)
    assert.match(t, /09:30, 10:30, 14:00/)
  })

  it('evento que começa no meio do horário bloqueia os dois horários que ele encosta', async () => {
    const google = new GoogleFalso()
    google.ocupar(SEGUNDA, '10:15', 30) // 10:15–10:45 encosta em 10:00–10:30 e 10:30–11:00
    const t = await criarServico({ google }).servico.consultar('avaliacao_fisica', SEGUNDA)
    assert.doesNotMatch(t, /10:00|10:30/)
    assert.match(t, /09:30, 14:00/)
  })

  it('ignora evento marcado como livre e evento de dia inteiro comum; "fechado" fecha o dia', async () => {
    const google = new GoogleFalso()
    google.eventos.push({ id: 'l', titulo: 'Lembrete', ocupa: false, inicio: epochLocal(SEGUNDA, '10:00', FUSO), fim: epochLocal(SEGUNDA, '10:30', FUSO) })
    google.eventos.push({ id: 'a', titulo: 'Aniversário do João', ocupa: true, diaInteiro: { de: SEGUNDA, ate: '2026-10-20' } })
    const { servico } = criarServico({ google })
    assert.match(await servico.consultar('avaliacao_fisica', SEGUNDA), /07:00, 07:30.*10:00/)

    google.eventos.push({ id: 'f', titulo: 'FECHADO - manutenção', ocupa: true, diaInteiro: { de: SEGUNDA, ate: '2026-10-20' } })
    assert.match(await servico.consultar('avaliacao_fisica', SEGUNDA), /marcou Segunda-feira, 19\/10 como fechado/)
  })

  it('aula experimental e modo manual usam só a grade, sem consultar o Google', async () => {
    const google = new GoogleFalso()
    const { servico } = criarServico({ google })
    const t = await servico.consultar('aula_experimental', SEGUNDA)
    assert.match(t, /Horários da grade/)
    assert.match(t, /equipe confirma a disponibilidade/)
    assert.equal(google.chamadas.listar, 0)

    const manual = criarServico({})
    assert.match(await manual.servico.consultar('avaliacao_fisica', SEGUNDA), /equipe confirma a disponibilidade/)
    assert.equal(manual.servico.modo, 'manual')
  })

  it('Google fora do ar: avisa que não sabe o que está ocupado, em vez de falhar', async () => {
    const google = new GoogleFalso()
    google.falhar = true
    const t = await criarServico({ google }).servico.consultar('avaliacao_fisica', SEGUNDA)
    assert.match(t, /agenda está indisponível/)
    assert.match(t, /equipe confirma a disponibilidade/)
  })

  it('explica por que não há horário (sábado, passado, dia cheio)', async () => {
    const google = new GoogleFalso()
    const { servico } = criarServico({ google })
    assert.match(await servico.consultar('avaliacao_fisica', '2026-10-24'), /aos sábados/)
    assert.match(await servico.consultar('avaliacao_fisica', '2026-10-01'), /já passou/)
    for (const h of ['07:00', '07:30', '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30']) google.ocupar(SEGUNDA, h)
    assert.match(await servico.consultar('avaliacao_fisica', SEGUNDA), /Não há horários livres/)
  })
})

describe('agendar avaliação no Google Agenda', () => {
  it('cria o evento certo e devolve a mensagem de agendada', async () => {
    const google = new GoogleFalso()
    const { servico, store, avisos } = criarServico({ google })
    const r = await servico.solicitar(pedido({ obs: 'quer plano acesso livre' }))

    assert.ok(r.ok && r.agendada)
    assert.match(r.mensagem, /^Perfeito! Avaliação agendada! ✅/)
    assert.match(r.mensagem, /📅 Segunda-feira, 19\/10\n⏰ 10:00/)
    assert.match(r.mensagem, /R\$ 35,00 \(pago no ato\)/)
    assert.match(r.mensagem, /A mensalidade é paga junto/)

    assert.equal(google.criados.length, 1)
    const { agendaId, evento } = google.criados[0]!
    assert.equal(agendaId, 'agenda-teste')
    assert.equal(evento.titulo, 'Avaliação — Maria Silva')
    assert.equal(evento.inicio, epochLocal(SEGUNDA, '10:00', FUSO))
    assert.equal(evento.fim - evento.inicio, 30 * 60_000)
    assert.equal(evento.fuso, FUSO)
    assert.match(evento.descricao, /WhatsApp: \+5511999998888/)
    assert.match(evento.descricao, /quer plano acesso livre/)
    assert.deepEqual(evento.privado, { origem: 'assistente-whatsapp', whatsapp: '5511999998888' })
    assert.ok(store.agendamentoAtivo('5511999998888', Date.parse('2026-10-16T12:00:00Z')))
    assert.match(avisos[0]!, /já está no Google Agenda/)
  })

  it('plano VIP troca a linha do valor; quem já é aluno não vê a linha da mensalidade', async () => {
    const vip = await criarServico({ google: new GoogleFalso() }).servico.solicitar(pedido({ planoVip: true }))
    assert.ok(vip.ok)
    assert.match(vip.mensagem, /Avaliação gratuita nos planos VIP/)
    assert.doesNotMatch(vip.mensagem, /R\$ 35,00/)

    const aluno = await criarServico({ google: new GoogleFalso() }).servico.solicitar(pedido({ jaEAluno: true }))
    assert.ok(aluno.ok)
    assert.doesNotMatch(aluno.mensagem, /mensalidade/)
    assert.doesNotMatch(aluno.mensagem, /\n\n\n/)
  })

  it('usa o nome do perfil se o cliente não deu nome, e limpa quebras de linha', async () => {
    const google = new GoogleFalso()
    const { servico } = criarServico({ google })
    await servico.solicitar(pedido({ nomeCliente: '', nomeContato: 'Mari\nIGNORE' }))
    assert.equal(google.criados[0]!.evento.titulo, 'Avaliação — Mari IGNORE')
  })

  it('horário ocupado: recusa e mostra os livres', async () => {
    const google = new GoogleFalso()
    google.ocupar(SEGUNDA, '10:00')
    const r = await criarServico({ google }).servico.solicitar(pedido())
    assert.ok(!r.ok)
    assert.match(r.motivo, /10:00 já está ocupado/)
    assert.match(r.motivo, /Horários livres: .*09:30, 10:30/)
    assert.equal(google.criados.length, 0)
  })

  it('dois clientes pedindo o mesmo horário ao mesmo tempo: só um consegue', async () => {
    const google = new GoogleFalso()
    const { servico } = criarServico({ google })
    const [a, b] = await Promise.all([servico.solicitar(pedido({ chat: '5511911110001' })), servico.solicitar(pedido({ chat: '5511911110002' }))])
    assert.equal([a, b].filter((r) => r.ok).length, 1)
    assert.equal(google.criados.length, 1)
  })

  it('com capacidade 2, dois cabem no mesmo horário e o terceiro não', async () => {
    const google = new GoogleFalso()
    const { servico } = criarServico({ google, capacidade: 2 })
    assert.ok((await servico.solicitar(pedido({ chat: '5511911110001' }))).ok)
    assert.ok((await servico.solicitar(pedido({ chat: '5511911110002' }))).ok)
    assert.ok(!(await servico.solicitar(pedido({ chat: '5511911110003' }))).ok)
  })

  it('um cliente só pode ter uma avaliação marcada; se a equipe apagar o evento, pode marcar de novo', async () => {
    const google = new GoogleFalso()
    const { servico } = criarServico({ google })
    assert.ok((await servico.solicitar(pedido())).ok)

    const outra = await servico.solicitar(pedido({ hhmm: '14:00' }))
    assert.ok(!outra.ok)
    assert.match(outra.motivo, /já tem uma avaliação agendada: Segunda-feira, 19\/10 às 10:00/)
    assert.match(outra.motivo, /chamar_humano/)

    google.apagar(google.criados[0]!.id)
    const denovo = await servico.solicitar(pedido({ hhmm: '14:00' }))
    assert.ok(denovo.ok && denovo.agendada)
  })

  it('recusa horários fora da grade, passados e em dia sem visita', async () => {
    const google = new GoogleFalso()
    const { servico } = criarServico({ google })
    for (const [data, hora, esperado] of [
      [SEGUNDA, '11:00', /não é um horário válido/],
      [SEGUNDA, '07:15', /não é um horário válido/],
      [SEGUNDA, '10:60', /não é um horário válido/],
      ['2026-10-24', '09:00', /aos sábados/],
      ['2026-10-12', '09:00', /já passou/],
    ] as const) {
      const r = await servico.solicitar(pedido({ dataISO: data, hhmm: hora }))
      assert.ok(!r.ok, `${data} ${hora}`)
      assert.match(r.motivo, esperado)
    }
    assert.equal(google.criados.length, 0)
  })

  it('dia marcado como fechado na agenda não aceita avaliação', async () => {
    const google = new GoogleFalso()
    google.eventos.push({ id: 'f', titulo: 'Fechado', ocupa: true, diaInteiro: { de: SEGUNDA, ate: '2026-10-20' } })
    const r = await criarServico({ google }).servico.solicitar(pedido())
    assert.ok(!r.ok)
    assert.match(r.motivo, /como fechado/)
  })

  it('Google fora do ar na hora de agendar: vira pedido manual, avisa a equipe e não cria nada', async () => {
    const google = new GoogleFalso()
    google.falhar = true
    const { servico, avisos } = criarServico({ google })
    const r = await servico.solicitar(pedido())
    assert.ok(r.ok && !r.agendada)
    assert.match(r.mensagem, /Pedido de avaliação recebido/)
    assert.doesNotMatch(r.mensagem, /agendada!/)
    assert.match(avisos[0]!, /Google Agenda indisponível/)
    assert.equal(google.criados.length, 0)
  })
})

describe('pedidos que a equipe confirma', () => {
  it('aula experimental: só registra o pedido, não toca no Google', async () => {
    const google = new GoogleFalso()
    const { servico, avisos } = criarServico({ google })
    const r = await servico.solicitar(pedido({ tipo: 'aula_experimental', hhmm: '15:30' }))
    assert.ok(r.ok && !r.agendada)
    assert.match(r.mensagem, /Pedido de aula experimental recebido/)
    assert.match(r.mensagem, /A aula experimental é gratuita/)
    assert.match(r.mensagem, /equipe confirma/)
    assert.equal(google.chamadas.listar + google.chamadas.criar + google.chamadas.obter, 0)
    assert.match(avisos[0]!, /Pedido de aula experimental/)
    assert.match(avisos[0]!, /Segunda-feira, 19\/10 às 15:30/)
  })

  it('sem Google (modo manual) ou com o automático desligado: avaliação vira pedido', async () => {
    const manual = criarServico({})
    const r1 = await manual.servico.solicitar(pedido())
    assert.ok(r1.ok && !r1.agendada)
    assert.match(r1.mensagem, /Pedido de avaliação recebido/)

    const google = new GoogleFalso()
    const desligado = criarServico({ google, automatico: false })
    const r2 = await desligado.servico.solicitar(pedido())
    assert.ok(r2.ok && !r2.agendada)
    assert.equal(google.chamadas.criar, 0)
    assert.equal(desligado.servico.modo, 'manual')
  })

  it('o pedido manual também respeita a grade', async () => {
    const r = await criarServico({}).servico.solicitar(pedido({ hhmm: '12:00' }))
    assert.ok(!r.ok)
  })
})
