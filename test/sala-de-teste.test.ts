import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { criarApp, type AppDeps } from '../src/app.js'
import { FilaPorChave } from '../src/fila.js'
import { MARCA_NOVA_MENSAGEM } from '../src/atendimento.js'
import { SalaDeTeste } from '../src/sala-de-teste.js'
import { AgendaSimulada } from '../src/agenda-simulada.js'
import { epochLocal } from '../src/agenda.js'
import type { ClienteWhatsapp } from '../src/whatsapp.js'
import { AGORA, SEGUNDA, chamarHumano, claudeFalso, criarConfigDeTeste, criarDepsDeAgente, texto, usarFerramenta } from './helpers.js'

const FUSO = 'America/Sao_Paulo'
const MATRICULA = { nome: 'Maria Silva Souza', telefone: '(11) 97777-6666', email: 'maria@email.com', nascimento: '25/03/1990', plano: 'Anual VIP', pagamento: 'pix', observacao: '' }

function sala(respostas: Parameters<typeof claudeFalso>[0], extra: Record<string, string> = {}) {
  const cfg = criarConfigDeTeste(extra)
  const { claude, chamadas } = claudeFalso(respostas)
  return { sala: new SalaDeTeste(cfg, claude, () => AGORA.getTime()), chamadas, cfg }
}

describe('conversa de teste sem WhatsApp', () => {
  it('o cliente de teste escreve e recebe a resposta, como no WhatsApp', async () => {
    const t = sala([texto('Olá! Eu sou o GFIT 😊 Qual o seu nome?')])
    const r = await t.sala.enviar('sessao-aaaa', 'Oi, quero saber dos planos')
    assert.deepEqual(r.mensagens, ['Olá! Eu sou o GFIT 😊 Qual o seu nome?'])
    assert.equal(r.emSilencio, false)
    assert.deepEqual([r.matriculas, r.avaliacoesAgendadas], [0, 0])
  })

  it('a marca [[nova mensagem]] vira duas mensagens, igual ao WhatsApp de verdade', async () => {
    const t = sala([texto(`O 3x fica R$ 89,90 por mês.\n${MARCA_NOVA_MENSAGEM}\nQual é o seu objetivo?`)])
    const r = await t.sala.enviar('sessao-aaaa', '3x por semana')
    assert.deepEqual(r.mensagens, ['O 3x fica R$ 89,90 por mês.', 'Qual é o seu objetivo?'])
  })

  it('lembra da conversa entre as mensagens (o modelo recebe o histórico)', async () => {
    const t = sala([texto('Qual o seu nome?'), texto('Prazer, Ana!')])
    await t.sala.enviar('sessao-aaaa', 'Oi')
    await t.sala.enviar('sessao-aaaa', 'Ana')
    const historico = JSON.stringify(t.chamadas[1]!.messages)
    assert.match(historico, /Oi/)
    assert.match(historico, /Qual o seu nome\?/)
    assert.match(historico, /Ana/)
  })

  it('mostra nos bastidores o que a ferramenta fez', async () => {
    const t = sala([usarFerramenta('consultar_horarios', { tipo: 'avaliacao_fisica', data: SEGUNDA, periodo: 'manha' }), texto('Tenho 08:00, 09:00 e 10:00.')])
    const r = await t.sala.enviar('sessao-aaaa', 'Quero avaliação segunda de manhã')
    assert.equal(r.ferramentas.length, 1)
    assert.match(r.ferramentas[0]!, /consultar_horarios\(avaliacao_fisica, 2026-10-19, manha\) -> Horários/)
  })

  it('conversa passada para a equipe: o bot fica em silêncio e o aviso aparece nos bastidores', async () => {
    const t = sala([chamarHumano('Quer cancelar o plano'), texto('ok'), texto('não deveria sair')])
    const r1 = await t.sala.enviar('sessao-aaaa', 'quero cancelar')
    assert.equal(r1.emSilencio, true)
    assert.match(r1.avisos[0]!, /Cliente precisa de atendimento humano[\s\S]*Quer cancelar o plano/)
    const r2 = await t.sala.enviar('sessao-aaaa', 'alô?')
    assert.deepEqual(r2.mensagens, [], 'em silêncio, como no WhatsApp')
    assert.equal(t.chamadas.length, 2, 'a segunda mensagem nem chegou ao modelo')
  })

  it('matrícula completa: registra, mostra o aviso para a equipe e conta nos bastidores', async () => {
    const t = sala([usarFerramenta('registrar_matricula', MATRICULA), texto('ok')])
    const r = await t.sala.enviar('sessao-aaaa', 'quero fechar')
    assert.equal(r.matriculas, 1)
    assert.match(r.avisos[0]!, /MATRÍCULA PELO WHATSAPP[\s\S]*Maria Silva Souza/)
    assert.match(r.ferramentas[0]!, /registrar_matricula/)
  })

  it('avaliação "agendada" de verdade no fluxo, mas só na agenda simulada', async () => {
    const t = sala([
      usarFerramenta('solicitar_avaliacao', { tipo: 'avaliacao_fisica', nome: 'Beto', data: SEGUNDA, horario: '10:00', observacao: '', ja_e_aluno: false, plano_vip: false }),
      texto('ok'),
    ])
    const r = await t.sala.enviar('sessao-aaaa', 'segunda às 10h')
    assert.equal(r.avaliacoesAgendadas, 1)
    assert.match(r.ferramentas[0]!, /solicitar_avaliacao[\s\S]*AGENDADO/)
  })
})

