import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  Acompanhamento,
  HORA_CLIENTE_ATE,
  LEMBRETE_PARADA_APOS_MIN,
  nomeInformado,
  parouNoMeioDeUmaVenda,
  tempoEspera,
} from '../src/acompanhamento.js'
import { abertoEm, carregarAgenda, epochLocal } from '../src/agenda.js'
import { ServicoAgenda } from '../src/agendamento.js'
import { AUTOMATICAS_POR_DIA, INTERVALO_MIN_MS, pediuParaParar } from '../src/automaticas.js'
import { carregarMensagens } from '../src/mensagens.js'
import { definirRotina } from '../src/rotinas.js'
import { Store } from '../src/store.js'
import { criarConfigDeTeste } from './helpers.js'

const FUSO = 'America/Sao_Paulo'
const MIN = 60_000
const em = (data: string, hhmm: string) => epochLocal(data, hhmm, FUSO)
const SEXTA = '2026-10-16'
const CHAT = '553288465841'

function montar(extra: Record<string, string> = {}, inicio = em(SEXTA, '10:00')) {
  const relogio = { agora: inicio }
  const store = new Store(':memory:')
  const cfg = criarConfigDeTeste({ WHATSAPP_MODO: 'qr', ...extra })
  const servico = new ServicoAgenda({
    store,
    agenda: carregarAgenda('./agenda.json'),
    mensagens: carregarMensagens('./mensagens.md'),
    notificar: async () => {},
    automatico: false,
    agora: () => new Date(relogio.agora),
  })
  const avisos: string[] = []
  const enviadas: Array<{ para: string; texto: string }> = []
  const estado = { conectado: true, falhar: false as boolean | ((para: string) => boolean) }
  const a = new Acompanhamento({
    store,
    cfg,
    servico,
    notificar: async (t) => void avisos.push(t),
    wa: {
      async enviarTexto(para, texto) {
        const falha = typeof estado.falhar === 'function' ? estado.falhar(para) : estado.falhar
        if (falha) throw new Error('WhatsApp caiu')
        enviadas.push({ para, texto })
      },
    },
    conectado: () => estado.conectado,
    aleatorio: () => 0,
  })
  return { relogio, store, cfg, servico, a, avisos, enviadas, estado }
}

type T = ReturnType<typeof montar>

/** Conversa em que o bot pediu o nome, a cliente respondeu e o bot transferiu para a equipe. */
function transferida(t: T, chat = CHAT, quando = em(SEXTA, '09:00'), motivo = 'quer remarcar a avaliação', nomePerfil = 'perfil zap'): number {
  t.store.adicionarMensagem(chat, 'user', 'oi', quando - 10 * MIN)
  t.store.adicionarMensagem(chat, 'assistant', 'Olá! Eu sou o GFIT. Primeiramente, qual o seu nome?', quando - 9 * MIN)
  t.store.adicionarMensagem(chat, 'user', 'Andressa Oliveira de Paula', quando - 8 * MIN)
  t.store.adicionarMensagem(chat, 'user', 'Posso mudar meu horário?', quando - 1 * MIN)
  t.store.adicionarMensagem(chat, 'assistant', 'Ok, vou te transferir para um atendente. Aguarde um instante, que já vai te responder! 😊', quando)
  t.store.registrarEvento('transferencia', chat, motivo, quando, nomePerfil)
  t.store.definirHandoff(chat, 5, motivo, quando)
  return t.store.transferenciasSemResposta(0).find((x) => x.chat === chat)!.id
}

