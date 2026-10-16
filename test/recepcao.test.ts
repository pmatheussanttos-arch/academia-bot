import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MSG_HANDOFF_PADRAO, linkHandoff, msgHandoff, responder } from '../src/agent.js'
import { MSG_ARQUIVO, MSG_AUDIO, tratarMensagem, type AtendimentoDeps } from '../src/atendimento.js'
import { carregarConfig } from '../src/config.js'
import { linkRecepcao, normalizarNumeroRecepcao } from '../src/recepcao.js'
import type { ClienteWhatsapp, MensagemRecebida } from '../src/whatsapp.js'
import { SEGUNDA, chamarHumano, criarDepsDeAgente, criarServico, texto, usarFerramenta } from './helpers.js'

const CHAT = '5511999998888'
const RECEPCAO = { NUMERO_RECEPCAO: '(11) 98888-7777' }

/** Lê o texto que vai pré-preenchido na conversa com a recepção. */
function textoDoLink(conteudo: string): string {
  const url = /https:\/\/wa\.me\/\d+\?text=\S+/.exec(conteudo)
  assert.ok(url, `não achei link em: ${conteudo}`)
  return decodeURIComponent(new URL(url[0]).searchParams.get('text')!)
}

describe('número da recepção', () => {
  it('normaliza formatos comuns e recusa lixo', () => {
    assert.equal(normalizarNumeroRecepcao('(11) 98888-7777'), '5511988887777')
    assert.equal(normalizarNumeroRecepcao('11988887777'), '5511988887777')
    assert.equal(normalizarNumeroRecepcao('+55 11 98888-7777'), '5511988887777')
    assert.equal(normalizarNumeroRecepcao('1133334444'), '551133334444', 'fixo com 10 dígitos')
    for (const ruim of ['abc', '123', '999', '55']) assert.throws(() => normalizarNumeroRecepcao(ruim), /NUMERO_RECEPCAO inválido/)
  })

  it('monta o link com a mensagem codificada, e nada se não houver número', () => {
    assert.equal(linkRecepcao(undefined, 'oi'), undefined)
    assert.equal(linkRecepcao('5511988887777', 'Oi! Quero 100% & mais'), 'https://wa.me/5511988887777?text=Oi!%20Quero%20100%25%20%26%20mais')
    assert.ok(linkRecepcao('5511988887777', 'x'.repeat(2000))!.length < 700, 'texto limitado')
  })

  it('configuração: com recepção o bot não se cala; sem recepção mantém o silêncio; valor explícito vence', () => {
    const base = {}
    assert.equal(carregarConfig({ ...base }).handoffHoras, 6)
    const com = carregarConfig({ NUMERO_RECEPCAO: '11988887777' })
    assert.equal(com.numeroRecepcao, '5511988887777')
    assert.equal(com.handoffHoras, 0)
    assert.equal(carregarConfig({ NUMERO_RECEPCAO: '11988887777', HANDOFF_HORAS: '3' }).handoffHoras, 3)
    assert.equal(carregarConfig({ HANDOFF_HORAS: '0' }).handoffHoras, 0)
    assert.throws(() => carregarConfig({ NUMERO_RECEPCAO: 'telefone da recepção' }), /NUMERO_RECEPCAO inválido/)
  })
})