describe('isolamento: o teste NUNCA toca no que é de verdade', () => {
  it('não usa o banco de verdade: matrícula, conversa e silêncio ficam só no teste', async () => {
    const real = criarDepsDeAgente([])
    const { claude } = claudeFalso([usarFerramenta('registrar_matricula', MATRICULA), texto('ok'), chamarHumano('x'), texto('ok')])
    const s = new SalaDeTeste(real.cfg, claude, () => AGORA.getTime())
    await s.enviar('sessao-aaaa', 'fechar')
    await s.enviar('sessao-aaaa', 'quero uma pessoa')
    assert.equal(real.store.matriculas().length, 0, 'a lista de matrículas de verdade continua vazia')
    assert.equal(real.store.handoffsAtivos().length, 0, 'nenhuma conversa de verdade foi silenciada')
    assert.equal(real.store.historico('5500000000000', 10).length, 0)
    assert.deepEqual(real.avisos, [], 'a equipe de verdade não recebeu aviso nenhum')
  })

  it('não avisa a equipe de verdade: o aviso fica preso na página', async () => {
    const real = criarDepsDeAgente([])
    const { claude } = claudeFalso([chamarHumano('teste'), texto('ok')])
    const s = new SalaDeTeste(real.cfg, claude, () => AGORA.getTime())
    const r = await s.enviar('sessao-aaaa', 'quero falar com alguém')
    assert.equal(r.avisos.length, 1)
    assert.equal(real.avisos.length, 0)
  })

  it('ignora o filtro de teste e a lista da equipe: o bot responde mesmo com NUMEROS_PERMITIDOS ligado', async () => {
    const t = sala([texto('Olá!')], { WHATSAPP_MODO: 'qr', NUMEROS_PERMITIDOS: '11999990000', NUMEROS_AVISOS: '11988887777' })
    const r = await t.sala.enviar('sessao-aaaa', 'Oi')
    assert.deepEqual(r.mensagens, ['Olá!'])
  })

  it('NUNCA fala com o Google de verdade, mesmo com a agenda configurada: zero chamadas de rede', async () => {
    // Configuração com Google "ligado" (credenciais falsas) e a rede vigiada: qualquer chamada falha o teste.
    const chaves = await import('node:crypto').then((c) => c.generateKeyPairSync('rsa', { modulusLength: 2048 }))
    const privateKey = chaves.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const t = sala(
      [usarFerramenta('solicitar_avaliacao', { tipo: 'avaliacao_fisica', nome: 'Beto', data: SEGUNDA, horario: '10:00', observacao: '', ja_e_aluno: false, plano_vip: false }), texto('ok')],
      { GOOGLE_CALENDAR_ID: 'agenda-de-verdade@group.calendar.google.com', GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'bot@projeto.iam.gserviceaccount.com', private_key: privateKey }) },
    )
    assert.ok(t.cfg.google, 'o Google estava configurado no bot de verdade')

    const chamadas: string[] = []
    const fetchOriginal = globalThis.fetch
    globalThis.fetch = (async (url: unknown) => {
      chamadas.push(String(url))
      throw new Error('o teste tentou falar com a rede')
    }) as typeof fetch
    try {
      const r = await t.sala.enviar('sessao-aaaa', 'segunda às 10h')
      assert.equal(r.avaliacoesAgendadas, 1, 'agendou, mas na agenda simulada')
    } finally {
      globalThis.fetch = fetchOriginal
    }
    assert.deepEqual(chamadas, [], 'nenhuma chamada ao Google (nem a qualquer outro lugar)')
  })

  it('conversas de teste diferentes não se enxergam', async () => {
    const t = sala([usarFerramenta('registrar_matricula', MATRICULA), texto('ok'), texto('oi')])
    const a = await t.sala.enviar('sessao-aaaa', 'fechar')
    const b = await t.sala.enviar('sessao-bbbb', 'oi')
    assert.equal(a.matriculas, 1)
    assert.equal(b.matriculas, 0, 'outra sessão começa limpa')
  })

  it('"nova conversa" apaga tudo: histórico, silêncio, matrículas e agenda simulada', async () => {
    const t = sala([chamarHumano('x'), texto('ok'), texto('Olá de novo!')])
    const r1 = await t.sala.enviar('sessao-aaaa', 'quero uma pessoa')
    assert.equal(r1.emSilencio, true)
    t.sala.reiniciar('sessao-aaaa')
    const r2 = await t.sala.enviar('sessao-aaaa', 'oi')
    assert.equal(r2.emSilencio, false)
    assert.deepEqual(r2.mensagens, ['Olá de novo!'])
  })
})

