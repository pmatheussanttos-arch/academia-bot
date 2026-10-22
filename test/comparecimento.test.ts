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
