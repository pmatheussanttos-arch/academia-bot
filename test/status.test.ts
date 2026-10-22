import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { EstadoWhatsapp } from '../src/baileys.js'
import { criarApp, type AppDeps } from '../src/app.js'
import { carregarConfig } from '../src/config.js'
import { FilaPorChave } from '../src/fila.js'
import { TOLERANCIA_PADRAO_MIN, calcularStatus } from '../src/status.js'
import type { ClienteWhatsapp } from '../src/whatsapp.js'
import { criarDepsDeAgente } from './helpers.js'

const AGORA = 1_800_000_000_000
const MIN = 60_000
const estado = (e: Partial<EstadoWhatsapp>): EstadoWhatsapp => ({ status: 'conectado', desde: AGORA, ...e })

describe('quando avisar que o WhatsApp caiu', () => {
  it('conectado: tudo certo, sem alarme', () => {
    const s = calcularStatus(estado({ status: 'conectado', numero: '5511999998888' }), AGORA)
    assert.equal(s.ok, true)
    assert.equal(s.minutosForaDoAr, 0)
    assert.match(s.mensagem, /conectado \(\+5511999998888\)/)
    assert.equal(s.acao, undefined)
  })

  it('queda curta e reinício NÃO alarmam (senão o aviso vira barulho e ninguém olha)', () => {
    for (const status of ['iniciando', 'desconectado', 'aguardando_qr'] as const) {
      const s = calcularStatus(estado({ status, foraDoArDesde: AGORA - 4 * MIN }), AGORA)
      assert.equal(s.ok, true, status)
      assert.equal(s.minutosForaDoAr, 4)
    }
  })

  it('passou da tolerância: alarme, dizendo há quanto tempo e o que fazer', () => {
    const s = calcularStatus(estado({ status: 'aguardando_qr', foraDoArDesde: AGORA - 20 * MIN }), AGORA)
    assert.equal(s.ok, false)
    assert.equal(s.minutosForaDoAr, 20)
    assert.match(s.mensagem, /DESCONECTADO há 20 min: precisa escanear o QR code de novo/)
    assert.match(s.acao!, /escaneie o QR code com o celular da academia/)
  })

  it('reconectando há muito tempo também alarma, com o motivo do log', () => {
    const s = calcularStatus(estado({ status: 'desconectado', detalhe: 'Reconectando em 30s…', foraDoArDesde: AGORA - 11 * MIN }), AGORA)
    assert.equal(s.ok, false)
    assert.match(s.mensagem, /fora do ar há 11 min \(Reconectando em 30s…\)/)
    assert.match(s.acao!, /Logs/)
  })

  it('a tolerância é configurável e o padrão são 5 minutos', () => {
    assert.equal(TOLERANCIA_PADRAO_MIN, 5)
    const fora = estado({ status: 'aguardando_qr', foraDoArDesde: AGORA - 6 * MIN })
    assert.equal(calcularStatus(fora, AGORA).ok, false, '6 min com o padrão: alarme')
    assert.equal(calcularStatus(fora, AGORA, 30).ok, true, 'com 30 min de tolerância: ainda não')
    assert.equal(calcularStatus(estado({ status: 'aguardando_qr', foraDoArDesde: AGORA - 31 * MIN }), AGORA, 30).ok, false)
    assert.equal(carregarConfig({ STATUS_TOLERANCIA_MIN: '15' }).toleranciaQuedaMin, 15)
    assert.equal(carregarConfig({}).toleranciaQuedaMin, 5)
    assert.equal(carregarConfig({ STATUS_TOLERANCIA_MIN: 'abc' }).toleranciaQuedaMin, 5)
  })

  it('no modo oficial da Meta a verificação não se aplica (nunca alarma)', () => {
    const s = calcularStatus(undefined, AGORA)
    assert.equal(s.ok, true)
    assert.equal(s.estado, 'cloud')
    assert.match(s.mensagem, /não se aplica/)
  })

  it('sem saber desde quando caiu, não inventa tempo nem alarma', () => {
    const s = calcularStatus(estado({ status: 'desconectado', foraDoArDesde: undefined }), AGORA)
    assert.equal(s.minutosForaDoAr, 0)
    assert.equal(s.ok, true)
  })
})