describe('sessões de teste', () => {
  it('expiram por inatividade e não passam do limite (não vazam memória)', async () => {
    let agora = 1_000_000
    const cfg = criarConfigDeTeste()
    const { claude } = claudeFalso(Array.from({ length: 30 }, () => texto('oi')))
    const s = new SalaDeTeste(cfg, claude, () => agora)
    for (let i = 0; i < 20; i++) {
      await s.enviar(`sessao-${String(i).padStart(4, '0')}`, 'oi')
      agora += 1000
    }
    assert.ok(s.total <= 12, `no máximo 12 sessões, tem ${s.total}`)
    agora += 3 * 3_600_000
    await s.enviar('sessao-nova0', 'oi')
    assert.equal(s.total, 1, 'as ociosas por mais de 2h foram descartadas')
  })

  it('duas mensagens ao mesmo tempo na mesma conversa são atendidas uma de cada vez', async () => {
    const t = sala([texto('primeira'), texto('segunda')])
    const [a, b] = await Promise.all([t.sala.enviar('sessao-aaaa', 'um'), t.sala.enviar('sessao-aaaa', 'dois')])
    assert.deepEqual([a.mensagens[0], b.mensagens[0]], ['primeira', 'segunda'])
  })
})

describe('agenda simulada', () => {
  it('agenda, mostra ocupado, move e apaga, só na memória', async () => {
    const g = new AgendaSimulada()
    const inicio = epochLocal(SEGUNDA, '10:00', FUSO)
    const id = await g.criarEvento('x', { titulo: 'Avaliação — Teste', descricao: 'd', inicio, fim: inicio + 1800_000, fuso: FUSO })
    assert.equal(g.total, 1)
    assert.equal((await g.listarEventos('x', inicio - 1, inicio + 1)).length, 1)
    assert.equal((await g.obterEvento('x', id))?.titulo, 'Avaliação — Teste')
    await g.moverEvento('x', id, { inicio: inicio + 3600_000, fim: inicio + 5400_000, fuso: FUSO })
    assert.equal((await g.obterEvento('x', id))?.inicio, inicio + 3600_000)
    await g.removerEvento('x', id)
    assert.equal(g.total, 0)
  })
})

