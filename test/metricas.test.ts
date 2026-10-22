import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { epochLocal } from '../src/agenda.js'
import type { EstadoWhatsapp } from '../src/baileys.js'
import { ESPERA_ALERTA_MIN, Metricas, custoEmReais, origemDe } from '../src/metricas.js'
import { AGORA, GoogleFalso, criarConfigDeTeste, criarServico } from './helpers.js'

const FUSO = 'America/Sao_Paulo'
const WA = '5511977776666'
const MIN = 60_000
const CONECTADO: EstadoWhatsapp = { status: 'conectado', numero: '5511900000000', desde: AGORA.getTime() }

function aval(google: GoogleFalso, data: string, hhmm: string, cliente: string, privado?: Record<string, string>, titulo = `Avaliação — ${cliente}`) {
  const inicio = epochLocal(data, hhmm, FUSO)
  google.eventos.push({ id: `${data}-${hhmm}-${google.eventos.length}`, titulo, ocupa: true, inicio, fim: inicio + 30 * MIN, ...(privado ? { privado } : {}) })
}

function montar(extra: Record<string, string> = {}, comGoogle = true) {
  const google = new GoogleFalso()
  const { servico, store } = criarServico(comGoogle ? { google } : {})
  const cfg = criarConfigDeTeste(extra)
  const metricas = new Metricas({ store, cfg, servico, estado: () => CONECTADO, cacheMs: 0 })
  return { google, servico, store, cfg, metricas }
}

/** Hoje é sexta 16/10/2026, 09:00. */
function agendaDoMes(google: GoogleFalso) {
  aval(google, '2026-10-16', '10:00', 'Ana', { origem: 'assistente-whatsapp', whatsapp: WA })
  aval(google, '2026-10-16', '08:00', 'Bia', { origem: 'painel-professores', marcadoPor: 'Recepção (lista)' })
  aval(google, '2026-10-12', '10:00', 'Caio', { origem: 'painel-professores', marcadoPor: 'Prof. João' })
  aval(google, '2026-10-05', '14:00', 'Dani')
  aval(google, '2026-10-19', '10:00', 'Edu', { origem: 'assistente-whatsapp', whatsapp: '5511911112222' })
  aval(google, '2026-10-19', '14:00', 'x', undefined, 'Reunião da equipe')
}

describe('de onde veio a avaliação', () => {
  it('assistente, recepção, professores ou direto na agenda', () => {
    const e = (privado?: Record<string, string>) => ({ id: '1', titulo: 'Avaliação — X', ocupa: true, ...(privado ? { privado } : {}) })
    assert.equal(origemDe(e({ origem: 'assistente-whatsapp' })), 'bot')
    assert.equal(origemDe(e({ origem: 'painel-professores', marcadoPor: 'Recepção (lista)' })), 'recepcao')
    assert.equal(origemDe(e({ origem: 'painel-professores', marcadoPor: 'Prof. João' })), 'professores')
    assert.equal(origemDe(e({ origem: 'painel-professores' })), 'professores')
    assert.equal(origemDe(e()), 'agenda')
    assert.equal(origemDe(e({ outra: 'coisa' })), 'agenda')
  })
})

