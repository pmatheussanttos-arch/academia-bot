import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { carregarAgenda, epochLocal } from '../src/agenda.js'
import { ServicoAgenda } from '../src/agendamento.js'
import { carregarMensagens } from '../src/mensagens.js'
import { Metricas } from '../src/metricas.js'
import { LEMBRETES_POR_DIA, Rotinas, definirRotina, rotinaLigada, textoDoResumo, variantesDoNumero } from '../src/rotinas.js'
import { Store } from '../src/store.js'
import { GoogleFalso, criarConfigDeTeste } from './helpers.js'

const FUSO = 'America/Sao_Paulo'
const MIN = 60_000
const em = (data: string, hhmm: string) => epochLocal(data, hhmm, FUSO)

function montar(extra: Record<string, string> = {}, inicio = em('2026-10-19', '08:00')) {
  const relogio = { agora: inicio }
  const google = new GoogleFalso()
  const store = new Store(':memory:')
  const cfg = criarConfigDeTeste({ WHATSAPP_MODO: 'qr', ...extra })
  const servico = new ServicoAgenda({
    store,
    agenda: carregarAgenda('./agenda.json'),
    mensagens: carregarMensagens('./mensagens.md'),
    notificar: async () => {},
    google,
    agendaId: 'agenda-teste',
    automatico: true,
    agora: () => new Date(relogio.agora),
  })
  const avisos: string[] = []
  const enviadas: Array<{ para: string; texto: string }> = []
  const esperas: number[] = []
  const estado = { conectado: true, falharEnvio: false as boolean | ((para: string) => boolean) }
  const metricas = new Metricas({ store, cfg, servico, cacheMs: 0 })
  const rotinas = new Rotinas({
    store,
    cfg,
    servico,
    metricas,
    notificar: async (t) => void avisos.push(t),
    wa: {
      async enviarTexto(para, texto) {
        const falha = typeof estado.falharEnvio === 'function' ? estado.falharEnvio(para) : estado.falharEnvio
        if (falha) throw new Error('WhatsApp caiu')
        enviadas.push({ para, texto })
      },
    },
    conectado: () => estado.conectado,
    esperar: async (ms) => void esperas.push(ms),
  })
  return { relogio, google, store, cfg, rotinas, metricas, avisos, enviadas, esperas, estado }
}

function aval(google: GoogleFalso, data: string, hhmm: string, cliente: string, whatsapp?: string): string {
  const inicio = em(data, hhmm)
  const id = `ev-${data}-${hhmm}-${google.eventos.length}`
  google.eventos.push({ id, titulo: cliente ? `Avaliação — ${cliente}` : 'Avaliação', ocupa: true, inicio, fim: inicio + 30 * MIN, ...(whatsapp ? { privado: { whatsapp } } : {}) })
  return id
}

describe('rotinas: liga e desliga', () => {
  it('resumo nasce ligado, lembrete nasce desligado, e o painel muda e a escolha fica guardada', () => {
    const store = new Store(':memory:')
    assert.equal(rotinaLigada(store, 'resumo'), true)
    assert.equal(rotinaLigada(store, 'lembrete'), false)
    definirRotina(store, 'lembrete', true)
    definirRotina(store, 'resumo', false)
    assert.equal(rotinaLigada(store, 'lembrete'), true)
    assert.equal(rotinaLigada(store, 'resumo'), false)
  })
})

