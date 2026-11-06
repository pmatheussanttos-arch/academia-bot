import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { responder } from '../src/agent.js'
import { campanhaDoDia, carregarCampanha } from '../src/campanha.js'
import { montarSistema } from '../src/prompt.js'
import { criarDepsDeAgente, texto, usarFerramenta } from './helpers.js'

const FUSO = 'America/Sao_Paulo'
const CHAT = '5511977776666'
const brt = (dataHora: string) => new Date(`${dataHora}-03:00`)
const real = carregarCampanha('./campanha.md')!

function sistemaTexto(chamada: { system?: unknown }): string {
  return (chamada.system as Array<{ text: string }>).map((b) => b.text).join('\n====\n')
}

describe('campanha.md (Black GarageFit)', () => {
  it('o arquivo carrega, com as datas da campanha e as duas seções', () => {
    assert.ok(real)
    assert.deepEqual([real.inicio, real.semanaFinal, real.fim, real.encerradaAte], ['2026-11-02', '2026-11-23', '2026-11-30', '2026-12-31'])
    assert.ok(real.texto.length > 3000)
    assert.ok(real.textoEncerrada.length > 100)
  })

  it('a oferta e as contas batem: pague 6 treine 7, pague 12 treine 14, R$ 699,30 no mensal', () => {
    const t = real.texto
    assert.match(t, /Semestral VIP: 6x R\$ 79,90 \(total R\$ 479,40\)\. A pessoa paga 6 meses e treina 7 meses/)
    assert.match(t, /Anual VIP: 12x R\$ 69,90 \(total R\$ 838,80\)\. A pessoa paga 12 meses e treina 14 meses/)
    assert.match(t, /1 convidado por mês/)
    assert.equal((6 * 79.9).toFixed(2), '479.40')
    assert.equal((12 * 69.9).toFixed(2), '838.80')
    assert.match(t, /7 meses no mensal \(R\$ 99,90\) dão R\$ 699,30/)
    assert.equal((7 * 99.9).toFixed(2), '699.30')
    assert.match(t, /No Semestral Black são R\$ 479,40/)
  })

  it('traz as regras que a equipe pediu: pagamento, início, aluno atual e o que o bot não sabe', () => {
    const t = real.texto
    assert.match(t, /O Pix NÃO tem desconto: o valor total é o mesmo do cartão/)
    assert.match(t, /Cartão parcelado SEM JUROS, ou Pix/)
    assert.match(t, /Não precisa de documento/)
    assert.match(t, /Na hora da contratação, ou só em janeiro, se a pessoa preferir \(pagando até 30\/11\)/)
    assert.match(t, /Aluno atual pode entrar na Black/)
    assert.match(t, /Quem já tem Semestral ou Anual ativo também pode contratar/)
    assert.match(t, /a equipe confirma com você/)
    assert.match(t, /Nunca invente regra, prazo, desconto ou condição/)
    assert.match(t, /NÃO mencionar GoNutri, funcional, brinde nem "vagas limitadas"/)
    assert.match(t, /Nunca usar "conseguiu visualizar\?"/)
    assert.match(t, /Nunca citar plano mensal antes dos VIPs/)
    assert.match(t, /Para "tá caro" e "vou pensar", use as mensagens 4 e 5/)
  })

  it('o bot envia o link de pagamento ele mesmo (semestral_vip / anual_vip) e anota quando começa', () => {
    const t = real.texto
    assert.match(t, /ferramenta enviar_link_pagamento \(plano semestral_vip ou anual_vip\)/)
    assert.match(t, /"Black: começa agora" ou "Black: começa em janeiro"/)
    assert.doesNotMatch(t, /A equipe te envia o link/, 'nenhuma mensagem diz que a equipe envia: quem envia é o bot')
  })

  it('as mensagens-modelo estão todas lá, da 0 à 8, e a 9 só na seção de campanha encerrada', () => {
    for (const m of ['0)', '1)', '2)', '3)', '3b)', '3c)', '4)', '5)', '6)', '6b)', '6c)', '7)', '8)']) assert.ok(real.texto.includes(`\n${m} `), m)
    assert.doesNotMatch(real.texto, /\n9\) /)
    assert.match(real.textoEncerrada, /9\) Depois do encerramento/)
    assert.match(real.textoEncerrada, /a Black acabou, mas posso te mostrar a melhor opção hoje/)
  })

  it('os links de pagamento do Semestral e do Anual existem e têm o valor da campanha', () => {
    const m = readFileSync('./mensagens.md', 'utf8')
    assert.match(m, /semestral_vip \| https:\/\/link\.infinitepay\.io\/[^\s]*-479,40/)
    assert.match(m, /anual_vip \| https:\/\/link\.infinitepay\.io\/[^\s]*-838,80/)
  })
})

