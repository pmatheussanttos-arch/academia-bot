import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { describe, it } from 'node:test'
import { MSG_ERRO_TECNICO } from '../src/agent.js'
import { criarApp, type AppDeps } from '../src/app.js'
import { MSG_ARQUIVO, MSG_AUDIO, MSG_LIMITE, tratarMensagem, type AtendimentoDeps } from '../src/atendimento.js'
import { exigirWhatsapp } from '../src/config.js'
import { FilaPorChave } from '../src/fila.js'
import type { ClienteWhatsapp, MensagemRecebida } from '../src/whatsapp.js'
import { GoogleFalso, SEGUNDA, chamarHumano, criarDepsDeAgente, texto, usarFerramenta } from './helpers.js'

const CLIENTE = '5511999998888'

function montar(respostas: Parameters<typeof criarDepsDeAgente>[0], extraCfg: Record<string, string> = {}, falhaEnvio = false, google?: GoogleFalso) {
  const base = criarDepsDeAgente(respostas, extraCfg, { google })
  const enviadas: Array<{ para: string; texto: string }> = []
  const lidas: string[] = []
  const alertas: string[] = []
  const wa: ClienteWhatsapp = {
    async enviarTexto(para, t) {
      if (falhaEnvio) throw new Error('WhatsApp API 401 (código 190): token expirado')
      enviadas.push({ para, texto: t })
    },
    async marcarLida(w) {
      lidas.push(w)
    },
  }
  const deps: AtendimentoDeps = {
    ...base.deps,
    wa,
    avisarErro: async (_chave, t) => {
      alertas.push(t)
    },
  }
  return { ...base, deps, enviadas, lidas, alertas }
}

const msg = (extra: Partial<MensagemRecebida> = {}): MensagemRecebida => ({
  wamid: `w${Math.random()}`,
  from: CLIENTE,
  nome: 'Maria',
  tipo: 'text',
  texto: 'Oi',
  ...extra,
})