describe('números da agenda (todas as origens)', () => {
  it('conta hoje, semana e mês; separa as que já passaram das que vêm aí', async () => {
    const t = montar()
    agendaDoMes(t.google)
    const r = await t.metricas.resumo()
    assert.deepEqual(r.agenda, { ligada: true })
    assert.deepEqual(r.hoje.map((a) => a.cliente), ['Bia', 'Ana'])
    assert.deepEqual(r.semana, { total: 3, feitas: 2, aVir: 1 })
    assert.deepEqual(r.mes, { total: 5, feitas: 3, aVir: 2 })
    assert.match(r.mesRotulo, /outubro de 2026/)
  })

  it('"Reunião" e outros eventos não viram avaliação, e avaliação do mês que vem não entra', async () => {
    const t = montar()
    agendaDoMes(t.google)
    aval(t.google, '2026-11-02', '10:00', 'Futuro')
    const r = await t.metricas.resumo()
    assert.equal(r.mes.total, 5)
    assert.ok(!r.proximas.some((a) => a.cliente === 'Futuro'))
    assert.ok(!r.proximas.some((a) => a.cliente === 'Cliente' || a.cliente === 'x'))
  })

  it('divide por origem, dia da semana e horário', async () => {
    const t = montar()
    agendaDoMes(t.google)
    const r = await t.metricas.resumo()
    assert.deepEqual(
      r.porOrigem.map((o) => [o.origem, o.total]),
      [['bot', 2], ['recepcao', 1], ['professores', 1], ['agenda', 1]],
    )
    assert.deepEqual(r.porDiaSemana.map((d) => [d.dia, d.total]), [['seg', 3], ['sex', 2]])
    assert.deepEqual(r.porHorario.map((h) => [h.hhmm, h.total]), [['08:00', 1], ['10:00', 3], ['14:00', 1]])
  })

  it('próximas: só as que ainda vão acontecer, em ordem, com o WhatsApp quando há', async () => {
    const t = montar()
    agendaDoMes(t.google)
    const r = await t.metricas.resumo()
    assert.deepEqual(r.proximas.map((a) => a.cliente), ['Ana', 'Edu'])
    assert.equal(r.proximas[0]!.whatsapp, WA)
    assert.equal(r.proximas[0]!.origem, 'bot')
  })

  it('ocupação da grade dos próximos 14 dias conta qualquer evento que ocupa horário', async () => {
    const t = montar()
    agendaDoMes(t.google)
    const r = await t.metricas.resumo()
    // 10 dias úteis; hoje só restam 16 horários (a partir das 09:00), os outros 9 dias têm 20
    assert.equal(r.ocupacao.total, 16 + 9 * 20)
    assert.equal(r.ocupacao.ocupados, 3, 'Ana, Edu e a reunião; a Bia das 08:00 já passou')
    assert.equal(r.ocupacao.livres, r.ocupacao.total - 3)
    assert.equal(r.ocupacao.percentual, 2)
  })

  it('dia fechado não entra na conta da grade', async () => {
    const t = montar()
    t.google.eventos.push({ id: 'f', titulo: 'FECHADO', ocupa: true, diaInteiro: { de: '2026-10-20', ate: '2026-10-21' } })
    const r = await t.metricas.resumo()
    assert.equal(r.ocupacao.total, 16 + 8 * 20)
  })

  it('Google fora do ar: o painel ainda abre, com o aviso, e o resto dos números continua', async () => {
    const t = montar()
    t.google.falhar = true
    t.store.registrarMatricula({ chat: WA, nome: 'Ana Souza', telefone: WA, email: '', nascimento: '', plano: 'VIP', pagamento: 'pix', observacao: '' }, AGORA.getTime())
    const erros = console.error
    console.error = () => {}
    try {
      const r = await t.metricas.resumo()
      assert.equal(r.agenda.ligada, true)
      assert.match(r.agenda.erro!, /google fora do ar/)
      assert.equal(r.mes.total, 0)
      assert.equal(r.pendentes.length, 1)
    } finally {
      console.error = erros
    }
  })

  it('sem Google ligado: avisa que a agenda está desligada e não quebra', async () => {
    const t = montar({}, false)
    const r = await t.metricas.resumo()
    assert.equal(r.agenda.ligada, false)
    assert.equal(r.mes.total, 0)
    assert.equal(r.ocupacao.total, 16 + 9 * 20, 'a grade continua valendo; só não há o que subtrair')
  })

  it('a leitura do Google fica guardada (não martela a agenda a cada recarga)', async () => {
    const google = new GoogleFalso()
    const { servico, store } = criarServico({ google })
    const m = new Metricas({ store, cfg: criarConfigDeTeste(), servico, estado: () => CONECTADO })
    await m.resumo()
    await m.resumo()
    assert.equal(google.chamadas.listar, 1)
    m.esquecerCache()
    await m.resumo()
    assert.equal(google.chamadas.listar, 2)
  })
})