describe('a campanha entra e sai sozinha pelas datas (fuso de Brasília)', () => {
  const fase = (dh: string) => campanhaDoDia(real, brt(dh), FUSO)?.fase

  it('antes, durante, semana final, último dia, encerrada e depois', () => {
    assert.equal(fase('2026-11-01T23:59'), undefined, 'véspera: ainda não')
    assert.equal(fase('2026-11-02T00:00'), 'ativa')
    assert.equal(fase('2026-11-22T23:59'), 'ativa')
    assert.equal(fase('2026-11-23T00:00'), 'semana_final')
    assert.equal(fase('2026-11-29T23:59'), 'semana_final')
    assert.equal(fase('2026-11-30T00:00'), 'ultimo_dia')
    assert.equal(fase('2026-11-30T23:59'), 'ultimo_dia', 'vale até o fim do dia 30 em Brasília (mesmo já sendo dia 1º em UTC)')
    assert.equal(fase('2026-12-01T00:00'), 'encerrada')
    assert.equal(fase('2026-12-31T23:59'), 'encerrada')
    assert.equal(fase('2027-01-01T00:00'), undefined, 'depois disso o arquivo é ignorado')
  })

  it('quem não veio pela Black: a primeira resposta PERGUNTA se quer conhecer a promoção; e o bot segue o contexto', () => {
    const t = real.texto
    assert.match(t, /=== QUEM NÃO VEIO PELA BLACK/)
    assert.match(t, /Não presuma que ela quer a Black: PERGUNTE primeiro/)
    assert.match(t, /\nA\) Primeira resposta para quem NÃO veio pela Black[^\n]*\nOlá! Eu sou o GFIT, atendente virtual aqui da GarageFit 😊 Estamos com a Black Friday da GarageFit, valendo até 30\/11 🖤 Quer conhecer a promoção\?/)
    assert.match(t, /Se a pessoa não quiser a promoção ou pedir os planos mensais: responda o que ela perguntou \(pode usar enviar_valores\)/)
    assert.match(t, /=== CONTEXTO DA CONVERSA/)
    assert.match(t, /responda primeiro o que a pessoa acabou de perguntar/)
    assert.match(t, /Nunca repita uma pergunta que já foi respondida \(nome, objetivo\) nem comece com "Oi" no meio da conversa/)
    assert.match(t, /Objetivo: levar ao fechamento/)
  })

  it('cada fase diz ao modelo que dia é e o que usar', () => {
    assert.match(campanhaDoDia(real, brt('2026-11-10T10:00'), FUSO)!.aviso, /10\/11, a campanha está valendo \(até 30\/11\)/)
    assert.match(campanhaDoDia(real, brt('2026-11-25T10:00'), FUSO)!.aviso, /SEMANA FINAL[^.]*mensagem 7/)
    assert.match(campanhaDoDia(real, brt('2026-11-30T10:00'), FUSO)!.aviso, /ÚLTIMO DIA[^.]*mensagem 8/)
    const fim = campanhaDoDia(real, brt('2026-12-05T10:00'), FUSO)!
    assert.match(fim.aviso, /terminou em 30\/11\. Não ofereça mais/)
    assert.equal(fim.texto, real.textoEncerrada, 'depois do fim vale só a mensagem de encerramento, sem a oferta')
    assert.doesNotMatch(fim.texto, /Semestral VIP: 6x/)
  })

  it('sem arquivo, ou com arquivo torto, não há campanha e o bot não quebra', () => {
    assert.equal(carregarCampanha('./nao-existe.md'), undefined)
    const pasta = mkdtempSync(join(tmpdir(), 'camp-'))
    const erros = console.error
    console.error = () => {}
    try {
      for (const conteudo of [
        'inicio: ontem\nsemana-final: 2026-11-23\nfim: 2026-11-30\nencerrada-ate: 2026-12-31\n\n## campanha\ntexto',
        'inicio: 2026-11-02\nsemana-final: 2026-11-23\nfim: 2026-11-30\nencerrada-ate: 2026-12-31\n',
        'inicio: 2026-11-30\nsemana-final: 2026-11-23\nfim: 2026-11-02\nencerrada-ate: 2026-12-31\n\n## campanha\ntexto',
      ]) {
        const arq = join(pasta, 'c.md')
        writeFileSync(arq, conteudo)
        assert.equal(carregarCampanha(arq), undefined)
      }
    } finally {
      console.error = erros
    }
    assert.equal(campanhaDoDia(undefined, new Date(), FUSO), undefined)
  })
})