/** Cliente que perguntou preço, o bot respondeu terminando em pergunta, e ela sumiu. */
function parada(t: T, chat = CHAT, ultimaDoBot = em(SEXTA, '09:00'), extra: { botTermina?: string; semNome?: boolean } = {}) {
  if (!extra.semNome) {
    t.store.adicionarMensagem(chat, 'user', 'oi', ultimaDoBot - 20 * MIN)
    t.store.adicionarMensagem(chat, 'assistant', 'Olá! Eu sou o GFIT. Primeiramente, qual o seu nome?', ultimaDoBot - 19 * MIN)
    t.store.adicionarMensagem(chat, 'user', 'Andressa', ultimaDoBot - 18 * MIN)
  } else {
    t.store.adicionarMensagem(chat, 'user', 'oi', ultimaDoBot - 20 * MIN)
  }
  t.store.adicionarMensagem(chat, 'user', 'quanto custa a mensalidade?', ultimaDoBot - 5 * MIN)
  t.store.adicionarMensagem(chat, 'assistant', extra.botTermina ?? 'O plano 3x por semana fica R$ 89,90 por mês. Você gostaria de treinar 3x por semana ou todos os dias?', ultimaDoBot)
}

const ligarRetomada = (t: T) => definirRotina(t.store, 'retomada', true)