describe('tratarMensagem', () => {
  it('responde, marca como lida e guarda os dois lados da conversa', async () => {
    const t = montar([texto('Olá! Como posso ajudar?')])
    const m = msg()
    await tratarMensagem(t.deps, m)
    assert.deepEqual(t.enviadas, [{ para: CLIENTE, texto: 'Olá! Como posso ajudar?' }])
    assert.deepEqual(t.lidas, [m.wamid])
    assert.deepEqual(t.store.historico(CLIENTE, 10).map((h) => h.papel), ['user', 'assistant'])
  })

  it('fica em silêncio depois de passar para a equipe, mas continua guardando as mensagens', async () => {
    const t = montar([chamarHumano('Reclamação'), texto('A equipe responde em breve.')])
    await tratarMensagem(t.deps, msg({ texto: 'Estou muito insatisfeito' }))
    assert.equal(t.enviadas.length, 1)
    await tratarMensagem(t.deps, msg({ texto: 'Alguém aí?' }))
    assert.equal(t.enviadas.length, 1, 'o bot não responde durante o handoff')
    assert.equal(t.chamadas.length, 2, 'e também não gasta chamadas de API')
    assert.equal(t.store.historico(CLIENTE, 10).filter((h) => h.conteudo === 'Alguém aí?').length, 1)
  })

  it('fluxo completo: consulta horários, agenda no Google, envia a mensagem exata e continua atendendo', async () => {
    const google = new GoogleFalso()
    google.ocupar(SEGUNDA, '10:00')
    const t = montar(
      [
        usarFerramenta('consultar_horarios', { tipo: 'avaliacao_fisica', data: SEGUNDA }, 'toolu_a'),
        texto('Tenho 09:30 e 10:30 na segunda. Qual prefere? E qual é o seu nome?'),
        usarFerramenta('solicitar_avaliacao', { tipo: 'avaliacao_fisica', nome: 'Maria Silva', data: SEGUNDA, horario: '10:30', observacao: '', ja_e_aluno: false, plano_vip: false }, 'toolu_b'),
        texto('MENSAGEM-DO-MODELO-QUALQUER'),
        texto('O acesso livre custa R$ 99,90.'),
      ],
      {},
      false,
      google,
    )
    await tratarMensagem(t.deps, msg({ texto: 'Quero fazer avaliação segunda de manhã' }))
    assert.match(t.enviadas[0]!.texto, /09:30 e 10:30/)
    assert.equal(t.chamadas[1]!.messages.at(-1)!.role, 'user')
    const resultadoConsulta = JSON.stringify(t.chamadas[1]!.messages.at(-1)!.content)
    assert.match(resultadoConsulta, /Horários livres para avaliação em Segunda-feira, 19\/10/)
    assert.doesNotMatch(resultadoConsulta, /10:00,/, 'o horário ocupado não é oferecido')

    await tratarMensagem(t.deps, msg({ texto: 'Maria Silva, 10:30' }))
    const resultadoSolicitar = JSON.stringify(t.chamadas[3]!.messages.at(-1)!.content)
    assert.match(resultadoSolicitar, /AGENDADO/)
    assert.match(resultadoSolicitar, /EXATAMENTE/)
    assert.match(resultadoSolicitar, /Avaliação agendada! ✅/)
    assert.equal(google.criados.length, 1)
    assert.equal(google.criados[0]!.evento.titulo, 'Avaliação — Maria Silva')
    assert.equal(t.store.emHandoff(CLIENTE), false, 'agendar não silencia o bot')

    await tratarMensagem(t.deps, msg({ texto: 'E quanto custa o acesso livre?' }))
    assert.equal(t.enviadas.at(-1)?.texto, 'O acesso livre custa R$ 99,90.')
  })

  it('pedido recusado pela agenda volta como erro para o modelo oferecer outro horário', async () => {
    const google = new GoogleFalso()
    google.ocupar(SEGUNDA, '10:00')
    const t = montar(
      [
        usarFerramenta('solicitar_avaliacao', { tipo: 'avaliacao_fisica', nome: 'Maria', data: SEGUNDA, horario: '10:00', observacao: '', ja_e_aluno: false, plano_vip: false }),
        texto('Esse horário acabou de ser ocupado. Posso 10:30?'),
      ],
      {},
      false,
      google,
    )
    await tratarMensagem(t.deps, msg({ texto: 'quero 10h' }))
    const volta = t.chamadas[1]!.messages.at(-1)!.content as Array<{ is_error?: boolean; content?: string }>
    assert.equal(volta[0]?.is_error, true)
    assert.match(String(volta[0]?.content), /10:00 já está ocupado/)
    assert.equal(google.criados.length, 0)
    assert.equal(t.enviadas[0]?.texto, 'Esse horário acabou de ser ocupado. Posso 10:30?')
  })

  it('aula experimental: pedido registrado, equipe avisada, bot segue atendendo', async () => {
    const t = montar([
      usarFerramenta('solicitar_avaliacao', { tipo: 'aula_experimental', nome: 'Beto', data: SEGUNDA, horario: '15:00', observacao: 'primeira vez', ja_e_aluno: false, plano_vip: false }),
      texto('MENSAGEM-DO-MODELO'),
    ])
    await tratarMensagem(t.deps, msg({ texto: 'quero experimentar segunda 15h' }))
    assert.match(JSON.stringify(t.chamadas[1]!.messages.at(-1)!.content), /ainda NÃO está agendado/)
    assert.match(t.avisos[0]!, /Pedido de aula experimental/)
    assert.match(t.avisos[0]!, /primeira vez/)
    assert.equal(t.store.emHandoff(CLIENTE), false)
  })

  it('respeita a lista de números de teste', async () => {
    const t = montar([texto('oi')], { NUMEROS_PERMITIDOS: '11988887777' })
    await tratarMensagem(t.deps, msg())
    assert.equal(t.enviadas.length, 0)
    assert.equal(t.chamadas.length, 0)
    await tratarMensagem(t.deps, msg({ from: '5511988887777' }))
    assert.equal(t.enviadas.length, 1)
  })

  it('áudio: pede para escrever, sem chamar a IA; imagem: passa para a equipe', async () => {
    const t = montar([])
    await tratarMensagem(t.deps, msg({ tipo: 'audio', texto: undefined }))
    assert.equal(t.enviadas[0]?.texto, MSG_AUDIO)
    assert.equal(t.store.emHandoff(CLIENTE), false)

    const t2 = montar([])
    await tratarMensagem(t2.deps, msg({ tipo: 'image', texto: 'segue o comprovante' }))
    assert.equal(t2.enviadas[0]?.texto, MSG_ARQUIVO)
    assert.equal(t2.store.emHandoff(CLIENTE), true)
    assert.match(t2.avisos[0]!, /comprovante/)
    assert.equal(t2.chamadas.length, 0)
  })

  it('ignora reações, figurinhas e mensagens vazias', async () => {
    const t = montar([])
    await tratarMensagem(t.deps, msg({ tipo: 'reaction', texto: undefined }))
    await tratarMensagem(t.deps, msg({ tipo: 'sticker', texto: undefined }))
    await tratarMensagem(t.deps, msg({ texto: '   ' }))
    assert.equal(t.enviadas.length, 0)
    assert.equal(t.chamadas.length, 0)
  })

  it('limita mensagens por hora: avisa uma vez e depois silencia', async () => {
    const t = montar([texto('1'), texto('2'), texto('3')]) // limite de teste = 3
    for (let i = 0; i < 6; i++) await tratarMensagem(t.deps, msg({ texto: `msg ${i}` }))
    assert.deepEqual(t.enviadas.map((e) => e.texto), ['1', '2', '3', MSG_LIMITE])
    assert.equal(t.chamadas.length, 3)
  })

  it('se a IA falhar, avisa o cliente e a equipe e passa a conversa para uma pessoa', async () => {
    const t = montar([new Error('API fora do ar')])
    await tratarMensagem(t.deps, msg())
    assert.equal(t.enviadas[0]?.texto, MSG_ERRO_TECNICO)
    assert.equal(t.store.emHandoff(CLIENTE), true)
    assert.equal(t.avisos.length, 1)
  })

  it('se o envio no WhatsApp falhar, alerta a equipe e não derruba nada', async () => {
    const t = montar([texto('Olá!')], {}, true)
    await tratarMensagem(t.deps, msg())
    assert.equal(t.alertas.length, 1)
    assert.match(t.alertas[0]!, /190/)
    assert.equal(t.store.historico(CLIENTE, 10).some((h) => h.papel === 'assistant'), false, 'resposta não entregue não entra no histórico')
  })
})