describe('funil, comparecimento e matrículas', () => {
  it('conversas → avaliações → matrículas, com o cruzamento pelo telefone', async () => {
    const t = montar()
    agendaDoMes(t.google)
    const dia = AGORA.getTime() - 3 * 86_400_000
    for (const chat of ['5511900000001', '5511900000002', WA]) t.store.adicionarMensagem(chat, 'user', 'oi', dia)
    t.store.registrarEvento('avaliacao_bot', WA, 'x', dia)
    t.store.registrarMatricula({ chat: WA, nome: 'Ana Souza', telefone: WA, email: '', nascimento: '', plano: 'VIP', pagamento: 'pix', observacao: '' }, dia)
    const r = await t.metricas.resumo()
    assert.deepEqual(r.funil, { conversas: 3, avaliacoesPeloBot: 1, avaliacoes: 5, matriculasPeloBot: 1, avaliacoesQueMatricularam: 1 })
  })

  it('o número com ou sem o 9 extra é a mesma pessoa', async () => {
    const t = montar()
    aval(t.google, '2026-10-12', '10:00', 'Ana', { whatsapp: '551177776666' }) // sem o 9
    t.store.registrarMatricula({ chat: 'x', nome: 'Ana Souza', telefone: WA, email: '', nascimento: '', plano: 'VIP', pagamento: 'pix', observacao: '' }, AGORA.getTime())
    const r = await t.metricas.resumo()
    assert.equal(r.funil.avaliacoesQueMatricularam, 1)
  })

  it('comparecimento: veio, faltou, matriculou e as taxas', async () => {
    const t = montar()
    agendaDoMes(t.google)
    const ids = t.google.eventos.map((e) => e.id)
    const base = { inicio: AGORA.getTime(), cliente: 'x', whatsapp: '', por: 'Prof. João' }
    t.store.marcarComparecimento({ ...base, eventoId: ids[1]!, status: 'veio' })
    t.store.marcarComparecimento({ ...base, eventoId: ids[2]!, status: 'faltou' })
    t.store.marcarComparecimento({ ...base, eventoId: ids[3]!, status: 'matriculou' })
    const r = await t.metricas.resumo()
    assert.equal(r.comparecimento.veio, 1)
    assert.equal(r.comparecimento.faltou, 1)
    assert.equal(r.comparecimento.matriculou, 1)
    assert.equal(r.comparecimento.taxaFalta, 33)
    assert.equal(r.comparecimento.taxaConversao, 50)
    assert.deepEqual(r.hoje.find((a) => a.cliente === 'Bia')!.comparecimento, 'veio')
    assert.equal(r.comparecimento.semMarcar.length, 0, 'as 3 que passaram já estão marcadas')
  })

  it('sem nada marcado não inventa taxa, e lista as que já passaram sem marcar', async () => {
    const t = montar()
    agendaDoMes(t.google)
    const r = await t.metricas.resumo()
    assert.equal(r.comparecimento.taxaFalta, undefined)
    assert.equal(r.comparecimento.taxaConversao, undefined)
    // só entram as que acabaram de passar há mais de 1h: Caio (12/10) e Dani (05/10). A Bia (08:00 de hoje) ainda está na hora.
    assert.deepEqual(r.comparecimento.semMarcar.map((a) => a.cliente).sort(), ['Caio', 'Dani'])
  })

  it('matrículas pendentes: só as que a recepção ainda não lançou', async () => {
    const t = montar()
    const m = { chat: WA, telefone: WA, email: '', nascimento: '', plano: 'VIP', pagamento: 'pix' as const, observacao: '' }
    const a = t.store.registrarMatricula({ ...m, nome: 'Ana Souza' }, AGORA.getTime())
    t.store.registrarMatricula({ ...m, nome: 'Bia Lima' }, AGORA.getTime())
    t.store.marcarMatriculaLancada(a, true, 'Recepção')
    const r = await t.metricas.resumo()
    assert.deepEqual(r.pendentes.map((p) => p.nome), ['Bia Lima'])
  })
})