describe('a campanha chega ao modelo', () => {
  function montar(extra: Record<string, string> = {}) {
    return criarDepsDeAgente([texto('ok'), texto('ok')], extra)
  }

  it('dentro das datas: um bloco próprio, depois das instruções e antes da data de hoje, avisando que vale mais', async () => {
    const t = montar()
    t.deps.agora = () => brt('2026-11-10T10:00')
    t.store.adicionarMensagem(CHAT, 'user', 'BLACK')
    await responder(t.deps, CHAT, undefined)
    const blocos = t.chamadas[0]!.system as Array<{ text: string; cache_control?: unknown }>
    assert.equal(blocos.length, 3)
    assert.match(blocos[0]!.text, /# Instruções da academia/)
    assert.match(blocos[1]!.text, /^# CAMPANHA EM ANDAMENTO \(vale mais do que qualquer regra antiga\)/)
    assert.match(blocos[1]!.text, /Semestral VIP: 6x R\$ 79,90/)
    assert.ok(blocos[1]!.cache_control, 'igual o período todo: vai para o cache')
    assert.match(blocos[2]!.text, /CAMPANHA: hoje, 10\/11, a campanha está valendo/)
  })

  it('antes de 02/11 e depois de 31/12, o prompt é o de sempre (sem bloco de campanha)', async () => {
    for (const quando of ['2026-10-20T10:00', '2027-01-10T10:00']) {
      const t = montar()
      t.deps.agora = () => brt(quando)
      t.store.adicionarMensagem(CHAT, 'user', 'oi')
      await responder(t.deps, CHAT, undefined)
      assert.equal((t.chamadas[0]!.system as unknown[]).length, 2, quando)
      assert.doesNotMatch(sistemaTexto(t.chamadas[0]!), /CAMPANHA/)
    }
  })

  it('depois do fim (dezembro) entra só o texto de encerramento', async () => {
    const t = montar()
    t.deps.agora = () => brt('2026-12-03T10:00')
    t.store.adicionarMensagem(CHAT, 'user', 'vi a Black no story')
    await responder(t.deps, CHAT, undefined)
    const s = sistemaTexto(t.chamadas[0]!)
    assert.match(s, /A campanha Black GarageFit TERMINOU em 30\/11\/2026/)
    assert.match(s, /a Black acabou, mas posso te mostrar a melhor opção hoje/)
    assert.doesNotMatch(s, /pague 6 e treine 7 \(6x/)
  })

  it('arquivo de campanha de outro caminho (CAMPANHA_PATH) funciona', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'camp-'))
    const arq = join(pasta, 'outra.md')
    writeFileSync(arq, 'inicio: 2026-12-01\nsemana-final: 2026-12-10\nfim: 2026-12-20\nencerrada-ate: 2026-12-31\n\n## campanha\nNATAL: texto da outra campanha\n\n## encerrada\nacabou')
    const t = montar({ CAMPANHA_PATH: arq })
    t.deps.agora = () => brt('2026-12-05T10:00')
    t.store.adicionarMensagem(CHAT, 'user', 'oi')
    await responder(t.deps, CHAT, undefined)
    assert.match(sistemaTexto(t.chamadas[0]!), /NATAL: texto da outra campanha/)
  })

  it('montarSistema sem campanha continua com 2 blocos', () => {
    assert.equal(montarSistema('instruções', new Date(), undefined).length, 2)
    assert.equal(montarSistema('instruções', new Date(), undefined, FUSO, [], { texto: 'x', aviso: 'y' }).length, 3)
  })
})

describe('lista padrão de valores durante a campanha', () => {
  it('na campanha, a ferramenta enviar_valores manda seguir a campanha em vez da lista padrão', async () => {
    const t = criarDepsDeAgente([usarFerramenta('enviar_valores', {}), texto('ok')])
    t.deps.agora = () => brt('2026-11-10T10:00')
    t.store.adicionarMensagem(CHAT, 'user', 'quero saber dos planos')
    await responder(t.deps, CHAT, undefined)
    const resultado = JSON.stringify(t.chamadas[1]!.messages.at(-1)!.content)
    assert.match(resultado, /Se a pessoa AINDA NÃO disse se quer conhecer a promoção, NÃO envie esta lista/)
    assert.match(resultado, /Só se ela RECUSOU a promoção ou pediu os planos mensais/)
  })

  it('fora da campanha (e depois do encerramento) a lista padrão continua', async () => {
    for (const quando of ['2026-10-20T10:00', '2026-12-03T10:00']) {
      const t = criarDepsDeAgente([usarFerramenta('enviar_valores', {}), texto('ok')])
      t.deps.agora = () => brt(quando)
      t.store.adicionarMensagem(CHAT, 'user', 'quero saber dos planos')
      await responder(t.deps, CHAT, undefined)
      assert.match(JSON.stringify(t.chamadas[1]!.messages.at(-1)!.content), /Trimestral VIP — R\$ 89,90\/mês/, quando)
    }
  })
})

describe('instruções da academia com a campanha', () => {
  const i = readFileSync('./instrucoes.md', 'utf8')
  it('a apresentação inicial tem a exceção para lead da campanha', () => {
    assert.match(i, /\*\*Exceção:\*\* se existir uma seção "CAMPANHA EM ANDAMENTO", a primeira resposta segue a campanha \(para lead da campanha, pule esta apresentação; para os outros, use a apresentação da campanha, que pergunta se a pessoa quer conhecer a promoção\)/)
  })
  it('GoNutri e funcional saíram de todos os lugares', () => {
    assert.doesNotMatch(i, /GoNutri|funcional|nutri/i)
    assert.doesNotMatch(readFileSync('./mensagens.md', 'utf8'), /GoNutri|funcional/i)
  })
})
