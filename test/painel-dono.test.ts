import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { criarApp, type AppDeps } from '../src/app.js'
import { epochLocal } from '../src/agenda.js'
import type { EstadoWhatsapp } from '../src/baileys.js'
import { FilaPorChave } from '../src/fila.js'
import { ABAS, abaValida } from '../src/painel-dono.js'
import type { ClienteWhatsapp } from '../src/whatsapp.js'
import { AGORA, GoogleFalso, criarDepsDeAgente } from './helpers.js'

const FUSO = 'America/Sao_Paulo'
const T = 'token=segredo-admin'
const CONECTADO: EstadoWhatsapp = { status: 'conectado', numero: '5511900000000', desde: AGORA.getTime() }
const MIN = 60_000

function montar(estado: EstadoWhatsapp = CONECTADO, extra: Record<string, string> = {}) {
  const google = new GoogleFalso()
  const base = criarDepsDeAgente([], { ADMIN_TOKEN: 'segredo-admin', AGENDA_PROFESSORES: 'Ana, Bia', WHATSAPP_MODO: 'qr', ...extra }, { google })
  const wa: ClienteWhatsapp = { async enviarTexto() {}, async marcarLida() {} }
  const deps: AppDeps = { ...base.deps, wa, avisarErro: async () => {}, fila: new FilaPorChave(), whatsappEstado: () => estado, iniciadoEm: Date.now() }
  return { app: criarApp(deps), google, store: base.store }
}

type App = ReturnType<typeof montar>['app']
const pagina = async (app: App, aba = '', extra = '') => (await app.request(`/conectar?${T}${aba ? `&aba=${aba}` : ''}${extra}`)).text()
const form = (corpo: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(corpo).toString() })
const json = (corpo: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) })

function aval(google: GoogleFalso, data: string, hhmm: string, cliente: string, privado?: Record<string, string>): string {
  const inicio = epochLocal(data, hhmm, FUSO)
  const id = `ev-${data}-${hhmm}`
  google.eventos.push({ id, titulo: `Avaliação — ${cliente}`, ocupa: true, inicio, fim: inicio + 30 * MIN, ...(privado ? { privado } : {}) })
  return id
}

describe('painel em abas: acesso e navegação', () => {
  it('as 6 abas existem e só o dono (com o token) entra', async () => {
    const { app } = montar()
    assert.deepEqual([...ABAS], ['hoje', 'avaliacoes', 'vendas', 'conversas', 'bot', 'testar'])
    for (const aba of ABAS) {
      assert.equal((await app.request(`/conectar?aba=${aba}`)).status, 401, aba)
      assert.equal((await app.request(`/conectar?token=errado&aba=${aba}`)).status, 401, aba)
      const res = await app.request(`/conectar?${T}&aba=${aba}`)
      assert.equal(res.status, 200, aba)
      assert.match(res.headers.get('cache-control') ?? '', /no-store/)
    }
  })

  it('a barra de abas aparece em todas e marca a atual', async () => {
    const { app } = montar()
    const html = await pagina(app, 'vendas')
    for (const rotulo of ['Hoje', 'Avaliações', 'Vendas', 'Conversas', 'Bot', 'Testar']) assert.ok(html.includes(rotulo), rotulo)
    assert.match(html, /class="atual" href="\/conectar\?token=segredo-admin&amp;aba=vendas" aria-current="page"/)
  })

  it('sem aba: conectado abre o Hoje; desconectado abre o Bot (onde está o QR)', async () => {
    const conectado = await pagina(montar().app)
    assert.match(conectado, /Avaliações de hoje/)
    const desconectado = await pagina(montar({ status: 'aguardando_qr', desde: Date.now() }).app)
    assert.match(desconectado, /Saúde do bot/)
    assert.match(desconectado, /http-equiv="refresh"/)
    assert.match(desconectado, /aba=bot/)
  })

  it('aba inventada cai na aba padrão e não entra no HTML', async () => {
    assert.equal(abaValida('hoje'), 'hoje')
    assert.equal(abaValida('<script>'), undefined)
    const html = await pagina(montar().app, '', '&aba=%3Cscript%3Ealert(1)%3C/script%3E')
    assert.doesNotMatch(html, /<script>alert/)
    assert.match(html, /Avaliações de hoje/)
  })

  it('só recarrega sozinha quando falta conectar e a pessoa olha a aba do QR', async () => {
    const app = montar({ status: 'aguardando_qr', desde: Date.now() }).app
    assert.match(await pagina(app, 'bot'), /http-equiv="refresh"/)
    assert.doesNotMatch(await pagina(app, 'vendas'), /http-equiv="refresh"/)
    assert.doesNotMatch(await pagina(montar().app, 'bot'), /http-equiv="refresh"/)
  })

  it('mostra o aviso do resultado da última ação, escapado', async () => {
    const html = await pagina(montar().app, 'hoje', '&aviso=%3Cb%3Eoi%3C/b%3E')
    assert.match(html, /<div class="banner" role="status">&lt;b&gt;oi&lt;\/b&gt;<\/div>/)
  })

  it('a aba Testar traz o teste do bot dentro da página', async () => {
    const html = await pagina(montar().app, 'testar')
    assert.match(html, /<iframe class="moldura" src="\/teste\?token=segredo-admin"/)
    assert.match(html, /href="\/teste\?token=segredo-admin"/)
  })
})