describe('rotas /teste', () => {
  function montar(respostas: Parameters<typeof claudeFalso>[0]) {
    const base = criarDepsDeAgente(respostas, { ADMIN_TOKEN: 'segredo-admin', WHATSAPP_MODO: 'qr' })
    const wa: ClienteWhatsapp = { async enviarTexto() { throw new Error('o teste NÃO pode usar o WhatsApp de verdade') }, async marcarLida() {} }
    const deps: AppDeps = { ...base.deps, wa, avisarErro: async () => {}, fila: new FilaPorChave(), whatsappEstado: () => ({ status: 'conectado', desde: Date.now() }), iniciadoEm: Date.now() }
    return { app: criarApp(deps), base }
  }
  const post = (corpo: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) })
  const T = 'token=segredo-admin'

  it('SEGURANÇA: sem o token do dono, ninguém abre a página nem gasta a sua chave de API', async () => {
    const { app, base } = montar([texto('não deveria sair')])
    assert.equal((await app.request('/teste')).status, 401)
    assert.equal((await app.request('/teste?token=errado')).status, 401)
    assert.equal((await app.request('/teste/enviar', post({ sessao: 'sessao-aaaa', texto: 'oi' }))).status, 401)
    assert.equal((await app.request('/teste/enviar?token=errado', post({ sessao: 'sessao-aaaa', texto: 'oi' }))).status, 401)
    assert.equal((await app.request('/teste/novo', post({ sessao: 'sessao-aaaa' }))).status, 401)
    assert.equal(base.chamadas.length, 0, 'nenhuma chamada paga ao modelo')
  })

  it('a página abre com o aviso de que é só um teste e sem indexação', async () => {
    const { app } = montar([])
    const r = await app.request(`/teste?${T}`)
    assert.equal(r.status, 200)
    assert.match(r.headers.get('x-robots-tag') ?? '', /noindex/)
    assert.match(r.headers.get('cache-control') ?? '', /no-store/)
    const html = await r.text()
    assert.match(html, /Modo de teste/)
    assert.match(html, /Nada aqui chega ao WhatsApp, à agenda do Google nem à lista de matrículas/)
    assert.match(html, /Nova conversa/)
  })

  it('conversa completa pela rota, sem tocar no WhatsApp de verdade', async () => {
    const { app } = montar([texto(`Olá! Eu sou o GFIT.\n${MARCA_NOVA_MENSAGEM}\nQual o seu nome?`)])
    const r = await app.request(`/teste/enviar?${T}`, post({ sessao: 'sessao-aaaa', texto: 'Oi' }))
    assert.equal(r.status, 200)
    const d = (await r.json()) as { mensagens: string[]; emSilencio: boolean }
    assert.deepEqual(d.mensagens, ['Olá! Eu sou o GFIT.', 'Qual o seu nome?'])
    assert.equal(d.emSilencio, false)
  })

  it('recusa sessão inválida e mensagem vazia', async () => {
    const { app } = montar([])
    assert.equal((await app.request(`/teste/enviar?${T}`, post({ sessao: '../x', texto: 'oi' }))).status, 400)
    assert.equal((await app.request(`/teste/enviar?${T}`, post({ texto: 'oi' }))).status, 400)
    assert.equal((await app.request(`/teste/enviar?${T}`, post({ sessao: 'sessao-aaaa', texto: '   ' }))).status, 400)
    assert.equal((await app.request(`/teste/novo?${T}`, post({ sessao: 'x' }))).status, 400)
  })

  it('a página de conexão tem o botão para abrir o teste', async () => {
    const { app } = montar([])
    const html = await (await app.request(`/conectar?${T}`)).text()
    assert.match(html, /Testar o bot sem WhatsApp/)
    assert.match(html, /href="\/teste\?token=segredo-admin"/)
  })
})