describe('servidor HTTP', () => {
  function montarApp(respostas: Parameters<typeof criarDepsDeAgente>[0], extraCfg: Record<string, string> = {}) {
    const t = montar(respostas, extraCfg)
    const fila = new FilaPorChave()
    const deps: AppDeps = { ...t.deps, fila, whatsappCfg: exigirWhatsapp(t.cfg), iniciadoEm: Date.now() }
    return { ...t, app: criarApp(deps), fila }
  }
  const payload = (id: string, corpo: string) =>
    JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '111' },
                contacts: [{ wa_id: CLIENTE, profile: { name: 'Maria' } }],
                messages: [{ id: id, from: CLIENTE, type: 'text', text: { body: corpo } }],
              },
            },
          ],
        },
      ],
    })
  const assinar = (c: string) => `sha256=${createHmac('sha256', 'segredo').update(c).digest('hex')}`
  const post = (app: ReturnType<typeof criarApp>, corpo: string, assinatura = assinar(corpo)) =>
    app.request('/webhook', { method: 'POST', headers: { 'x-hub-signature-256': assinatura, 'content-type': 'application/json' }, body: corpo })

  it('confirma o webhook para a Meta só com o token certo', async () => {
    const { app } = montarApp([])
    const ok = await app.request('/webhook?hub.mode=subscribe&hub.verify_token=verifica&hub.challenge=12345')
    assert.equal(ok.status, 200)
    assert.equal(await ok.text(), '12345')
    const ruim = await app.request('/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=12345')
    assert.equal(ruim.status, 403)
  })

  it('rejeita assinatura inválida e não processa nada', async () => {
    const t = montarApp([texto('não deveria responder')])
    const res = await post(t.app, payload('w1', 'Oi'), 'sha256=00')
    assert.equal(res.status, 401)
    await t.fila.executar(CLIENTE, async () => undefined)
    assert.equal(t.enviadas.length, 0)
  })

  it('responde 200 na hora, atende em segundo plano e ignora reenvio da mesma mensagem', async () => {
    const t = montarApp([texto('Olá, Maria!')])
    const corpo = payload('wamid.abc', 'Oi')
    assert.equal((await post(t.app, corpo)).status, 200)
    assert.equal((await post(t.app, corpo)).status, 200) // a Meta reenviou
    await t.fila.executar(CLIENTE, async () => undefined)
    assert.deepEqual(t.enviadas, [{ para: CLIENTE, texto: 'Olá, Maria!' }])
    assert.equal(t.chamadas.length, 1)
  })

  it('devolve 200 para JSON quebrado, para a Meta não ficar reenviando', async () => {
    const { app } = montarApp([])
    assert.equal((await post(app, '{quebrado')).status, 200)
  })

  it('health mostra se as instruções estão completas', async () => {
    const { app } = montarApp([])
    const dados = (await (await app.request('/health')).json()) as { ok: boolean; instrucoes_completas: boolean }
    assert.equal(dados.ok, true)
    assert.equal(dados.instrucoes_completas, true)
  })

  it('painel admin: desligado sem ADMIN_TOKEN; com token, lista e libera conversas', async () => {
    const semToken = montarApp([])
    assert.equal((await semToken.app.request('/admin/handoffs', { headers: { authorization: 'Bearer qualquer' } })).status, 401)

    const t = montarApp([], { ADMIN_TOKEN: 'segredo-admin' })
    t.store.definirHandoff(CLIENTE, 6, 'teste')
    const h = { authorization: 'Bearer segredo-admin', 'content-type': 'application/json' }
    assert.equal((await t.app.request('/admin/handoffs', { headers: { authorization: 'Bearer errado' } })).status, 401)
    const lista = (await (await t.app.request('/admin/handoffs', { headers: h })).json()) as { handoffs: unknown[] }
    assert.equal(lista.handoffs.length, 1)
    const lib = await t.app.request('/admin/liberar', { method: 'POST', headers: h, body: JSON.stringify({ numero: '+55 11 99999-8888' }) })
    assert.deepEqual(await lib.json(), { liberado: true })
    assert.equal(t.store.emHandoff(CLIENTE), false)
  })
})