describe('aba Hoje', () => {
  it('lista as avaliações de hoje de TODAS as origens, com a origem de cada uma', async () => {
    const t = montar()
    aval(t.google, '2026-10-16', '10:00', 'Ana', { origem: 'assistente-whatsapp', whatsapp: '5511977776666' })
    aval(t.google, '2026-10-16', '08:00', 'Bia', { origem: 'painel-professores', marcadoPor: 'Recepção (lista)' })
    aval(t.google, '2026-10-16', '14:00', 'Caio')
    aval(t.google, '2026-10-19', '10:00', 'Amanhã')
    const html = await pagina(t.app, 'hoje')
    assert.match(html, /Avaliações de hoje \(3\)/)
    assert.ok(html.indexOf('Bia') < html.indexOf('Ana') && html.indexOf('Ana') < html.indexOf('Caio'), 'em ordem de horário')
    assert.match(html, /Assistente \(WhatsApp\)/)
    assert.match(html, /Recepção \(lista\)/, 'não aparece como página dos professores')
    assert.match(html, /Direto na agenda do Google/)
    assert.match(html, /wa\.me\/5511977776666/)
    assert.doesNotMatch(html, /Amanhã/)
    assert.doesNotMatch(html, /marcou: (Recepção|Assistente)/, 'a origem já diz quem marcou: sem repetir')
  })

  it('o nome do cliente é escapado', async () => {
    const t = montar()
    aval(t.google, '2026-10-16', '10:00', '<img src=x onerror=alert(1)>')
    const html = await pagina(t.app, 'hoje')
    assert.doesNotMatch(html, /<img src=x/)
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  })

  it('só as que já começaram têm os botões "Veio / Faltou / Matriculou"', async () => {
    const t = montar()
    aval(t.google, '2026-10-16', '08:00', 'Passada')
    aval(t.google, '2026-10-16', '10:00', 'Futura')
    const html = await pagina(t.app, 'hoje')
    assert.equal((html.match(/Veio\?/g) ?? []).length, 1)
    assert.match(html, /name="eventoId" value="ev-2026-10-16-08:00"/)
    assert.doesNotMatch(html, /name="eventoId" value="ev-2026-10-16-10:00"/)
  })

  it('sem nada urgente, diz que está tudo em ordem; com cliente esperando a equipe, avisa', async () => {
    const t = montar()
    assert.match(await pagina(t.app, 'hoje'), /Tudo em ordem/)
    t.store.definirHandoff('5511900000001', 1, 'quer cancelar', AGORA.getTime() - 40 * MIN)
    const html = await pagina(t.app, 'hoje')
    assert.match(html, /esperando a equipe há mais de 15 min/)
    assert.doesNotMatch(html, /Tudo em ordem/)
  })

  it('Google desligado: avisa em vez de mostrar zeros sem explicar', async () => {
    const base = criarDepsDeAgente([], { ADMIN_TOKEN: 'segredo-admin', WHATSAPP_MODO: 'qr' })
    const wa: ClienteWhatsapp = { async enviarTexto() {}, async marcarLida() {} }
    const app = criarApp({ ...base.deps, wa, avisarErro: async () => {}, fila: new FilaPorChave(), whatsappEstado: () => CONECTADO, iniciadoEm: Date.now() })
    assert.match(await pagina(app, 'hoje'), /agenda do Google não está ligada/)
  })

  it('mostra o botão de pausar também na aba Hoje (o controle mais importante fica à mão)', async () => {
    assert.match(await pagina(montar().app, 'hoje'), /Pausar 1 hora/)
  })
})