describe('aviso à equipe: cliente transferido sem resposta', () => {
  it('depois de 30 minutos avisa com nome, número, última mensagem e há quanto tempo espera', async () => {
    const t = montar({}, em(SEXTA, '09:29'))
    transferida(t)
    assert.equal(await t.a.alertasEquipe(), 0, 'com 29 min ainda não')
    t.relogio.agora = em(SEXTA, '09:30')
    assert.equal(await t.a.alertasEquipe(), 1)
    const aviso = t.avisos[0]!
    assert.match(aviso, /Cliente esperando a equipe há 30 min/)
    assert.match(aviso, /Nome: Andressa\n/, 'o nome que ela disse, não o do perfil')
    assert.match(aviso, /WhatsApp: \+553288465841/)
    assert.match(aviso, /Última mensagem do cliente: "Posso mudar meu horário\?"/)
    assert.match(aviso, /Motivo da transferência: quer remarcar a avaliação/)
  })

  it('sem nome na conversa usa o do perfil; sem nenhum, diz "(sem nome)"', async () => {
    const t = montar({}, em(SEXTA, '10:00'))
    t.store.adicionarMensagem('5511911112222', 'user', 'quero falar com alguém', em(SEXTA, '09:00'))
    t.store.registrarEvento('transferencia', '5511911112222', 'pediu uma pessoa', em(SEXTA, '09:00'), 'Zé do Perfil')
    t.store.adicionarMensagem('5511933334444', 'user', 'oi', em(SEXTA, '09:00'))
    t.store.registrarEvento('transferencia', '5511933334444', 'pediu uma pessoa', em(SEXTA, '09:01'), '')
    await t.a.alertasEquipe()
    assert.match(t.avisos[0]!, /Nome: Zé do Perfil/)
    assert.match(t.avisos[1]!, /Nome: \(sem nome\)/)
  })

  it('repete UMA vez, 2 horas depois do primeiro aviso, e nunca mais', async () => {
    const t = montar({}, em(SEXTA, '09:30'))
    transferida(t)
    await t.a.alertasEquipe()
    assert.equal(t.avisos.length, 1)
    t.relogio.agora = em(SEXTA, '11:29')
    assert.equal(await t.a.alertasEquipe(), 0)
    t.relogio.agora = em(SEXTA, '11:30')
    assert.equal(await t.a.alertasEquipe(), 1)
    assert.match(t.avisos[1]!, /Segundo aviso: o cliente continua esperando há 2h30/)
    for (const h of ['12:00', '15:00', '18:00', '20:00']) {
      t.relogio.agora = em(SEXTA, h)
      await t.a.alertasEquipe()
    }
    assert.equal(t.avisos.length, 2, 'nunca um terceiro')
  })

  it('a equipe respondeu: nada, e se respondeu depois do primeiro aviso, não repete', async () => {
    const t = montar({}, em(SEXTA, '09:30'))
    transferida(t)
    t.store.registrarEvento('equipe_respondeu', CHAT, 'respondeu', em(SEXTA, '09:10'))
    assert.equal(await t.a.alertasEquipe(), 0)

    const u = montar({}, em(SEXTA, '09:30'))
    transferida(u)
    await u.a.alertasEquipe()
    u.store.registrarEvento('equipe_respondeu', CHAT, 'respondeu', em(SEXTA, '10:00'))
    u.relogio.agora = em(SEXTA, '12:00')
    await u.a.alertasEquipe()
    assert.equal(u.avisos.length, 1)
  })

  it('devolver a conversa ao bot também encerra a espera', async () => {
    const t = montar({}, em(SEXTA, '09:40'))
    transferida(t)
    t.store.registrarEvento('equipe_respondeu', CHAT, 'devolvida ao bot', em(SEXTA, '09:35'))
    assert.equal(await t.a.alertasEquipe(), 0)
  })

  it('só em horário de funcionamento: fora dele espera abrir e então avisa uma vez', async () => {
    const t = montar({}, em(SEXTA, '12:30')) // sexta, almoço: fechado
    transferida(t, CHAT, em(SEXTA, '11:30'))
    assert.equal(await t.a.alertasEquipe(), 0)
    t.relogio.agora = em(SEXTA, '21:00')
    assert.equal(await t.a.alertasEquipe(), 0, 'fechou às 21h')
    t.relogio.agora = em(SEXTA, '14:00')
    assert.equal(await t.a.alertasEquipe(), 1, 'reabriu')
    assert.match(t.avisos[0]!, /há 2h30/)
    t.relogio.agora = em(SEXTA, '14:01')
    await t.a.alertasEquipe()
    assert.equal(t.avisos.length, 1, 'o segundo só 2h depois do primeiro, não logo em seguida')
  })

  it('sábado só das 8h às 11h; domingo e feriado, nunca', async () => {
    const agenda = carregarAgenda('./agenda.json')
    assert.equal(abertoEm(agenda, em('2026-10-17', '08:00')), true)
    assert.equal(abertoEm(agenda, em('2026-10-17', '10:59')), true)
    assert.equal(abertoEm(agenda, em('2026-10-17', '11:00')), false)
    assert.equal(abertoEm(agenda, em('2026-10-18', '10:00')), false)
    assert.equal(abertoEm(agenda, em('2026-10-19', '04:59')), false)
    assert.equal(abertoEm(agenda, em('2026-10-19', '05:00')), true)
    assert.equal(abertoEm(agenda, em('2026-10-19', '12:00')), false)
    assert.equal(abertoEm(agenda, em('2026-10-19', '14:00')), true)
    assert.equal(abertoEm(agenda, em('2026-10-19', '21:00')), false)
    assert.equal(abertoEm({ ...agenda, diasFechados: ['2026-10-19'] }, em('2026-10-19', '15:00')), false)
  })

  it('transferência de mais de 24 horas atrás é ignorada, assim como ligar/desligar e o modo Cloud', async () => {
    const t = montar({}, em(SEXTA, '10:00'))
    transferida(t, CHAT, em(SEXTA, '10:00') - 25 * 3_600_000)
    assert.equal(await t.a.alertasEquipe(), 0)

    const u = montar({}, em(SEXTA, '10:00'))
    transferida(u, CHAT, em(SEXTA, '09:00'))
    definirRotina(u.store, 'alerta_espera', false)
    assert.equal(await u.a.alertasEquipe(), 0)
    definirRotina(u.store, 'alerta_espera', true)
    assert.equal(await u.a.alertasEquipe(), 1)

    const c = montar({ WHATSAPP_MODO: 'cloud' }, em(SEXTA, '10:00'))
    transferida(c, CHAT, em(SEXTA, '09:00'))
    assert.equal(await c.a.alertasEquipe(), 0, 'na API oficial o bot não vê quando a equipe responde')
  })

  it('se o aviso falhar, não repete (melhor perder do que duplicar)', async () => {
    const t = montar({}, em(SEXTA, '09:40'))
    transferida(t)
    let chamadas = 0
    ;(t.a as unknown as { d: { notificar: () => Promise<void> } }).d.notificar = async () => {
      chamadas++
      throw new Error('sem rede')
    }
    await assert.rejects(t.a.alertasEquipe())
    await t.a.tick()
    await t.a.tick()
    assert.equal(chamadas, 1)
  })
})