describe('página de status para o monitor externo', () => {
  function app(e: EstadoWhatsapp | undefined, extra: Record<string, string> = {}) {
    const base = criarDepsDeAgente([], { WHATSAPP_MODO: 'qr', ADMIN_TOKEN: 'segredo-admin', ...extra })
    const wa: ClienteWhatsapp = { async enviarTexto() {}, async marcarLida() {} }
    const deps: AppDeps = { ...base.deps, wa, avisarErro: async () => {}, fila: new FilaPorChave(), ...(e ? { whatsappEstado: () => e } : {}), iniciadoEm: Date.now() }
    return criarApp(deps)
  }
  const agora = () => Date.now()

  it('conectado: responde 200, que o monitor entende como "tudo certo"', async () => {
    const r = await app(estado({ status: 'conectado' })).request('/status/whatsapp')
    assert.equal(r.status, 200)
    const d = (await r.json()) as { ok: boolean; estado: string }
    assert.deepEqual([d.ok, d.estado], [true, 'conectado'])
    assert.match(r.headers.get('cache-control') ?? '', /no-store/, 'o monitor nunca pode ler uma resposta velha')
  })

  it('fora do ar há muito tempo: responde 503, que dispara o e-mail', async () => {
    const r = await app({ status: 'aguardando_qr', desde: agora(), foraDoArDesde: agora() - 30 * MIN }).request('/status/whatsapp')
    assert.equal(r.status, 503)
    const d = (await r.json()) as { ok: boolean; minutos_fora_do_ar: number; mensagem: string; acao: string }
    assert.equal(d.ok, false)
    assert.ok(d.minutos_fora_do_ar >= 29)
    assert.match(d.mensagem, /DESCONECTADO/)
    assert.match(d.acao, /QR code/)
  })

  it('queda curta: ainda 200, para não acordar ninguém à toa', async () => {
    const r = await app({ status: 'desconectado', desde: agora(), foraDoArDesde: agora() - 2 * MIN }).request('/status/whatsapp')
    assert.equal(r.status, 200)
  })

  it('é público de propósito (o monitor não manda senha) e não expõe mais nada', async () => {
    const r = await app({ status: 'aguardando_qr', desde: agora(), foraDoArDesde: agora() - 30 * MIN, qr: 'SEGREDO-DO-QR', numero: '5511999998888' }).request('/status/whatsapp')
    const texto = await r.text()
    assert.doesNotMatch(texto, /SEGREDO-DO-QR/, 'o QR nunca pode vazar: quem o lê assume o WhatsApp')
    assert.match(r.headers.get('x-robots-tag') ?? '', /noindex/)
  })

  it('NÃO mexe no /health, que a Render usa para decidir reiniciar o serviço', async () => {
    const a = app({ status: 'aguardando_qr', desde: agora(), foraDoArDesde: agora() - 60 * MIN })
    assert.equal((await a.request('/status/whatsapp')).status, 503)
    const saude = await a.request('/health')
    assert.equal(saude.status, 200, 'o /health continua 200, senão a Render reiniciaria sem parar e o QR nunca seria lido')
    assert.equal(((await saude.json()) as { whatsapp_status: string }).whatsapp_status, 'aguardando_qr')
  })

  it('modo oficial da Meta: 200 e explicação', async () => {
    const r = await app(undefined, { WHATSAPP_MODO: 'cloud' }).request('/status/whatsapp')
    assert.equal(r.status, 200)
    assert.equal(((await r.json()) as { estado: string }).estado, 'cloud')
  })

  it('a página de conexão mostra o endereço pronto para copiar', async () => {
    const html = await (await app(estado({ status: 'conectado' })).request('http://meu-bot.onrender.com/conectar?token=segredo-admin&aba=bot')).text()
    assert.match(html, /Aviso se o WhatsApp cair/)
    assert.match(html, /value="http:\/\/meu-bot\.onrender\.com\/status\/whatsapp"/)
    assert.match(html, /mais de 5 minutos/)
  })
})

describe('relógio da queda no driver do WhatsApp', () => {
  async function driver() {
    const { DriverBaileys } = await import('../src/baileys.js')
    return new DriverBaileys({ dataDir: '/tmp/nao-usado' })
  }
  const mudar = (d: unknown, p: Record<string, unknown>) => (d as { mudarEstado: (p: unknown) => void }).mudarEstado(p)
  const ler = (d: unknown) => (d as { estado: () => EstadoWhatsapp }).estado()

  it('começa contando desde a partida (ainda não conectou)', async () => {
    const e = ler(await driver())
    assert.equal(e.status, 'iniciando')
    assert.ok(e.foraDoArDesde !== undefined && e.foraDoArDesde > 0)
  })

  it('UM QR NOVO NÃO REINICIA A CONTAGEM (senão o aviso nunca dispararia)', async () => {
    const d = await driver()
    // Finge que a queda começou há 10 minutos (sem isso, tudo aconteceria no mesmo milissegundo e o teste não provaria nada).
    const queda = Date.now() - 10 * MIN
    ;(d as unknown as { estadoAtual: EstadoWhatsapp }).estadoAtual.foraDoArDesde = queda
    assert.equal(calcularStatus(ler(d), Date.now()).ok, false, 'com 10 min fora do ar, já é alarme')

    for (let i = 0; i < 5; i++) mudar(d, { status: 'aguardando_qr', qr: `codigo-${i}` })

    assert.equal(ler(d).foraDoArDesde, queda, 'o relógio da queda continua nos 10 minutos')
    assert.ok(ler(d).desde > queda, 'só o "desde" acompanha o último QR')
    const s = calcularStatus(ler(d), Date.now())
    assert.equal(s.ok, false, 'o alarme continua de pé depois de 5 QR codes novos')
    assert.ok(s.minutosForaDoAr >= 10)
  })

  it('conectar zera o relógio; cair de novo começa uma contagem nova', async () => {
    const d = await driver()
    mudar(d, { status: 'aguardando_qr', qr: 'x' })
    mudar(d, { status: 'conectado', numero: '5511999998888' })
    assert.equal(ler(d).foraDoArDesde, undefined, 'conectado = sem queda em andamento')
    assert.equal(calcularStatus(ler(d), Date.now()).ok, true)

    const antes = Date.now()
    mudar(d, { status: 'desconectado', detalhe: 'Reconectando em 2s…' })
    const depois = ler(d).foraDoArDesde!
    assert.ok(depois >= antes, 'a nova queda conta a partir de agora, não da queda antiga')
  })

  it('reconectar depois de uma queda longa limpa o alarme', async () => {
    const d = await driver()
    mudar(d, { status: 'desconectado' })
    ;(d as unknown as { estadoAtual: EstadoWhatsapp }).estadoAtual.foraDoArDesde = Date.now() - 60 * MIN
    assert.equal(calcularStatus(ler(d), Date.now()).ok, false)
    mudar(d, { status: 'conectado', numero: '5511999998888' })
    assert.equal(calcularStatus(ler(d), Date.now()).ok, true)
  })
})
