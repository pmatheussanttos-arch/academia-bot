import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { criarApp, type AppDeps } from '../src/app.js'
import { codigosIguais, gerarCodigo, lerProfessores } from '../src/acesso-agenda.js'
import { epochLocal } from '../src/agenda.js'
import { FilaPorChave } from '../src/fila.js'
import type { ClienteWhatsapp } from '../src/whatsapp.js'
import { AGORA, GoogleFalso, SEGUNDA, criarDepsDeAgente } from './helpers.js'

const FUSO = 'America/Sao_Paulo'
const ADMIN = 'segredo-admin'
const PROFS = 'Ana, Bia, Carlos'

function montar(extra: Record<string, string> = {}) {
  const google = new GoogleFalso()
  const base = criarDepsDeAgente([], { ADMIN_TOKEN: ADMIN, AGENDA_PROFESSORES: PROFS, WHATSAPP_MODO: 'qr', ...extra }, { google })
  const wa: ClienteWhatsapp = { async enviarTexto() {}, async marcarLida() {} }
  const deps: AppDeps = { ...base.deps, wa, avisarErro: async () => {}, fila: new FilaPorChave(), whatsappEstado: () => ({ status: 'conectado', desde: Date.now() }), iniciadoEm: Date.now() }
  return { app: criarApp(deps), google, store: base.store, cfg: base.cfg }
}

const admin = { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }
const post = (corpo: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) })

async function ligar(app: ReturnType<typeof montar>['app']): Promise<string> {
  const r = await app.request('/admin/agenda', { method: 'POST', headers: admin, body: JSON.stringify({ acao: 'ligar' }) })
  assert.equal(r.status, 200)
  return ((await r.json()) as { caminho: string }).caminho
}

describe('lista de professores e código do endereço', () => {
  it('lê os nomes separados por vírgula, sem repetidos nem lixo', () => {
    assert.deepEqual(lerProfessores('Ana, Bia ,Ana,  , Carlos'), ['Ana', 'Bia', 'Carlos'])
    assert.deepEqual(lerProfessores(undefined), [])
    assert.deepEqual(lerProfessores('<script>x</script>'), ['script x /script'], 'sinais de HTML viram espaço')
    assert.equal(lerProfessores('a'.repeat(100))[0]!.length, 40)
    assert.equal(lerProfessores(Array.from({ length: 60 }, (_, i) => `P${i}`).join(',')).length, 40)
  })

  it('cada código é diferente, longo e comparado com segurança', () => {
    const a = gerarCodigo()
    assert.match(a, /^[A-Za-z0-9_-]{26}$/)
    assert.notEqual(a, gerarCodigo())
    assert.equal(codigosIguais(a, a), true)
    assert.equal(codigosIguais(a, a.slice(0, -1) + 'x'), false)
    assert.equal(codigosIguais(a, a + 'x'), false, 'tamanhos diferentes não quebram')
  })
})

describe('ligar e desligar a página (só o dono)', () => {
  it('desligada por padrão: qualquer endereço de agenda dá 404', async () => {
    const { app, store } = montar()
    assert.equal(((await (await app.request('/admin/agenda', { headers: admin })).json()) as { ligada: boolean }).ligada, false)
    assert.equal((await app.request('/agenda')).status, 404)
    assert.equal((await app.request(`/agenda/${gerarCodigo()}`)).status, 404)
    assert.equal((await app.request('/agenda/qualquer/api/semana')).status, 404)
    assert.equal(store.lerAjuste('agenda_codigo'), undefined)
  })

  it('o dono liga, recebe o endereço e a página abre; /health acompanha', async () => {
    const { app } = montar()
    assert.equal(((await (await app.request('/health')).json()) as { agenda_professores: boolean }).agenda_professores, false)
    const caminho = await ligar(app)
    assert.match(caminho, /^\/agenda\/[A-Za-z0-9_-]{26}$/)
    const pagina = await app.request(caminho)
    assert.equal(pagina.status, 200)
    const html = await pagina.text()
    assert.match(html, /Agenda de avaliações/)
    assert.match(html, /"Ana","Bia","Carlos"/, 'a lista de professores vai na página')
    assert.equal(((await (await app.request('/health')).json()) as { agenda_professores: boolean }).agenda_professores, true)
  })

  it('"novo link" derruba o endereço antigo; desligar fecha tudo', async () => {
    const { app } = montar()
    const antigo = await ligar(app)
    const novo = ((await (await app.request('/admin/agenda', { method: 'POST', headers: admin, body: JSON.stringify({ acao: 'novo_link' }) })).json()) as { caminho: string }).caminho
    assert.notEqual(novo, antigo)
    assert.equal((await app.request(antigo)).status, 404)
    assert.equal((await app.request(novo)).status, 200)
    assert.equal((await app.request(`${antigo}/api/semana`)).status, 404)

    await app.request('/admin/agenda', { method: 'POST', headers: admin, body: JSON.stringify({ acao: 'desligar' }) })
    assert.equal((await app.request(novo)).status, 404)
    assert.equal((await app.request(`${novo}/api/semana`)).status, 404)
  })

  it('sem ADMIN_TOKEN certo ninguém liga nem vê o endereço', async () => {
    const { app, store } = montar()
    for (const req of [
      app.request('/admin/agenda'),
      app.request('/admin/agenda?token=errado'),
      app.request('/admin/agenda', post({ acao: 'ligar' })),
      app.request('/admin/agenda?token=errado', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"acao":"ligar"}' }),
    ]) {
      assert.equal((await req).status, 401)
    }
    assert.equal(store.lerAjuste('agenda_codigo'), undefined)
    assert.equal((await app.request('/admin/agenda', { method: 'POST', headers: admin, body: JSON.stringify({ acao: 'dançar' }) })).status, 400)
  })

  it('sem AGENDA_PROFESSORES não deixa ligar (o registro ficaria sem nome)', async () => {
    const { app } = montar({ AGENDA_PROFESSORES: '' })
    const r = await app.request('/admin/agenda', { method: 'POST', headers: admin, body: JSON.stringify({ acao: 'ligar' }) })
    assert.equal(r.status, 400)
    assert.match(((await r.json()) as { erro: string }).erro, /AGENDA_PROFESSORES/)
  })

  it('o endereço continua valendo depois de reiniciar (fica no banco)', async () => {
    const { app, store } = montar()
    const caminho = await ligar(app)
    const outro = montar()
    // simula o reinício: outro app lendo o mesmo banco
    const codigo = store.lerAjuste('agenda_codigo')!
    outro.store.definirAjuste('agenda_codigo', codigo)
    assert.equal((await outro.app.request(caminho)).status, 200)
  })
})

