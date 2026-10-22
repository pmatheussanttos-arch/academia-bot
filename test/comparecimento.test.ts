import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { criarApp, type AppDeps } from '../src/app.js'
import { epochLocal } from '../src/agenda.js'
import { FilaPorChave } from '../src/fila.js'
import { ErroPainel, PainelAgenda } from '../src/painel-agenda.js'
import type { ClienteWhatsapp } from '../src/whatsapp.js'
import { GoogleFalso, criarDepsDeAgente, criarServico } from './helpers.js'

const FUSO = 'America/Sao_Paulo'
const MIN = 60_000
const HOJE = '2026-10-16' // sexta, 09:00 em Brasília

function evento(google: GoogleFalso, hhmm: string, titulo: string, data = HOJE): string {
  const inicio = epochLocal(data, hhmm, FUSO)
  const id = `ev-${data}-${hhmm}`
  google.eventos.push({ id, titulo, ocupa: true, inicio, fim: inicio + 30 * MIN, privado: { whatsapp: '5511977776666' } })
  return id
}

describe('PainelAgenda.comparecimento', () => {
  function montar() {
    const google = new GoogleFalso()
    const { servico, store } = criarServico({ google })
    return { google, store, painel: new PainelAgenda(servico, store) }
  }

  it('anota, troca e apaga; guarda quem anotou, o cliente e o WhatsApp', async () => {
    const t = montar()
    const id = evento(t.google, '08:00', 'Avaliação — Maria Silva')
    const r = await t.painel.comparecimento({ eventoId: id, status: 'faltou', por: 'Ana' })
    assert.equal(r.status, 'faltou')
    assert.match(r.mensagem, /Maria Silva faltou/)
    const c = t.store.comparecimentoDe([id]).get(id)!
    assert.deepEqual([c.status, c.por, c.cliente, c.whatsapp], ['faltou', 'Ana', 'Maria Silva', '5511977776666'])

    await t.painel.comparecimento({ eventoId: id, status: 'matriculou', por: 'Bia' })
    assert.equal(t.store.comparecimentoDe([id]).get(id)!.por, 'Bia')
    const apagou = await t.painel.comparecimento({ eventoId: id, status: 'limpar', por: 'Bia' })
    assert.match(apagou.mensagem, /apagada/)
    assert.equal(t.store.comparecimentoDe([id]).size, 0)
  })

  it('recusa avaliação que ainda não aconteceu, evento que não é avaliação e evento inexistente', async () => {
    const t = montar()
    const futura = evento(t.google, '10:00', 'Avaliação — Futura')
    const reuniao = evento(t.google, '08:00', 'Reunião')
    for (const [id, codigo] of [[futura, 'futuro'], [reuniao, 'nao_e_avaliacao'], ['nao-existe', 'nao_existe']] as const) {
      await assert.rejects(t.painel.comparecimento({ eventoId: id, status: 'veio', por: 'Ana' }), (e: unknown) => e instanceof ErroPainel && e.codigo === codigo, codigo)
    }
    assert.equal(t.store.comparecimentos(0).length, 0)
  })

  it('apagar a anotação de uma avaliação futura é permitido (só não dá para criar)', async () => {
    const t = montar()
    const id = evento(t.google, '10:00', 'Avaliação — Futura')
    t.store.marcarComparecimento({ eventoId: id, inicio: 0, cliente: 'x', whatsapp: '', status: 'veio', por: 'Ana' })
    await t.painel.comparecimento({ eventoId: id, status: 'limpar', por: 'Ana' })
    assert.equal(t.store.comparecimentoDe([id]).size, 0)
  })

  it('a grade da semana avisa quando dá para anotar e mostra o que já foi anotado', async () => {
    const t = montar()
    const passada = evento(t.google, '08:00', 'Avaliação — Passada')
    evento(t.google, '10:00', 'Avaliação — Futura')
    await t.painel.comparecimento({ eventoId: passada, status: 'veio', por: 'Ana' })
    const semana = await t.painel.semana(HOJE)
    const slots = semana.dias.find((d) => d.hoje)!.slots
    const a = slots.find((s) => s.hhmm === '08:00')!
    const b = slots.find((s) => s.hhmm === '10:00')!
    assert.equal(a.podeAnotar, true)
    assert.equal(a.podeAlterar, false)
    assert.equal(a.ocupantes[0]!.comparecimento, 'veio')
    assert.equal(b.podeAnotar, false)
    assert.equal(b.podeAlterar, true)
    assert.equal(b.ocupantes[0]!.comparecimento, undefined)
  })
})