describe('lembrete ao cliente transferido e sem resposta da equipe (2 horas)', () => {
  it('manda UMA mensagem curta e devolve a conversa ao bot', async () => {
    const t = montar({}, em(SEXTA, '10:59'))
    ligarRetomada(t)
    transferida(t, CHAT, em(SEXTA, '09:00'))
    assert.equal(await t.a.lembretes(), 0, 'com 1h59 ainda não')
    t.relogio.agora = em(SEXTA, '11:00')
    assert.equal(t.store.emHandoff(CHAT, t.relogio.agora), true, 'transferência de 5h ainda silencia o bot')
    assert.equal(await t.a.lembretes(), 1)
    assert.equal(t.enviadas[0]!.para, CHAT)
    assert.equal(t.enviadas[0]!.texto, 'Oi, Andressa! Aqui é o GFIT da GarageFit 😊 Desculpa a demora. Ficou alguma dúvida ou posso te ajudar a finalizar seu agendamento?')
    assert.equal(t.store.emHandoff(CHAT, t.relogio.agora), false, 'o bot volta a atender')
    assert.equal(t.store.historico(CHAT, 3).at(-1)!.conteudo, t.enviadas[0]!.texto, 'o bot sabe a que a cliente está respondendo')
    assert.equal(t.store.acompanhamentos(0, 'lembrete_')[0]!.resultado, 'enviado')
  })

  it('só um por conversa: nem pelo mesmo motivo, nem por outro', async () => {
    const t = montar({}, em(SEXTA, '11:00'))
    ligarRetomada(t)
    transferida(t)
    await t.a.lembretes()
    for (let i = 0; i < 20; i++) {
      t.relogio.agora += 10 * 60_000
      await t.a.lembretes()
    }
    assert.equal(t.enviadas.length, 1)
    // nova transferência da mesma conversa, horas depois: continua sendo só um lembrete por conversa
    t.store.registrarEvento('transferencia', CHAT, 'outra vez', t.relogio.agora - 3 * 3_600_000)
    t.store.adicionarMensagem(CHAT, 'user', 'oi de novo', t.relogio.agora - 3 * 3_600_000)
    await t.a.lembretes()
    assert.equal(t.enviadas.length, 1)
  })

  it('a equipe respondeu no meio-tempo: nada', async () => {
    const t = montar({}, em(SEXTA, '11:30'))
    ligarRetomada(t)
    transferida(t)
    t.store.registrarEvento('equipe_respondeu', CHAT, 'respondeu', em(SEXTA, '09:20'))
    assert.equal(await t.a.lembretes(), 0)
    assert.equal(t.enviadas.length, 0)
  })

  it('cliente que não escreve há mais de 24 horas não recebe', async () => {
    const t = montar({}, em(SEXTA, '14:00'))
    ligarRetomada(t)
    // transferida há 23h59m30s: a última mensagem da cliente (1 min antes) já passou de 24h
    transferida(t, CHAT, em(SEXTA, '14:00') - 24 * 3_600_000 + 30_000)
    assert.equal(await t.a.lembretes(), 0)
    assert.match(t.store.acompanhamentos(0, 'pulado')[0]!.resultado, /mais de 24 horas/)
    assert.equal(t.enviadas.length, 0)
  })
})