describe('anotar quem veio, faltou ou matriculou', () => {
  it('o botão anota, volta para a mesma aba com a confirmação e o número aparece nas Avaliações', async () => {
    const t = montar()
    const id = aval(t.google, '2026-10-16', '08:00', 'Bia')
    const res = await t.app.request(`/admin/comparecimento?${T}`, form({ eventoId: id, status: 'veio', voltar: 'conectar', aba: 'hoje' }))
    assert.equal(res.status, 303)
    const destino = res.headers.get('location')!
    assert.match(destino, /^\/conectar\?token=segredo-admin&aba=hoje&aviso=/)
    assert.match(decodeURIComponent(destino), /Bia veio à avaliação\. Anotado!/)
    assert.equal(t.store.comparecimentoDe([id]).get(id)!.status, 'veio')
    assert.equal(t.store.comparecimentoDe([id]).get(id)!.por, 'Painel do dono')

    const hoje = await pagina(t.app, 'hoje')
    assert.match(hoje, /✅ Veio/)
    assert.doesNotMatch(hoje, /Veio\?/, 'depois de anotar, somem os três botões')
    assert.match(hoje, /value="limpar"/)
    assert.match(await pagina(t.app, 'avaliacoes'), /vieram/)
  })

  it('trocar a resposta e desfazer', async () => {
    const t = montar()
    const id = aval(t.google, '2026-10-16', '08:00', 'Bia')
    await t.app.request(`/admin/comparecimento?${T}`, form({ eventoId: id, status: 'faltou' }))
    await t.app.request(`/admin/comparecimento?${T}`, form({ eventoId: id, status: 'matriculou' }))
    assert.equal(t.store.comparecimentoDe([id]).get(id)!.status, 'matriculou')
    const r = await t.app.request(`/admin/comparecimento?${T}`, form({ eventoId: id, status: 'limpar' }))
    assert.equal(r.status, 200)
    assert.equal(t.store.comparecimentoDe([id]).size, 0)
  })

  it('avaliação que ainda não aconteceu não pode ser marcada', async () => {
    const t = montar()
    const id = aval(t.google, '2026-10-16', '10:00', 'Futura')
    const r = await t.app.request(`/admin/comparecimento?${T}`, json({ eventoId: id, status: 'veio' }))
    assert.equal(r.status, 400)
    assert.match(((await r.json()) as { erro: string }).erro, /ainda não aconteceu/)
    assert.equal(t.store.comparecimentoDe([id]).size, 0)
  })

  it('só avaliações: outro evento da agenda é recusado, e evento que não existe também', async () => {
    const t = montar()
    const inicio = epochLocal('2026-10-16', '08:00', FUSO)
    t.google.eventos.push({ id: 'reuniao', titulo: 'Reunião', ocupa: true, inicio, fim: inicio + 30 * MIN })
    assert.equal((await t.app.request(`/admin/comparecimento?${T}`, json({ eventoId: 'reuniao', status: 'veio' }))).status, 403)
    assert.equal((await t.app.request(`/admin/comparecimento?${T}`, json({ eventoId: 'nao-existe', status: 'veio' }))).status, 404)
    assert.equal(t.store.comparecimentos(0).length, 0)
  })

  it('pelo formulário, o erro volta como aviso na tela (não como JSON cru)', async () => {
    const t = montar()
    const id = aval(t.google, '2026-10-16', '10:00', 'Futura')
    const res = await t.app.request(`/admin/comparecimento?${T}`, form({ eventoId: id, status: 'veio', voltar: 'conectar', aba: 'avaliacoes' }))
    assert.equal(res.status, 303)
    assert.match(decodeURIComponent(res.headers.get('location')!), /aba=avaliacoes&aviso=Essa avaliação ainda não aconteceu/)
  })

  it('SEGURANÇA e dados ruins', async () => {
    const t = montar()
    const id = aval(t.google, '2026-10-16', '08:00', 'Bia')
    assert.equal((await t.app.request('/admin/comparecimento', json({ eventoId: id, status: 'veio' }))).status, 401)
    assert.equal((await t.app.request('/admin/comparecimento?token=errado', json({ eventoId: id, status: 'veio' }))).status, 401)
    assert.equal((await t.app.request(`/admin/comparecimento?${T}`, json({ eventoId: id, status: 'talvez' }))).status, 400)
    assert.equal((await t.app.request(`/admin/comparecimento?${T}`, json({ status: 'veio' }))).status, 400)
    assert.equal(t.store.comparecimentos(0).length, 0)
  })

  it('as taxas aparecem na aba Avaliações', async () => {
    const t = montar()
    for (const [hhmm, status] of [['07:00', 'veio'], ['07:30', 'faltou'], ['08:00', 'matriculou']] as const) {
      const id = aval(t.google, '2026-10-16', hhmm, `C${hhmm}`)
      await t.app.request(`/admin/comparecimento?${T}`, json({ eventoId: id, status }))
    }
    const html = await pagina(t.app, 'avaliacoes')
    assert.match(html, /<b>33%<\/b><span>de faltas<\/span>/)
    assert.match(html, /<b>50%<\/b><span>de quem veio matriculou<\/span>/)
  })
})