describe('resumo semanal', () => {
  function semanaPassada(t: ReturnType<typeof montar>) {
    const a = aval(t.google, '2026-10-13', '10:00', 'Ana', '5511977776666')
    const b = aval(t.google, '2026-10-14', '10:00', 'Bia')
    aval(t.google, '2026-10-15', '10:00', 'Caio')
    aval(t.google, '2026-10-20', '10:00', 'Da próxima semana')
    t.store.marcarComparecimento({ eventoId: a, inicio: em('2026-10-13', '10:00'), cliente: 'Ana', whatsapp: '', status: 'matriculou', por: 'x' })
    t.store.marcarComparecimento({ eventoId: b, inicio: em('2026-10-14', '10:00'), cliente: 'Bia', whatsapp: '', status: 'faltou', por: 'x' })
    t.store.adicionarMensagem('c1', 'user', 'oi', em('2026-10-13', '09:00'))
    t.store.adicionarMensagem('c2', 'user', 'oi', em('2026-10-14', '09:00'))
    t.store.registrarEvento('transferencia', 'c2', 'x', em('2026-10-14', '09:30'))
    t.store.registrarMatricula({ chat: 'c1', nome: 'Ana Souza', telefone: '5511977776666', email: '', nascimento: '', plano: 'VIP', pagamento: 'pix', observacao: '' }, em('2026-10-13', '12:00'))
    t.store.registrarUsoIa({ modelo: 'm', entrada: 10_000_000, saida: 0, cacheLeitura: 0, cacheEscrita: 0 }, em('2026-10-14', '12:00'))
  }

  it('segunda às 8h manda o balanço da semana que passou; antes das 8h não manda', async () => {
    const t = montar({ DOLAR_EM_REAIS: '5' }, em('2026-10-19', '07:59'))
    semanaPassada(t)
    assert.equal(await t.rotinas.resumoSemanal(), false)
    assert.equal(t.avisos.length, 0)
    t.relogio.agora = em('2026-10-19', '08:00')
    assert.equal(await t.rotinas.resumoSemanal(), true)
    const texto = t.avisos[0]!
    assert.match(texto, /Resumo da semana \(12\/10 a 18\/10\)/)
    assert.match(texto, /Avaliações: 3 \(1 vieram · 1 faltaram · 1 fecharam matrícula · 1 sem anotação\)/)
    assert.match(texto, /Matrículas pelo WhatsApp: 1/)
    assert.match(texto, /Conversas novas: 2 \(o bot resolveu 50% sozinho\)/)
    assert.match(texto, /Gasto estimado com a IA: R\$ 5,00/)
    assert.match(texto, /1 matrícula\(s\) ainda para lançar/)
    assert.match(texto, /Esta semana já tem 1 avaliação\(ões\) marcada\(s\)/)
  })

  it('uma vez só por semana, mesmo chamando várias vezes e reiniciando', async () => {
    const t = montar()
    for (let i = 0; i < 5; i++) await t.rotinas.tick()
    assert.equal(t.avisos.length, 1)
    t.relogio.agora = em('2026-10-19', '15:00')
    await t.rotinas.tick()
    assert.equal(t.avisos.length, 1)
    // "reiniciou": outra instância com o mesmo banco
    const outra = new Rotinas({ ...(t.rotinas as unknown as { d: ConstructorParameters<typeof Rotinas>[0] }).d })
    await outra.tick()
    assert.equal(t.avisos.length, 1)
    // segunda seguinte
    t.relogio.agora = em('2026-10-26', '09:00')
    await t.rotinas.tick()
    assert.equal(t.avisos.length, 2)
    assert.match(t.avisos[1]!, /19\/10 a 25\/10/)
  })

  it('só às segundas, e só quando está ligado', async () => {
    const t = montar({}, em('2026-10-20', '09:00')) // terça
    await t.rotinas.tick()
    assert.equal(t.avisos.length, 0)
    t.relogio.agora = em('2026-10-19', '09:00')
    definirRotina(t.store, 'resumo', false)
    await t.rotinas.tick()
    assert.equal(t.avisos.length, 0)
    definirRotina(t.store, 'resumo', true)
    await t.rotinas.tick()
    assert.equal(t.avisos.length, 1)
  })

  it('se o aviso falhar, não repete (melhor perder um resumo do que mandar duplicado) e o tick não quebra', async () => {
    const t = montar()
    let chamadas = 0
    const d = (t.rotinas as unknown as { d: ConstructorParameters<typeof Rotinas>[0] }).d
    const r = new Rotinas({ ...d, notificar: async () => { chamadas++; throw new Error('sem rede') } })
    const erros = console.error
    console.error = () => {}
    try {
      await r.tick()
      await r.tick()
    } finally {
      console.error = erros
    }
    assert.equal(chamadas, 1)
  })

  it('Google fora do ar: o resumo sai mesmo assim, com o aviso de que está incompleto', async () => {
    const t = montar()
    t.google.falhar = true
    const erros = console.error
    console.error = () => {}
    try {
      await t.rotinas.tick()
    } finally {
      console.error = erros
    }
    assert.match(t.avisos[0]!, /Não consegui ler a agenda do Google/)
  })

  it('o texto sem dados fica enxuto e sem linhas vazias de avisos', () => {
    const texto = textoDoResumo({ rotulo: '12/10 a 18/10', avaliacoes: { total: 0, veio: 0, faltou: 0, matriculou: 0, semAnotar: 0 }, matriculasPeloBot: 0, conversasNovas: 0, gastoReais: 0, pendentes: 0, marcadasProximaSemana: 0, agendaOk: true })
    assert.doesNotMatch(texto, /ainda para lançar|sem anotar|Não consegui/)
    assert.match(texto, /Conversas novas: 0\n/)
  })
})