describe('lembrete a quem parou no meio de uma venda (3 horas)', () => {
  it('depois de 3 horas manda UMA mensagem curta; antes, não', async () => {
    const t = montar({}, em(SEXTA, '11:59'))
    ligarRetomada(t)
    parada(t, CHAT, em(SEXTA, '09:00'))
    assert.equal(await t.a.lembretes(), 0)
    t.relogio.agora = em(SEXTA, '09:00') + LEMBRETE_PARADA_APOS_MIN * MIN - 1
    assert.equal(await t.a.lembretes(), 0, 'faltou 1 ms')
    t.relogio.agora = em(SEXTA, '12:00')
    // 12:00 é o intervalo de almoço da academia: espera reabrir
    assert.equal(await t.a.lembretes(), 0)
    t.relogio.agora = em(SEXTA, '14:00')
    assert.equal(await t.a.lembretes(), 1)
    assert.equal(t.enviadas[0]!.texto, 'Oi, Andressa, conseguiu ver? Posso te ajudar a finalizar?')
    assert.equal(t.store.acompanhamentos(0, 'lembrete_parou').length, 1)
  })

  it('sem nome na conversa não sai "Oi, , conseguiu"', async () => {
    const t = montar({}, em(SEXTA, '14:00'))
    ligarRetomada(t)
    parada(t, CHAT, em(SEXTA, '09:00'), { semNome: true })
    await t.a.lembretes()
    assert.equal(t.enviadas[0]!.texto, 'Oi, conseguiu ver? Posso te ajudar a finalizar?')
  })

  it('só para quem estava numa venda e ficou sem responder uma pergunta do bot', async () => {
    const t = montar({}, em(SEXTA, '14:00'))
    ligarRetomada(t)
    parada(t, '5511900000001', em(SEXTA, '09:00'), { botTermina: 'O plano 3x por semana fica R$ 89,90. Qualquer dúvida, é só chamar!' })
    t.store.adicionarMensagem('5511900000002', 'user', 'que horas abre?', em(SEXTA, '09:00') - MIN)
    t.store.adicionarMensagem('5511900000002', 'assistant', 'Abrimos às 5h. Posso ajudar em mais alguma coisa?', em(SEXTA, '09:00'))
    assert.equal(await t.a.lembretes(), 0)
    assert.equal(t.enviadas.length, 0)
    assert.equal(parouNoMeioDeUmaVenda([{ papel: 'user', conteudo: 'oi', ts: 1 }], 0), false)
  })

  it('quem já agendou ou se matriculou não é incomodado', async () => {
    const t = montar({}, em(SEXTA, '14:00'))
    ligarRetomada(t)
    parada(t, CHAT, em(SEXTA, '09:00'))
    t.store.registrarEvento('avaliacao_bot', CHAT, 'avaliacao_fisica 2026-10-19 14:00', em(SEXTA, '08:50'))
    assert.equal(await t.a.lembretes(), 0)
  })

  it('se a equipe falou com o cliente depois da última mensagem dele, nada', async () => {
    const t = montar({}, em(SEXTA, '14:00'))
    ligarRetomada(t)
    parada(t, CHAT, em(SEXTA, '09:00'))
    t.store.registrarEvento('equipe_respondeu', CHAT, 'respondeu', em(SEXTA, '09:30'))
    assert.equal(await t.a.lembretes(), 0)
  })

  it('conversa que está com a equipe (bot calado) não é retomada por esta regra', async () => {
    const t = montar({}, em(SEXTA, '14:00'))
    ligarRetomada(t)
    parada(t, CHAT, em(SEXTA, '09:00'))
    t.store.definirHandoff(CHAT, 100, 'A equipe respondeu pelo WhatsApp.', em(SEXTA, '09:10'))
    assert.equal(await t.a.lembretes(), 0)
  })
})