describe('rota da página dos professores', () => {
  function montar() {
    const google = new GoogleFalso()
    const base = criarDepsDeAgente([], { ADMIN_TOKEN: 'segredo-admin', AGENDA_PROFESSORES: 'Ana, Bia', WHATSAPP_MODO: 'qr' }, { google })
    const wa: ClienteWhatsapp = { async enviarTexto() {}, async marcarLida() {} }
    const deps: AppDeps = { ...base.deps, wa, avisarErro: async () => {}, fila: new FilaPorChave(), whatsappEstado: () => ({ status: 'conectado', desde: Date.now() }), iniciadoEm: Date.now() }
    return { app: criarApp(deps), google, store: base.store }
  }
  const post = (corpo: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) })

  async function ligar(app: ReturnType<typeof montar>['app']): Promise<string> {
    const r = await app.request('/admin/agenda', { method: 'POST', headers: { authorization: 'Bearer segredo-admin', 'content-type': 'application/json' }, body: JSON.stringify({ acao: 'ligar' }) })
    return ((await r.json()) as { caminho: string }).caminho
  }

  it('o professor anota pelo endereço secreto, com o nome dele', async () => {
    const t = montar()
    const caminho = await ligar(t.app)
    const id = evento(t.google, '08:00', 'Avaliação — Maria')
    const r = await t.app.request(`${caminho}/api/comparecimento`, post({ eventoId: id, status: 'veio', professor: 'Bia' }))
    assert.equal(r.status, 200)
    assert.equal(t.store.comparecimentoDe([id]).get(id)!.por, 'Bia')
  })

  it('exige o nome da lista, um status válido e o endereço certo', async () => {
    const t = montar()
    const caminho = await ligar(t.app)
    const id = evento(t.google, '08:00', 'Avaliação — Maria')
    assert.equal((await t.app.request(`${caminho}/api/comparecimento`, post({ eventoId: id, status: 'veio' }))).status, 400)
    assert.equal((await t.app.request(`${caminho}/api/comparecimento`, post({ eventoId: id, status: 'veio', professor: 'Intruso' }))).status, 400)
    assert.equal((await t.app.request(`${caminho}/api/comparecimento`, post({ eventoId: id, status: 'talvez', professor: 'Ana' }))).status, 400)
    assert.equal((await t.app.request('/agenda/codigo-errado/api/comparecimento', post({ eventoId: id, status: 'veio', professor: 'Ana' }))).status, 404)
    assert.equal(t.store.comparecimentos(0).length, 0)
  })

  it('a página tem os botões Veio, Faltou e Matriculou no detalhe da avaliação', async () => {
    const t = montar()
    const caminho = await ligar(t.app)
    const html = await (await t.app.request(caminho)).text()
    for (const trecho of ['/api/comparecimento', "anotar('veio'", "anotar('faltou'", "anotar('matriculou'", 'x.podeAnotar', 'Apagar anotação']) assert.ok(html.includes(trecho), trecho)
  })
})