describe('a página não vaza em buscador nem em cache', () => {
  it('manda noindex, no-store, sem referrer e com política de conteúdo', async () => {
    const { app } = montar()
    const caminho = await ligar(app)
    const r = await app.request(caminho)
    assert.match(r.headers.get('x-robots-tag') ?? '', /noindex/)
    assert.match(r.headers.get('cache-control') ?? '', /no-store/)
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer')
    assert.match(r.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/)
    const html = await r.text()
    assert.match(html, /<meta name="robots" content="noindex/)
    const api = await app.request(`${caminho}/api/semana`)
    assert.match(api.headers.get('x-robots-tag') ?? '', /noindex/)
    assert.match(api.headers.get('cache-control') ?? '', /no-store/)
  })
})

describe('rotas da agenda', () => {
  async function pronto() {
    const m = montar()
    const caminho = await ligar(m.app)
    return { ...m, caminho }
  }

  it('semana: devolve os dias, com livre/ocupado e os dados do cliente', async () => {
    const { app, google, caminho } = await pronto()
    google.eventos.push({ id: 'e1', titulo: 'Avaliação — Maria', ocupa: true, inicio: epochLocal(SEGUNDA, '10:00', FUSO), fim: epochLocal(SEGUNDA, '10:30', FUSO), privado: { whatsapp: '5511977776666', marcadoPor: 'Ana' } })
    const d = (await (await app.request(`${caminho}/api/semana?inicio=${SEGUNDA}`)).json()) as { inicio: string; dias: Array<{ data: string; slots: Array<{ hhmm: string; estado: string; ocupantes: Array<{ cliente: string; whatsapp?: string; marcadoPor: string }> }> }> }
    assert.equal(d.inicio, SEGUNDA)
    assert.equal(d.dias.length, 5)
    const slot = d.dias[0]!.slots.find((s) => s.hhmm === '10:00')!
    assert.equal(slot.estado, 'ocupado')
    assert.deepEqual([slot.ocupantes[0]!.cliente, slot.ocupantes[0]!.whatsapp, slot.ocupantes[0]!.marcadoPor], ['Maria', '5511977776666', 'Ana'])
  })

  it('marcar, remarcar e desmarcar pelas rotas, com o registro de quem fez', async () => {
    const { app, google, store, caminho } = await pronto()
    const marcar = await app.request(`${caminho}/api/marcar`, post({ data: SEGUNDA, hhmm: '14:00', nome: 'João', whatsapp: '11977776666', obs: 'indicação', professor: 'Ana' }))
    assert.equal(marcar.status, 200)
    assert.match(((await marcar.json()) as { mensagem: string }).mensagem, /João marcada para Segunda-feira, 19\/10 às 14:00/)
    const id = google.criados[0]!.id

    const remarcar = await app.request(`${caminho}/api/remarcar`, post({ eventoId: id, data: SEGUNDA, hhmm: '15:00', professor: 'Bia' }))
    assert.equal(remarcar.status, 200)
    const corpo = (await remarcar.json()) as { mensagem: string; liberado: { data: string; hhmm: string } }
    assert.match(corpo.mensagem, /remarcada para Segunda-feira, 19\/10 às 15:00/)
    assert.deepEqual(corpo.liberado, { data: SEGUNDA, hhmm: '14:00' })

    const desmarcar = await app.request(`${caminho}/api/desmarcar`, post({ eventoId: id, professor: 'Carlos' }))
    assert.equal(desmarcar.status, 200)
    assert.match(((await desmarcar.json()) as { mensagem: string }).mensagem, /voltou a ficar livre/)
    assert.equal(google.eventos.length, 0)

    assert.deepEqual(store.acoesAgenda().map((a) => `${a.professor}:${a.acao}`), ['Carlos:desmarcou', 'Bia:remarcou', 'Ana:marcou'])
  })

  it('erros chegam como texto para a tela, com o código certo', async () => {
    const { app, google, caminho } = await pronto()
    const casos: Array<[string, unknown, number, RegExp]> = [
      ['marcar', { data: '2026-10-24', hhmm: '10:00', nome: 'X', whatsapp: '11977776666', professor: 'Ana' }, 400, /Não há avaliações nesse dia/],
      ['marcar', { data: SEGUNDA, hhmm: '10:00', nome: '', whatsapp: '11977776666', professor: 'Ana' }, 400, /nome do cliente/],
      ['marcar', { data: SEGUNDA, hhmm: '10:00', nome: 'X', whatsapp: '123', professor: 'Ana' }, 400, /WhatsApp inválido/],
      ['desmarcar', { eventoId: 'nao-existe', professor: 'Ana' }, 404, /não existe mais/],
      ['remarcar', { eventoId: 'nao-existe', data: SEGUNDA, hhmm: '10:00', professor: 'Ana' }, 404, /não existe mais/],
    ]
    for (const [rota, corpo, status, regex] of casos) {
      const r = await app.request(`${caminho}/api/${rota}`, post(corpo))
      assert.equal(r.status, status, `${rota} ${JSON.stringify(corpo)}`)
      assert.match(((await r.json()) as { erro: string }).erro, regex)
    }
    assert.equal(google.criados.length, 0)
  })

  it('SEGURANÇA: professor fora da lista (ou em branco) não marca nada', async () => {
    const { app, google, store, caminho } = await pronto()
    for (const professor of ['', 'Fulano', 'Ana ', undefined, 123]) {
      const r = await app.request(`${caminho}/api/marcar`, post({ data: SEGUNDA, hhmm: '10:00', nome: 'X', whatsapp: '11977776666', professor }))
      assert.equal(r.status, professor === 'Ana ' ? 200 : 400, String(professor)) // "Ana " só por causa do espaço, que é aparado
      if (r.status === 400) assert.match(((await r.json()) as { erro: string }).erro, /Escolha o seu nome/)
    }
    assert.equal(google.criados.length, 1, 'só o nome válido passou')
    assert.equal(store.acoesAgenda()[0]!.professor, 'Ana')
  })

  it('SEGURANÇA: com o código errado, as rotas somem (404), mesmo com dados válidos', async () => {
    const { app, google, caminho } = await pronto()
    const errado = caminho.slice(0, -1) + (caminho.endsWith('a') ? 'b' : 'a')
    assert.equal((await app.request(errado)).status, 404)
    assert.equal((await app.request(`${errado}/api/semana`)).status, 404)
    const r = await app.request(`${errado}/api/marcar`, post({ data: SEGUNDA, hhmm: '10:00', nome: 'X', whatsapp: '11977776666', professor: 'Ana' }))
    assert.equal(r.status, 404)
    assert.equal(google.criados.length, 0)
  })

  it('SEGURANÇA: o endereço da agenda não dá acesso ao resto do painel', async () => {
    const { app, caminho } = await pronto()
    const codigo = caminho.split('/').pop()!
    assert.equal((await app.request(`/admin/handoffs?token=${codigo}`)).status, 401)
    assert.equal((await app.request(`/admin/agenda?token=${codigo}`)).status, 401)
    assert.equal((await app.request(`/conectar?token=${codigo}`)).status, 401)
  })

  it('o dono vê o registro das ações em /admin/agenda', async () => {
    const { app, caminho } = await pronto()
    await app.request(`${caminho}/api/marcar`, post({ data: SEGUNDA, hhmm: '09:00', nome: 'Maria', whatsapp: '11977776666', professor: 'Bia' }))
    const d = (await (await app.request('/admin/agenda', { headers: admin })).json()) as { ligada: boolean; caminho: string; acoes: Array<{ professor: string; acao: string; cliente: string; ts: number }> }
    assert.equal(d.ligada, true)
    assert.equal(d.caminho, caminho)
    assert.deepEqual([d.acoes[0]!.professor, d.acoes[0]!.acao, d.acoes[0]!.cliente], ['Bia', 'marcou', 'Maria'])
    assert.ok(d.acoes[0]!.ts > 0)
  })

  it('o bot continua funcionando igual com a agenda ligada', async () => {
    const { app, caminho, store } = await pronto()
    await app.request(`${caminho}/api/marcar`, post({ data: SEGUNDA, hhmm: '10:00', nome: 'Maria', whatsapp: '11977776666', professor: 'Ana' }))
    const saude = (await (await app.request('/health')).json()) as { ok: boolean; agenda: string; whatsapp: string }
    assert.deepEqual([saude.ok, saude.agenda, saude.whatsapp], [true, 'google', 'qr'])
    assert.equal(store.agendamentoAtivo('5511977776666', AGORA.getTime())!.inicio, epochLocal(SEGUNDA, '10:00', FUSO))
  })
})