describe('limites dos lembretes (risco de banimento)', () => {
  it('DESLIGADO por padrão: nada sai, mas o aviso à equipe continua', async () => {
    const t = montar({}, em(SEXTA, '14:00'))
    parada(t, CHAT, em(SEXTA, '09:00'))
    transferida(t, '5511911112222', em(SEXTA, '12:30'))
    await t.a.tick()
    assert.equal(t.enviadas.length, 0)
    assert.equal(t.avisos.length, 1)
  })

  it('nunca para quem pediu para parar', async () => {
    assert.equal(pediuParaParar(['quanto custa?', 'pode parar de me mandar mensagem']), true)
    for (const frase of ['pare', 'Não quero', 'nao tenho interesse', 'sem interesse, obrigada', 'me deixa em paz', 'não me mande mais nada', 'STOP']) {
      assert.equal(pediuParaParar([frase]), true, frase)
    }
    for (const frase of ['quero saber o preço', 'vou pensar', 'para quando é a avaliação?', 'parece bom']) {
      assert.equal(pediuParaParar([frase]), false, frase)
    }
    const t = montar({}, em(SEXTA, '14:00'))
    ligarRetomada(t)
    parada(t, CHAT, em(SEXTA, '09:00'))
    t.store.adicionarMensagem(CHAT, 'user', 'não quero mais, obrigada', em(SEXTA, '09:03'))
    t.store.adicionarMensagem(CHAT, 'assistant', 'Tudo bem! Posso ajudar em algo mais?', em(SEXTA, '09:04'))
    assert.equal(await t.a.lembretes(), 0)
    assert.match(t.store.acompanhamentos(0, 'pulado')[0]!.resultado, /pediu para não receber/)
  })

  it('nunca para os números da equipe, nem para conversas que não são de pessoa', async () => {
    const t = montar({ NUMEROS_AVISOS: '5511966665555' }, em(SEXTA, '14:00'))
    ligarRetomada(t)
    parada(t, '5511966665555', em(SEXTA, '09:00'))
    parada(t, '120363025246125486', em(SEXTA, '09:00')) // 18 dígitos: grupo
    assert.equal(await t.a.lembretes(), 0)
    const motivos = t.store.acompanhamentos(0, 'pulado').map((a) => a.resultado)
    assert.ok(motivos.some((m) => /número da equipe/.test(m)))
    assert.ok(motivos.some((m) => /não é uma conversa de pessoa/.test(m)))
  })

  it('só em horário comercial da academia e entre 8h e 20h', async () => {
    const casos: Array<[string, string, number]> = [
      [SEXTA, '07:59', 0], // academia aberta, mas cedo demais para cliente
      [SEXTA, '12:30', 0], // almoço
      [SEXTA, '20:00', 0], // academia aberta até 21h, mas cliente só até 20h
      ['2026-10-17', '11:30', 0], // sábado depois das 11h
      ['2026-10-18', '10:00', 0], // domingo
      [SEXTA, '08:00', 1],
    ]
    assert.equal(HORA_CLIENTE_ATE, 20)
    for (const [dia, hhmm, esperado] of casos) {
      const t = montar({}, em(dia, hhmm))
      ligarRetomada(t)
      parada(t, CHAT, em(dia, hhmm) - 5 * 3_600_000)
      assert.equal(await t.a.lembretes(), esperado, `${dia} ${hhmm}`)
    }
  })

  it('só quando o WhatsApp está conectado e o bot não está pausado', async () => {
    const t = montar({}, em(SEXTA, '14:00'))
    ligarRetomada(t)
    parada(t, CHAT, em(SEXTA, '09:00'))
    t.estado.conectado = false
    assert.equal(await t.a.lembretes(), 0)
    t.estado.conectado = true
    t.store.pausar(null)
    assert.equal(await t.a.lembretes(), 0)
    t.store.retomar()
    assert.equal(await t.a.lembretes(), 1)
  })

  it('modo oficial da Meta: nunca', async () => {
    const t = montar({ WHATSAPP_MODO: 'cloud' }, em(SEXTA, '14:00'))
    ligarRetomada(t)
    parada(t, CHAT, em(SEXTA, '09:00'))
    assert.equal(await t.a.lembretes(), 0)
  })

  it('um por vez, com intervalo de 1 a 5 minutos entre eles, e no máximo 10 por dia', async () => {
    const t = montar({}, em(SEXTA, '14:00'))
    ligarRetomada(t)
    for (let i = 0; i < AUTOMATICAS_POR_DIA + 4; i++) parada(t, `55119${String(20000000 + i)}`, em(SEXTA, '09:00'))
    assert.equal(await t.a.lembretes(), 1)
    assert.equal(await t.a.lembretes(), 0, 'sem esperar, nada')
    t.relogio.agora += INTERVALO_MIN_MS - 1
    assert.equal(await t.a.lembretes(), 0)
    t.relogio.agora += 1
    assert.equal(await t.a.lembretes(), 1)
    for (let i = 0; i < 40; i++) {
      t.relogio.agora += INTERVALO_MIN_MS
      await t.a.lembretes()
    }
    assert.equal(t.enviadas.length, AUTOMATICAS_POR_DIA)
  })

  it('o teto de 10 é compartilhado com o lembrete de avaliação', async () => {
    const t = montar({}, em(SEXTA, '14:00'))
    ligarRetomada(t)
    for (let i = 0; i < AUTOMATICAS_POR_DIA - 1; i++) t.store.registrarLembrete(`ev${i}`, 'enviado', em(SEXTA, '13:00'))
    parada(t, '5511900000001', em(SEXTA, '09:00'))
    parada(t, '5511900000002', em(SEXTA, '09:00'))
    assert.equal(await t.a.lembretes(), 1, 'ainda cabia um')
    t.relogio.agora += 10 * MIN
    assert.equal(await t.a.lembretes(), 0, 'o décimo já foi')
  })

  it('falha no envio: anota, não tenta de novo e segue para o próximo', async () => {
    const t = montar({}, em(SEXTA, '14:00'))
    ligarRetomada(t)
    parada(t, '5511900000001', em(SEXTA, '09:00') - 60 * MIN)
    parada(t, '5511900000002', em(SEXTA, '09:00'))
    t.estado.falhar = (para) => para === '5511900000001'
    const erros = console.error
    console.error = () => {}
    try {
      assert.equal(await t.a.lembretes(), 1)
      t.estado.falhar = false
      t.relogio.agora += 10 * MIN
      assert.equal(await t.a.lembretes(), 0, 'a que falhou não é repetida')
    } finally {
      console.error = erros
    }
    assert.deepEqual(t.enviadas.map((e) => e.para), ['5511900000002'])
    assert.equal(t.store.acompanhamentos(0, 'lembrete_').filter((a) => /^falhou/.test(a.resultado)).length, 1)
  })

  it('tick() não deixa dois ciclos rodarem ao mesmo tempo', async () => {
    const t = montar({}, em(SEXTA, '14:00'))
    ligarRetomada(t)
    parada(t, CHAT, em(SEXTA, '09:00'))
    await Promise.all([t.a.tick(), t.a.tick(), t.a.tick()])
    assert.equal(t.enviadas.length, 1)
  })
})