describe('marcar direto no Google Agenda (✅ ❌ 🏋️ no fim do título)', () => {
  const casos: Array<[string, string, 'veio' | 'faltou' | 'matriculou']> = [
    ['Avaliação — Maria Silva ✅', 'Avaliação — Maria Silva', 'veio'],
    ['Avaliação — Maria Silva ❌', 'Avaliação — Maria Silva', 'faltou'],
    ['Avaliação — Maria Silva 🏋️', 'Avaliação — Maria Silva', 'matriculou'],
    ['Avaliação — Maria Silva 🏋', 'Avaliação — Maria Silva', 'matriculou'],
    ['Avaliação — Maria Silva veio', 'Avaliação — Maria Silva', 'veio'],
    ['Avaliação — Maria Silva - VEIO', 'Avaliação — Maria Silva', 'veio'],
    ['Avaliação — Maria Silva (veio)', 'Avaliação — Maria Silva', 'veio'],
    ['Avaliação — Maria Silva não veio', 'Avaliação — Maria Silva', 'faltou'],
    ['Avaliação — Maria Silva nao veio', 'Avaliação — Maria Silva', 'faltou'],
    ['Avaliação — Maria Silva faltou', 'Avaliação — Maria Silva', 'faltou'],
    ['Avaliação — Maria Silva matriculou', 'Avaliação — Maria Silva', 'matriculou'],
    ['Avaliação — Maria Silva fechou', 'Avaliação — Maria Silva', 'matriculou'],
  ]

  it('reconhece as marcas mais comuns e devolve o título limpo', async () => {
    const { lerMarcaDoTitulo } = await import('../src/painel-agenda.js')
    for (const [titulo, limpo, status] of casos) assert.deepEqual(lerMarcaDoTitulo(titulo), { limpo, status }, titulo)
  })

  it('não confunde nome com marca', async () => {
    const { lerMarcaDoTitulo, nomeDoCliente } = await import('../src/painel-agenda.js')
    for (const t of ['Avaliação — Edna (reavaliação)', 'Avaliação — Maria Silva', 'Avaliação', 'veio', 'Avaliação — Veiga', 'Avaliação — Faltoso Silva']) {
      assert.equal(lerMarcaDoTitulo(t).status, undefined, t)
      assert.equal(lerMarcaDoTitulo(t).limpo, t)
    }
    assert.equal(nomeDoCliente('Avaliação — Edna (reavaliação)'), 'Edna (reavaliação)')
    assert.equal(nomeDoCliente('Avaliação — Maria Silva ✅'), 'Maria Silva', 'o selo não vira parte do nome')
  })

  it('troca e tira a marca do título', async () => {
    const { comMarcaNoTitulo } = await import('../src/painel-agenda.js')
    assert.equal(comMarcaNoTitulo('Avaliação — Maria', 'veio'), 'Avaliação — Maria ✅')
    assert.equal(comMarcaNoTitulo('Avaliação — Maria ✅', 'faltou'), 'Avaliação — Maria ❌')
    assert.equal(comMarcaNoTitulo('Avaliação — Maria veio', 'matriculou'), 'Avaliação — Maria 🏋️')
    assert.equal(comMarcaNoTitulo('Avaliação — Maria ❌', null), 'Avaliação — Maria')
    assert.equal(comMarcaNoTitulo('Avaliação — Maria', null), 'Avaliação — Maria')
  })

  function montar() {
    const google = new GoogleFalso()
    const { servico, store } = criarServico({ google })
    return { google, store, painel: new PainelAgenda(servico, store) }
  }

  it('o painel conta a marca feita no Google, sem nada no banco', async () => {
    const { Metricas } = await import('../src/metricas.js')
    const { criarConfigDeTeste } = await import('./helpers.js')
    const t = montar()
    evento(t.google, '07:00', 'Avaliação — Ana ✅')
    evento(t.google, '07:30', 'Avaliação — Bia ❌')
    evento(t.google, '08:00', 'Avaliação — Caio 🏋️')
    evento(t.google, '08:30', 'Avaliação — Dani')
    const servico = criarServico({ google: t.google, store: t.store }).servico
    const r = await new Metricas({ store: t.store, cfg: criarConfigDeTeste(), servico, cacheMs: 0 }).resumo()
    assert.equal(r.comparecimento.veio, 1)
    assert.equal(r.comparecimento.faltou, 1)
    assert.equal(r.comparecimento.matriculou, 1)
    assert.equal(r.comparecimento.taxaFalta, 33)
    assert.deepEqual(r.hoje.map((a) => a.cliente), ['Ana', 'Bia', 'Caio', 'Dani'], 'o selo não vaza para o nome')
    assert.deepEqual(r.comparecimento.semMarcar.map((a) => a.cliente), [], 'a Dani passou há menos de 1h (08:30 vs 09:00)')
    assert.equal(t.store.comparecimentos(0).length, 0, 'nada foi gravado no banco')
  })

  it('se o Google e o banco discordam, vale o Google; sem marca no Google, vale o banco', async () => {
    const { Metricas } = await import('../src/metricas.js')
    const { criarConfigDeTeste } = await import('./helpers.js')
    const t = montar()
    const a = evento(t.google, '07:00', 'Avaliação — Ana ❌')
    const b = evento(t.google, '07:30', 'Avaliação — Bia')
    t.store.marcarComparecimento({ eventoId: a, inicio: 0, cliente: 'Ana', whatsapp: '', status: 'veio', por: 'x' })
    t.store.marcarComparecimento({ eventoId: b, inicio: 0, cliente: 'Bia', whatsapp: '', status: 'veio', por: 'x' })
    const servico = criarServico({ google: t.google, store: t.store }).servico
    const r = await new Metricas({ store: t.store, cfg: criarConfigDeTeste(), servico, cacheMs: 0 }).resumo()
    assert.equal(r.hoje.find((x) => x.cliente === 'Ana')!.comparecimento, 'faltou')
    assert.equal(r.hoje.find((x) => x.cliente === 'Bia')!.comparecimento, 'veio')
  })

  it('a grade dos professores mostra o selo marcado no Google', async () => {
    const t = montar()
    evento(t.google, '08:00', 'Avaliação — Ana ✅')
    const slot = (await t.painel.semana(HOJE)).dias.find((d) => d.hoje)!.slots.find((s) => s.hhmm === '08:00')!
    assert.equal(slot.ocupantes[0]!.comparecimento, 'veio')
    assert.equal(slot.ocupantes[0]!.cliente, 'Ana')
  })

  it('marcar pelo painel escreve no título do Google; trocar troca; apagar tira', async () => {
    const t = montar()
    const id = evento(t.google, '08:00', 'Avaliação — Maria Silva')
    await t.painel.comparecimento({ eventoId: id, status: 'faltou', por: 'Ana' })
    assert.equal(t.google.eventos[0]!.titulo, 'Avaliação — Maria Silva ❌')
    await t.painel.comparecimento({ eventoId: id, status: 'matriculou', por: 'Ana' })
    assert.equal(t.google.eventos[0]!.titulo, 'Avaliação — Maria Silva 🏋️')
    await t.painel.comparecimento({ eventoId: id, status: 'limpar', por: 'Ana' })
    assert.equal(t.google.eventos[0]!.titulo, 'Avaliação — Maria Silva')
    assert.equal(t.store.comparecimentoDe([id]).size, 0)
  })

  it('apagar pelo painel uma marca que está só no Google também funciona', async () => {
    const t = montar()
    const id = evento(t.google, '08:00', 'Avaliação — Maria Silva ✅')
    await t.painel.comparecimento({ eventoId: id, status: 'limpar', por: 'Ana' })
    assert.equal(t.google.eventos[0]!.titulo, 'Avaliação — Maria Silva')
  })

  it('se o Google falhar ao escrever, nada fica pela metade (nem no banco)', async () => {
    const t = montar()
    const id = evento(t.google, '08:00', 'Avaliação — Maria Silva')
    const original = t.google.renomearEvento.bind(t.google)
    t.google.renomearEvento = async () => {
      throw new Error('google fora do ar')
    }
    const erros = console.error
    console.error = () => {}
    try {
      await assert.rejects(t.painel.comparecimento({ eventoId: id, status: 'veio', por: 'Ana' }), (e: unknown) => e instanceof ErroPainel && e.codigo === 'google')
    } finally {
      console.error = erros
      t.google.renomearEvento = original
    }
    assert.equal(t.store.comparecimentoDe([id]).size, 0)
    assert.equal(t.google.eventos[0]!.titulo, 'Avaliação — Maria Silva')
  })

  it('o resto do bot continua achando o cliente com o selo no título (WhatsApp e nome)', async () => {
    const { nomeDoCliente, whatsappDoEvento } = await import('../src/painel-agenda.js')
    const e = { id: '1', titulo: 'Avaliação — Maria Silva ✅', ocupa: true, privado: { whatsapp: '5511977776666' } }
    assert.equal(nomeDoCliente(e.titulo), 'Maria Silva')
    assert.equal(whatsappDoEvento(e), '5511977776666')
  })
})