describe('aba Avaliações', () => {
  it('totais do mês, por origem, ocupação e próximas', async () => {
    const t = montar()
    aval(t.google, '2026-10-16', '10:00', 'Ana', { origem: 'assistente-whatsapp' })
    aval(t.google, '2026-10-12', '10:00', 'Caio', { origem: 'painel-professores', marcadoPor: 'Prof. João' })
    aval(t.google, '2026-10-19', '10:00', 'Edu')
    const html = await pagina(t.app, 'avaliacoes')
    assert.match(html, /Avaliações em outubro de 2026/)
    assert.match(html, /<b>3<\/b><span>no mês<\/span>/)
    assert.match(html, /<b>2<\/b><span>ainda por vir<\/span>/)
    assert.match(html, /Quem marcou/)
    assert.match(html, /Página dos professores/)
    assert.match(html, /Próximas avaliações \(2\)/)
    assert.match(html, /<b>2<\/b> de <b>196<\/b> horários estão ocupados/)
    assert.match(html, /TODAS as avaliações da agenda do Google/)
  })

  it('mantém o cartão da agenda dos professores', async () => {
    assert.match(await pagina(montar().app, 'avaliacoes'), /Gerar o link da agenda/)
  })
})

describe('aba Vendas: matrículas para lançar', () => {
  const m = { chat: '5511977776666', nome: 'Maria Silva', telefone: '5511977776666', email: '', nascimento: '', plano: 'Anual VIP', pagamento: 'pix' as const, observacao: '' }

  it('pendente tem o botão; lançada vai para "Já lançadas" e dá para desfazer', async () => {
    const t = montar()
    const id = t.store.registrarMatricula(m)
    let html = await pagina(t.app, 'vendas')
    assert.match(html, /Para lançar \(1\)/)
    assert.match(html, /Já lancei na plataforma/)
    assert.match(html, /<span class="conta">1<\/span>/, 'a aba Vendas mostra quantas faltam')

    const res = await t.app.request(`/admin/matricula-lancada?${T}`, form({ id: String(id), lancada: '1', voltar: 'conectar', aba: 'vendas' }))
    assert.equal(res.status, 303)
    assert.equal(res.headers.get('location'), '/conectar?token=segredo-admin&aba=vendas')
    assert.notEqual(t.store.matriculas()[0]!.lancadaEm, null)

    html = await pagina(t.app, 'vendas')
    assert.match(html, /Tudo lançado/)
    assert.match(html, /Já lançadas \(1\)/)
    assert.doesNotMatch(html, /<span class="conta">/)

    await t.app.request(`/admin/matricula-lancada?${T}`, form({ id: String(id), lancada: '0' }))
    assert.equal(t.store.matriculas()[0]!.lancadaEm, null)
  })

  it('id estranho, matrícula inexistente e acesso sem token', async () => {
    const t = montar()
    assert.equal((await t.app.request(`/admin/matricula-lancada?${T}`, json({ id: 'abc', lancada: '1' }))).status, 400)
    assert.equal((await t.app.request(`/admin/matricula-lancada?${T}`, json({ id: 999, lancada: '1' }))).status, 404)
    const res = await t.app.request(`/admin/matricula-lancada?${T}`, form({ id: '999', lancada: '1', voltar: 'conectar', aba: 'vendas' }))
    assert.match(decodeURIComponent(res.headers.get('location')!), /Essa matrícula não existe mais/)
    t.store.registrarMatricula(m)
    assert.equal((await t.app.request('/admin/matricula-lancada', json({ id: 1, lancada: '1' }))).status, 401)
    assert.equal((await t.app.request('/admin/matricula-lancada?token=errado', json({ id: 1, lancada: '1' }))).status, 401)
    assert.equal(t.store.matriculas()[0]!.lancadaEm, null)
  })

  it('o funil explica que só conta o que fechou pelo WhatsApp', async () => {
    const html = await pagina(montar().app, 'vendas')
    assert.match(html, /Funil de outubro de 2026/)
    assert.match(html, /só entram aqui as matrículas que o cliente fechou pela conversa/)
  })
})