describe('apoios: nome informado, espera e texto', () => {
  it('o nome é o que a pessoa DISSE depois de o bot perguntar', () => {
    const h = (...m: Array<['user' | 'assistant', string]>) => m.map(([papel, conteudo], i) => ({ papel, conteudo, ts: i }))
    assert.equal(nomeInformado(h(['assistant', 'Qual o seu nome?'], ['user', 'Andressa Oliveira'])), 'Andressa')
    assert.equal(nomeInformado(h(['assistant', 'Primeiramente, qual o seu nome?'], ['user', 'meu nome é joão'])), 'João')
    assert.equal(nomeInformado(h(['assistant', 'qual o seu nome?'], ['user', 'Me chamo Bia.'])), 'Bia')
    assert.equal(nomeInformado(h(['assistant', 'qual o seu nome?'], ['user', 'quanto custa a mensalidade?'])), '', 'pergunta não é nome')
    assert.equal(nomeInformado(h(['assistant', 'qual o seu nome?'], ['user', 'oi, tudo bem? quero saber dos planos de vocês'])), '')
    assert.equal(nomeInformado(h(['user', 'Maria'])), '', 'sem o bot perguntar, não é nome')
  })

  it('tempo de espera por extenso', () => {
    assert.equal(tempoEspera(5), '5 min')
    assert.equal(tempoEspera(60), '1h00')
    assert.equal(tempoEspera(125), '2h05')
  })
})