describe('alerta de gasto da IA', () => {
  const gasta = (t: ReturnType<typeof montar>, reais: number) =>
    t.store.registrarUsoIa({ modelo: 'm', entrada: (reais / 5) * 10_000_000, saida: 0, cacheLeitura: 0, cacheEscrita: 0 }, t.relogio.agora - 1000)

  it('avisa a 80% e a 100%, uma vez cada, e não antes', async () => {
    const t = montar({ GASTO_LIMITE_MENSAL: '10', DOLAR_EM_REAIS: '5' }, em('2026-10-21', '12:00'))
    gasta(t, 7.9)
    assert.equal(await t.rotinas.alertaGasto(), false)
    gasta(t, 0.2) // 8,10 = 81%
    assert.equal(await t.rotinas.alertaGasto(), true)
    assert.match(t.avisos[0]!, /chegou a 81% do limite do mês: R\$ 8,10 de R\$ 10,00/)
    assert.equal(await t.rotinas.alertaGasto(), false, 'não repete o de 80%')
    gasta(t, 2)
    assert.equal(await t.rotinas.alertaGasto(), true)
    assert.match(t.avisos[1]!, /passou do limite do mês/)
    assert.equal(await t.rotinas.alertaGasto(), false)
    assert.equal(t.avisos.length, 2)
  })

  it('pular direto para mais de 100% manda só o aviso de 100%, e no mês seguinte recomeça', async () => {
    const t = montar({ GASTO_LIMITE_MENSAL: '10', DOLAR_EM_REAIS: '5' }, em('2026-10-21', '12:00'))
    gasta(t, 12)
    await t.rotinas.alertaGasto()
    await t.rotinas.alertaGasto()
    assert.equal(t.avisos.length, 1)
    assert.match(t.avisos[0]!, /passou do limite/)
    t.relogio.agora = em('2026-11-03', '12:00')
    gasta(t, 9)
    assert.equal(await t.rotinas.alertaGasto(), true, 'novo mês, novo aviso')
  })

  it('limite 0 desliga o aviso', async () => {
    const t = montar({ GASTO_LIMITE_MENSAL: '0', DOLAR_EM_REAIS: '5' })
    gasta(t, 1000)
    assert.equal(await t.rotinas.alertaGasto(), false)
  })
})