describe('aba Conversas e aba Bot', () => {
  it('espera da equipe, o que o bot não soube responder e horários de pico', async () => {
    const t = montar()
    const agora = AGORA.getTime()
    t.store.definirHandoff('5511900000001', 100_000, 'quer cancelar', agora - 20 * MIN) // dura muito: a página usa o relógio real
    t.store.registrarEvento('sem_resposta', 'a', 'Tem sauna?', agora - 1000)
    t.store.registrarEvento('sem_resposta', 'b', 'tem sauna?', agora - 500)
    t.store.adicionarMensagem('a', 'user', 'oi', agora)
    const html = await pagina(t.app, 'conversas')
    assert.match(html, /Esperando a equipe \(1\)/)
    assert.match(html, /20 min/)
    assert.match(html, /“tem sauna\?”<\/div><div class="acoes"><span class="status veio">2×/, 'perguntas iguais são agrupadas')
    assert.match(html, /<span class="r">09h<\/span>/)
    assert.match(html, /Devolver ao bot/)
  })

  it('bot: custo, saúde, monitor e pausa', async () => {
    const t = montar(CONECTADO, { GASTO_LIMITE_MENSAL: '10', DOLAR_EM_REAIS: '5' })
    t.store.registrarUsoIa({ modelo: 'm', entrada: 10_000_000, saida: 0, cacheLeitura: 0, cacheEscrita: 0 }, AGORA.getTime())
    const html = await pagina(t.app, 'bot')
    assert.match(html, /Gasto estimado com a IA/)
    assert.match(html, /R\$ 5,00/)
    assert.match(html, /você está em <b>50%<\/b>/)
    assert.match(html, /Saúde do bot/)
    assert.match(html, /Aviso se o WhatsApp cair/)
    assert.match(html, /Assistente ATIVO/)
  })

  it('gasto em 80% ou mais vira alerta na aba Hoje', async () => {
    const t = montar(CONECTADO, { GASTO_LIMITE_MENSAL: '10', DOLAR_EM_REAIS: '5' })
    t.store.registrarUsoIa({ modelo: 'm', entrada: 16_000_000, saida: 0, cacheLeitura: 0, cacheEscrita: 0 }, AGORA.getTime())
    assert.match(await pagina(t.app, 'hoje'), /Gasto da IA em 80% do limite do mês/)
  })
})