describe('equipe, bot, custo e saúde', () => {
  it('clientes esperando a equipe: só quando o bot transferiu e ninguém respondeu ainda', async () => {
    const t = montar()
    const agora = AGORA.getTime()
    t.store.definirHandoff('5511900000001', 1, 'quer cancelar', agora - 20 * MIN)
    t.store.definirHandoff('5511900000002', 1, 'dúvida', agora - 3 * MIN)
    t.store.definirHandoff('5511900000003', 1, 'A equipe respondeu pelo WhatsApp.', agora - 30 * MIN)
    t.store.definirHandoff('5511900000004', 1, 'Transferido pela equipe.', agora - 30 * MIN)
    const r = await t.metricas.resumo()
    assert.deepEqual(r.espera.map((e) => [e.chat, e.minutos, e.alerta]), [['5511900000002', 3, false], ['5511900000001', 20, true]])
    assert.ok(ESPERA_ALERTA_MIN > 3 && ESPERA_ALERTA_MIN <= 20)
  })

  it('% resolvido pelo bot e o que ele não soube responder', async () => {
    const t = montar()
    const dia = AGORA.getTime() - 86_400_000
    for (const chat of ['a', 'b', 'c', 'd']) t.store.adicionarMensagem(chat, 'user', 'oi', dia)
    t.store.registrarEvento('transferencia', 'a', 'cancelar', dia)
    t.store.registrarEvento('transferencia', 'a', 'cancelar de novo', dia)
    t.store.registrarEvento('sem_resposta', 'b', 'Tem sauna?', dia)
    const r = await t.metricas.resumo()
    assert.equal(r.bot.conversasNoMes, 4)
    assert.equal(r.bot.conversasQueChamaramEquipe, 1, 'duas transferências da mesma conversa contam uma vez')
    assert.equal(r.bot.resolvidasPct, 75)
    assert.deepEqual(r.bot.semResposta.map((e) => e.detalhe), ['Tem sauna?'])
  })

  it('conversa antiga que chamou a equipe neste mês não faz a % ficar negativa', async () => {
    const t = montar()
    const agora = AGORA.getTime()
    t.store.adicionarMensagem('nova', 'user', 'oi', agora - 86_400_000)
    t.store.registrarEvento('transferencia', 'velha1', 'x', agora)
    t.store.registrarEvento('transferencia', 'velha2', 'x', agora)
    const r = await t.metricas.resumo()
    assert.equal(r.bot.conversasQueChamaramEquipe, 1)
    assert.equal(r.bot.resolvidasPct, 0)
  })

  it('sem conversas não existe percentual', async () => {
    const r = await montar().metricas.resumo()
    assert.equal(r.bot.resolvidasPct, undefined)
    assert.equal(r.custo.porConversaReais, undefined)
  })

  it('horários de pico: mensagens por hora no fuso da academia', async () => {
    const t = montar()
    const agora = AGORA.getTime()
    t.store.adicionarMensagem('a', 'user', 'oi', agora) // 09:00 em Brasília
    t.store.adicionarMensagem('b', 'user', 'oi', agora + 10 * MIN)
    t.store.adicionarMensagem('c', 'user', 'oi', agora + 13 * 3_600_000) // 22:00
    const r = await t.metricas.resumo()
    assert.equal(r.bot.mensagensPorHora.length, 24)
    assert.equal(r.bot.mensagensPorHora[9], 2)
    assert.equal(r.bot.mensagensPorHora[22], 1)
  })

  it('custo da IA: cálculo com cache e preço do modelo', () => {
    const haiku = { entrada: 0.1, saida: 0.5 }
    const c = custoEmReais({ entrada: 1_000_000, saida: 1_000_000, cacheLeitura: 1_000_000, cacheEscrita: 1_000_000 }, haiku, 5)
    assert.ok(Math.abs(c.usd - (0.1 + 0.5 + 0.01 + 0.125)) < 1e-9)
    assert.ok(Math.abs(c.reais - c.usd * 5) < 1e-9)
    assert.equal(custoEmReais({ entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 }, haiku, 5).reais, 0)
  })

  it('custo no painel: hoje, mês, projeção, % do limite e por conversa', async () => {
    const t = montar({ GASTO_LIMITE_MENSAL: '10', DOLAR_EM_REAIS: '5' })
    const agora = AGORA.getTime()
    t.store.registrarUsoIa({ modelo: 'm', entrada: 10_000_000, saida: 0, cacheLeitura: 0, cacheEscrita: 0 }, agora) // US$ 1 = R$ 5
    t.store.registrarUsoIa({ modelo: 'm', entrada: 10_000_000, saida: 0, cacheLeitura: 0, cacheEscrita: 0 }, agora - 5 * 86_400_000) // R$ 5 no mês, não hoje
    t.store.adicionarMensagem('a', 'user', 'oi', agora - 86_400_000)
    t.store.adicionarMensagem('b', 'user', 'oi', agora - 86_400_000)
    const r = await t.metricas.resumo()
    assert.equal(r.custo.hoje.chamadas, 1)
    assert.ok(Math.abs(r.custo.hoje.reais - 5) < 1e-9)
    assert.ok(Math.abs(r.custo.mes.reais - 10) < 1e-9)
    assert.equal(r.custo.percentualDoLimite, 100)
    assert.ok(Math.abs(r.custo.projecaoMesReais - (10 / 16) * 31) < 1e-9)
    assert.ok(Math.abs(r.custo.porConversaReais! - 5) < 1e-9)
    assert.equal(r.custo.precoEstimado, false, 'o modelo padrão está na tabela')
  })

  it('modelo desconhecido: estima para cima e avisa que o preço é estimado; PRECO_IA manda', async () => {
    const desconhecido = montar({ CLAUDE_MODEL: 'modelo-novo' })
    assert.equal((await desconhecido.metricas.resumo()).custo.precoEstimado, true)
    const t = montar({ CLAUDE_MODEL: 'modelo-novo', PRECO_IA: '1,2', DOLAR_EM_REAIS: '1' })
    t.store.registrarUsoIa({ modelo: 'm', entrada: 1_000_000, saida: 1_000_000, cacheLeitura: 0, cacheEscrita: 0 }, AGORA.getTime())
    const r = await t.metricas.resumo()
    assert.equal(r.custo.precoEstimado, false)
    assert.ok(Math.abs(r.custo.mes.usd - 3) < 1e-9)
  })

  it('saúde: WhatsApp conectado + cliente sem resposta há mais de 10 min = bot possivelmente mudo', async () => {
    const t = montar()
    const agora = AGORA.getTime()
    t.store.adicionarMensagem('5511900000001', 'user', 'oi?', agora - 30 * MIN)
    let r = await t.metricas.resumo()
    assert.equal(r.saude.mudo, true)
    assert.equal(r.saude.clientesSemResposta, 1)
    assert.equal(r.saude.ultimaMensagemCliente, agora - 30 * MIN)
    assert.equal(r.saude.ultimaRespostaBot, undefined)

    t.store.adicionarMensagem('5511900000001', 'assistant', 'olá', agora - 29 * MIN)
    r = await t.metricas.resumo()
    assert.equal(r.saude.mudo, false, 'respondeu')
  })

  it('não acusa "mudo" quando há motivo: mensagem recente, conversa com a equipe ou bot pausado', async () => {
    const t = montar()
    const agora = AGORA.getTime()
    t.store.adicionarMensagem('a', 'user', 'oi', agora - 2 * MIN)
    assert.equal((await t.metricas.resumo()).saude.mudo, false, 'faz só 2 minutos')

    t.store.adicionarMensagem('b', 'user', 'oi', agora - 40 * MIN)
    t.store.definirHandoff('b', 1, 'A equipe respondeu pelo WhatsApp.', agora - 39 * MIN)
    assert.equal((await t.metricas.resumo()).saude.mudo, false, 'a equipe está na conversa')

    t.store.adicionarMensagem('c', 'user', 'oi', agora - 40 * MIN)
    assert.equal((await t.metricas.resumo()).saude.mudo, true)
    t.store.pausar(null)
    assert.equal((await t.metricas.resumo()).saude.mudo, false, 'pausado de propósito')
  })

  it('WhatsApp caído: a saúde mostra o estado e nunca diz "mudo" (o problema é a conexão)', async () => {
    const google = new GoogleFalso()
    const { servico, store } = criarServico({ google })
    store.adicionarMensagem('a', 'user', 'oi', AGORA.getTime() - 40 * MIN)
    const caido: EstadoWhatsapp = { status: 'aguardando_qr', desde: AGORA.getTime() - 20 * MIN, foraDoArDesde: AGORA.getTime() - 20 * MIN }
    const m = new Metricas({ store, cfg: criarConfigDeTeste(), servico, estado: () => caido, cacheMs: 0 })
    const r = await m.resumo()
    assert.equal(r.saude.whatsapp.ok, false)
    assert.equal(r.saude.whatsapp.estado, 'aguardando_qr')
    assert.equal(r.saude.mudo, false)
  })
})