describe('lembrete ao cliente (dia anterior)', () => {
  const SEXTA_17H30 = em('2026-10-16', '17:30')
  const WA = '5511977776666'

  function pronto(extra: Record<string, string> = {}) {
    const t = montar(extra, SEXTA_17H30)
    definirRotina(t.store, 'lembrete', true)
    t.store.adicionarMensagem(WA, 'user', 'oi', SEXTA_17H30 - 86_400_000)
    return t
  }

  it('manda o lembrete de amanhã para quem já conversou, e o bot passa a saber da mensagem', async () => {
    const t = pronto()
    aval(t.google, '2026-10-17', '10:00', 'Maria Silva', WA)
    assert.equal(await t.rotinas.lembretes(), 1)
    assert.equal(t.enviadas.length, 1)
    assert.equal(t.enviadas[0]!.para, WA)
    assert.match(t.enviadas[0]!.texto, /^Oi, Maria! Passando para lembrar da sua avaliação/)
    assert.match(t.enviadas[0]!.texto, /Sábado, 17\/10, às 10:00/)
    const historico = t.store.historico(WA, 10)
    assert.equal(historico.at(-1)!.papel, 'assistant')
    assert.equal(historico.at(-1)!.conteudo, t.enviadas[0]!.texto)
    assert.equal(t.store.contarLembretes(0, 'enviado'), 1)
  })

  it('só uma vez por avaliação, mesmo chamando de novo', async () => {
    const t = pronto()
    aval(t.google, '2026-10-17', '10:00', 'Maria', WA)
    await t.rotinas.lembretes()
    await t.rotinas.lembretes()
    await t.rotinas.tick()
    assert.equal(t.enviadas.length, 1)
  })

  it('DESLIGADO por padrão', async () => {
    const t = montar({}, SEXTA_17H30)
    t.store.adicionarMensagem(WA, 'user', 'oi', SEXTA_17H30 - 1000)
    aval(t.google, '2026-10-17', '10:00', 'Maria', WA)
    assert.equal(await t.rotinas.lembretes(), 0)
    assert.equal(t.enviadas.length, 0)
  })

  it('só entre 17h e 20h', async () => {
    const t = pronto()
    aval(t.google, '2026-10-17', '10:00', 'Maria', WA)
    for (const hhmm of ['16:59', '20:00', '07:00']) {
      t.relogio.agora = em('2026-10-16', hhmm)
      assert.equal(await t.rotinas.lembretes(), 0, hhmm)
    }
    t.relogio.agora = em('2026-10-16', '19:59')
    assert.equal(await t.rotinas.lembretes(), 1)
  })

  it('só para quem já conversou com o bot: os outros são pulados e anotados', async () => {
    const t = pronto()
    aval(t.google, '2026-10-17', '10:00', 'Desconhecido', '5511900009999')
    aval(t.google, '2026-10-17', '10:30', 'Sem número')
    assert.equal(await t.rotinas.lembretes(), 0)
    assert.equal(t.enviadas.length, 0)
    assert.equal(t.store.contarLembretes(0, 'pulado: nunca conversou'), 1)
    assert.equal(t.store.contarLembretes(0, 'pulado: sem WhatsApp'), 1)
  })

  it('acha a conversa com ou sem o 9 extra e manda para o número que o WhatsApp já usa', async () => {
    assert.deepEqual(variantesDoNumero('5511977776666').sort(), ['551177776666', '5511977776666'])
    assert.deepEqual(variantesDoNumero('(11) 97777-6666').sort(), ['551177776666', '5511977776666'])
    const t = pronto()
    t.store.apagarConversa(WA)
    t.store.adicionarMensagem('551177776666', 'user', 'oi', SEXTA_17H30 - 1000) // o WhatsApp guardou sem o 9
    aval(t.google, '2026-10-17', '10:00', 'Maria', WA)
    assert.equal(await t.rotinas.lembretes(), 1)
    assert.equal(t.enviadas[0]!.para, '551177776666')
  })

  it('não manda se a equipe está na conversa, se o bot está pausado ou se o WhatsApp está fora', async () => {
    const t = pronto()
    aval(t.google, '2026-10-17', '10:00', 'Maria', WA)
    t.estado.conectado = false
    assert.equal(await t.rotinas.lembretes(), 0)
    t.estado.conectado = true
    t.store.pausar(null)
    assert.equal(await t.rotinas.lembretes(), 0)
    assert.equal(t.store.lembreteRegistrado(t.google.eventos[0]!.id), false, 'pausa não "gasta" o lembrete: sai quando voltar')
    t.store.retomar()
    t.store.definirHandoff(WA, 1, 'A equipe respondeu pelo WhatsApp.', SEXTA_17H30)
    assert.equal(await t.rotinas.lembretes(), 0)
    assert.equal(t.store.contarLembretes(0, 'pulado: a equipe'), 1)
    assert.equal(t.enviadas.length, 0)
  })

  it('modo oficial da Meta: nunca manda (exigiria modelo aprovado)', async () => {
    const t = pronto({ WHATSAPP_MODO: 'cloud' })
    aval(t.google, '2026-10-17', '10:00', 'Maria', WA)
    assert.equal(await t.rotinas.lembretes(), 0)
  })

  it('teto de 30 por dia e pausa entre os envios (nunca antes do primeiro)', async () => {
    const t = pronto()
    for (let i = 0; i < LEMBRETES_POR_DIA + 5; i++) {
      const chat = `55119${String(10000000 + i)}`
      t.store.adicionarMensagem(chat, 'user', 'oi', SEXTA_17H30 - 1000)
      aval(t.google, '2026-10-17', '10:00', `Cliente ${i}`, chat)
    }
    assert.equal(await t.rotinas.lembretes(), LEMBRETES_POR_DIA)
    assert.equal(t.enviadas.length, LEMBRETES_POR_DIA)
    assert.equal(t.esperas.length, LEMBRETES_POR_DIA - 1)
    assert.ok(t.esperas.every((ms) => ms >= 5000))
    assert.equal(await t.rotinas.lembretes(), 0, 'no mesmo dia, o teto já foi atingido')
  })

  it('falha no envio: anota, não tenta de novo, e segue para o próximo cliente', async () => {
    const t = pronto()
    t.store.adicionarMensagem('5511966665555', 'user', 'oi', SEXTA_17H30 - 1000)
    aval(t.google, '2026-10-17', '10:00', 'Maria', WA)
    aval(t.google, '2026-10-17', '11:00', 'João', '5511966665555')
    t.estado.falharEnvio = (para) => para === WA
    const erros = console.error
    console.error = () => {}
    try {
      assert.equal(await t.rotinas.lembretes(), 1)
      t.estado.falharEnvio = false
      assert.equal(await t.rotinas.lembretes(), 0, 'a que falhou não é repetida')
    } finally {
      console.error = erros
    }
    assert.deepEqual(t.enviadas.map((e) => e.para), ['5511966665555'])
    assert.equal(t.store.contarLembretes(0, 'falhou: WhatsApp caiu'), 1)
  })

  it('só avaliações de AMANHÃ (não de hoje nem de depois) e só eventos de avaliação', async () => {
    const t = pronto()
    aval(t.google, '2026-10-16', '19:00', 'Hoje', WA)
    aval(t.google, '2026-10-18', '10:00', 'Depois', WA)
    t.google.eventos.push({ id: 'r', titulo: 'Reunião', ocupa: true, inicio: em('2026-10-17', '09:00'), fim: em('2026-10-17', '09:30'), privado: { whatsapp: WA } })
    assert.equal(await t.rotinas.lembretes(), 0)
  })

  it('sem nome no evento não sai "Oi, !"', async () => {
    const t = pronto()
    aval(t.google, '2026-10-17', '10:00', '', WA)
    await t.rotinas.lembretes()
    assert.match(t.enviadas[0]!.texto, /^Oi! Passando/)
  })
})