describe('chamar a equipe com número de recepção', () => {
  it('a ferramenta devolve o link com o motivo e o bot NÃO fica em silêncio', async () => {
    const t = criarDepsDeAgente([chamarHumano('Quer cancelar o plano'), texto('Claro! Toque aqui para falar com a recepção 👇 LINK')], RECEPCAO)
    t.store.adicionarMensagem(CHAT, 'user', 'quero cancelar')
    await responder(t.deps, CHAT, 'Maria')

    const resultado = JSON.stringify(t.chamadas[1]!.messages.at(-1)!.content)
    assert.match(resultado, /wa\.me\/5511988887777\?text=/)
    assert.match(resultado, /sem alterar/)
    const link = /https:\/\/wa\.me\/\d+\?text=[^"\\ ]+/.exec(resultado)![0]
    assert.match(decodeURIComponent(link), /Vim pelo assistente virtual.*Quer cancelar o plano/)
    assert.equal(t.store.emHandoff(CHAT), false)
    assert.match(t.avisos[0]!, /recebeu o link para falar com a recepção; o bot continua atendendo/)
  })

  it('sem número de recepção continua como antes: avisa a equipe e se cala', async () => {
    const t = criarDepsDeAgente([chamarHumano('Reclamação'), texto('A equipe responde em breve.')])
    t.store.adicionarMensagem(CHAT, 'user', 'reclamação')
    await responder(t.deps, CHAT, 'Maria')
    assert.equal(t.store.emHandoff(CHAT), true)
    assert.doesNotMatch(JSON.stringify(t.chamadas[1]!.messages.at(-1)!.content), /wa\.me/)
  })

  it('mensagens fixas de contingência trazem o link (bloqueio de segurança e modelo sem texto)', async () => {
    const t = criarDepsDeAgente([{ content: [], stop_reason: 'refusal' }, chamarHumano('x'), { content: [], stop_reason: 'end_turn' }], RECEPCAO)
    t.store.adicionarMensagem(CHAT, 'user', 'oi')
    assert.match(await responder(t.deps, CHAT, 'M'), /wa\.me\/5511988887777/)
    assert.match(await responder(t.deps, CHAT, 'M'), /wa\.me\/5511988887777/)
    assert.equal(msgHandoff(t.cfg, 'x').includes('wa.me'), true)
    assert.equal(msgHandoff(criarDepsDeAgente([]).cfg, 'x'), MSG_HANDOFF_PADRAO)
    assert.equal(linkHandoff(criarDepsDeAgente([]).cfg, 'x'), undefined)
  })
})

describe('atendimento com número de recepção', () => {
  function montar(respostas: Parameters<typeof criarDepsDeAgente>[0], extra: Record<string, string> = RECEPCAO) {
    const base = criarDepsDeAgente(respostas, extra)
    const enviadas: string[] = []
    const wa: ClienteWhatsapp = {
      async enviarTexto(_p, t) {
        enviadas.push(t)
      },
      async marcarLida() {},
    }
    const deps: AtendimentoDeps = { ...base.deps, wa, avisarErro: async () => {} }
    return { ...base, deps, enviadas }
  }
  const msg = (extra: Partial<MensagemRecebida> = {}): MensagemRecebida => ({ wamid: `w${Math.random()}`, from: CHAT, nome: 'Maria', tipo: 'text', texto: 'Oi', ...extra })

  it('erro técnico: o cliente recebe o link da recepção, não fica sem saída', async () => {
    const t = montar([new Error('API fora do ar')])
    await tratarMensagem(t.deps, msg())
    assert.match(t.enviadas[0]!, /Tive um problema técnico/)
    assert.match(textoDoLink(t.enviadas[0]!), /problema com o assistente virtual/)
    assert.equal(t.store.emHandoff(CHAT), false, 'não silencia: o link é a saída')
  })

  it('imagem e áudio: orientam a falar com a recepção pelo link', async () => {
    const t = montar([])
    await tratarMensagem(t.deps, msg({ tipo: 'image', texto: undefined }))
    await tratarMensagem(t.deps, msg({ tipo: 'audio', texto: undefined }))
    assert.match(t.enviadas[0]!, /envie direto para a nossa recepção/)
    assert.match(t.enviadas[0]!, /wa\.me\/5511988887777/)
    assert.match(t.enviadas[1]!, /só consigo ler texto/)
    assert.match(t.enviadas[1]!, /wa\.me\/5511988887777/)
    assert.equal(t.chamadas.length, 0)
  })

  it('sem recepção, os textos antigos continuam iguais', async () => {
    const arquivo = montar([], {})
    await tratarMensagem(arquivo.deps, msg({ tipo: 'image', texto: undefined }))
    assert.equal(arquivo.enviadas[0], MSG_ARQUIVO)
    assert.equal(arquivo.store.emHandoff(CHAT), true, 'no modo antigo, arquivo passa para a equipe e o bot se cala')

    const audio = montar([], {})
    await tratarMensagem(audio.deps, msg({ tipo: 'audio', texto: undefined }))
    assert.equal(audio.enviadas[0], MSG_AUDIO)
  })

  it('depois de chamar a recepção, o bot segue respondendo às próximas perguntas', async () => {
    const t = montar([chamarHumano('Lesão no joelho'), texto('Toque no link 👇'), texto('O acesso livre custa R$ 99,90.')])
    await tratarMensagem(t.deps, msg({ texto: 'machuquei o joelho' }))
    await tratarMensagem(t.deps, msg({ texto: 'e quanto custa o acesso livre?' }))
    assert.equal(t.enviadas.at(-1), 'O acesso livre custa R$ 99,90.')
  })
})

describe('pedidos de visita com número de recepção', () => {
  const pedido = (extra = {}) => ({
    chat: CHAT,
    nomeContato: 'Mari',
    nomeCliente: 'Maria Silva',
    tipo: 'aula_experimental' as const,
    dataISO: SEGUNDA,
    hhmm: '15:30',
    obs: '',
    jaEAluno: false,
    planoVip: false,
    ...extra,
  })

  it('aula experimental: a mensagem traz o link com dia, hora e nome, e não promete resposta "por aqui"', async () => {
    const { servico } = criarServico({ numeroRecepcao: '5511988887777' })
    const r = await servico.solicitar(pedido())
    assert.ok(r.ok && !r.agendada)
    assert.match(r.mensagem, /Para garantir o seu horário, toque no link/)
    assert.doesNotMatch(r.mensagem, /por aqui em seguida/)
    assert.equal(textoDoLink(r.mensagem), 'Oi! Quero confirmar minha aula experimental na Segunda-feira, 19/10 às 15:30. Meu nome: Maria Silva.')
    assert.match(r.mensagem, /Qualquer dúvida, tô aqui!/)
  })

  it('sem número de recepção: texto antigo ("a equipe confirma por aqui")', async () => {
    const r = await criarServico({}).servico.solicitar(pedido())
    assert.ok(r.ok)
    assert.match(r.mensagem, /Nossa equipe confirma o seu horário por aqui em seguida/)
    assert.doesNotMatch(r.mensagem, /wa\.me/)
  })

  it('avaliação sem Google também vira pedido com link; com Google agenda e não pede confirmação', async () => {
    const manual = await criarServico({ numeroRecepcao: '5511988887777' }).servico.solicitar(pedido({ tipo: 'avaliacao_fisica', hhmm: '10:00' }))
    assert.ok(manual.ok && !manual.agendada)
    assert.match(textoDoLink(manual.mensagem), /minha avaliação na Segunda-feira, 19\/10 às 10:00/)

    const { GoogleFalso } = await import('./helpers.js')
    const google = new GoogleFalso()
    const auto = await criarServico({ google, numeroRecepcao: '5511988887777' }).servico.solicitar(pedido({ tipo: 'avaliacao_fisica', hhmm: '10:00' }))
    assert.ok(auto.ok && auto.agendada)
    assert.doesNotMatch(auto.mensagem, /wa\.me/)
  })

  it('o fluxo completo pela conversa entrega a mensagem da ferramenta', async () => {
    const t = criarDepsDeAgente(
      [usarFerramenta('solicitar_avaliacao', { tipo: 'aula_experimental', nome: 'Beto', data: SEGUNDA, horario: '15:00', observacao: '', ja_e_aluno: false, plano_vip: false }), texto('x')],
      RECEPCAO,
    )
    t.store.adicionarMensagem(CHAT, 'user', 'quero experimentar segunda 15h')
    await responder(t.deps, CHAT, 'Beto')
    const resultado = JSON.stringify(t.chamadas[1]!.messages.at(-1)!.content)
    assert.match(resultado, /wa\.me\/5511988887777/)
    assert.match(resultado, /EXATAMENTE/)
  })
})
