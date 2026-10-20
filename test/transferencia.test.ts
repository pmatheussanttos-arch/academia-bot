import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { MSG_ERRO_TECNICO, MSG_HANDOFF_PADRAO, msgHandoff, responder, textoTransferencia } from '../src/agent.js'
import { MSG_ARQUIVO, MSG_AUDIO, tratarMensagem, type AtendimentoDeps } from '../src/atendimento.js'
import { carregarConfig } from '../src/config.js'
import { REGRAS_FIXAS } from '../src/prompt.js'
import type { ClienteWhatsapp, MensagemRecebida } from '../src/whatsapp.js'
import { SEGUNDA, chamarHumano, criarConfigDeTeste, criarDepsDeAgente, criarServico, pastaTemporaria, texto, usarFerramenta } from './helpers.js'

const CHAT = '5511977776666'
// O estado real da Render: modo QR com o celular pessoal do dono preenchido em NUMERO_RECEPCAO.
const QR_COM_PESSOAL = { WHATSAPP_MODO: 'qr', NUMERO_RECEPCAO: '(11) 99999-8888' }
const PESSOAL = /5511999998888|99999-8888|999998888|wa\.me/

function montar(respostas: Parameters<typeof criarDepsDeAgente>[0], extra: Record<string, string> = QR_COM_PESSOAL) {
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

describe('modo QR: o cliente nunca recebe número de telefone', () => {
  it('NUMERO_RECEPCAO é ignorado: sem link, o bot se cala 6h e a equipe atende no WhatsApp da academia', () => {
    const cfg = carregarConfig({ ...QR_COM_PESSOAL })
    assert.equal(cfg.numeroRecepcao, undefined)
    assert.equal(cfg.handoffHoras, 6)
    assert.deepEqual(cfg.numerosAvisos, [], 'e também não vira destino de aviso')
    assert.doesNotThrow(() => carregarConfig({ WHATSAPP_MODO: 'qr', NUMERO_RECEPCAO: 'lixo' }), 'valor inválido não derruba o modo QR')
  })

  it('no modo oficial o link da recepção continua existindo', () => {
    assert.equal(carregarConfig({ NUMERO_RECEPCAO: '11999998888' }).numeroRecepcao, '5511999998888')
  })

  it('chamar a equipe: a ferramenta manda enviar a mensagem de transferência, sem link nem telefone', async () => {
    const t = montar([chamarHumano('Quer falar com atendente'), texto(MSG_HANDOFF_PADRAO)])
    t.store.adicionarMensagem(CHAT, 'user', 'quero falar com uma pessoa')
    await responder(t.deps, CHAT, 'Maria')

    const resultado = JSON.stringify(t.chamadas[1]!.messages.at(-1)!.content)
    assert.match(resultado, /EXATAMENTE/)
    assert.ok(resultado.includes('vou te transferir para um atendente'), resultado)
    assert.doesNotMatch(resultado, PESSOAL)
    assert.equal(t.store.emHandoff(CHAT), true, 'o bot sai da conversa para a equipe atender')
  })

  it('o aviso à equipe diz para responder pelo WhatsApp da academia e que o bot ficou em silêncio', async () => {
    const t = montar([chamarHumano('Quer cancelar'), texto('ok')])
    await tratarMensagem(t.deps, msg())
    assert.match(t.avisos[0]!, /O bot fica em silêncio com este cliente por 6h/)
    assert.match(t.avisos[0]!, /Responda pelo WhatsApp da academia/)
  })

  it('mensagens de contingência (bloqueio, erro técnico, áudio, arquivo) também não trazem número', async () => {
    const bloqueio = montar([{ content: [], stop_reason: 'refusal' }])
    bloqueio.store.adicionarMensagem(CHAT, 'user', 'oi')
    assert.equal(await responder(bloqueio.deps, CHAT, 'M'), MSG_HANDOFF_PADRAO)

    const erro = montar([new Error('API fora do ar')])
    await tratarMensagem(erro.deps, msg())
    assert.equal(erro.enviadas[0], MSG_ERRO_TECNICO)

    const midia = montar([])
    await tratarMensagem(midia.deps, msg({ tipo: 'audio', texto: undefined }))
    await tratarMensagem(midia.deps, msg({ tipo: 'image', texto: undefined, from: '5511966665555' }))
    assert.equal(midia.enviadas[0], MSG_AUDIO)
    assert.equal(midia.enviadas[1], MSG_ARQUIVO)

    for (const e of [...erro.enviadas, ...midia.enviadas]) assert.doesNotMatch(e, PESSOAL)
  })

  it('pedido de visita: "a equipe confirma por aqui", sem link', async () => {
    const t = criarDepsDeAgente(
      [usarFerramenta('solicitar_avaliacao', { tipo: 'aula_experimental', nome: 'Beto', data: SEGUNDA, horario: '15:00', observacao: '', ja_e_aluno: false, plano_vip: false }), texto('x')],
      QR_COM_PESSOAL,
    )
    t.store.adicionarMensagem(CHAT, 'user', 'quero experimentar segunda 15h')
    await responder(t.deps, CHAT, 'Beto')
    const resultado = JSON.stringify(t.chamadas[1]!.messages.at(-1)!.content)
    assert.match(resultado, /Nossa equipe confirma o seu horário por aqui/)
    assert.doesNotMatch(resultado, PESSOAL)
    assert.equal(criarServico({}).servico.modo, 'manual')
  })

  it('as regras fixas proíbem o bot de passar telefone de funcionários', () => {
    assert.match(REGRAS_FIXAS, /Nunca informe telefone ou WhatsApp de funcionários/)
  })
})

describe('mensagem de transferência editável (mensagens.md)', () => {
  /** Parte do mensagens.md de verdade (com todas as seções obrigatórias) e troca só o final. */
  const comArquivo = (finalDoArquivo: string) => {
    const pasta = pastaTemporaria()
    const caminho = join(pasta, 'mensagens.md')
    writeFileSync(caminho, readFileSync('./mensagens.md', 'utf8').replace(/## transferencia[\s\S]*$/, '') + finalDoArquivo)
    return criarConfigDeTeste({ MENSAGENS_PATH: caminho })
  }

  it('o mensagens.md do projeto traz a seção e o texto bate com o padrão do código', () => {
    assert.equal(textoTransferencia(criarConfigDeTeste()), MSG_HANDOFF_PADRAO)
    assert.match(MSG_HANDOFF_PADRAO, /vou te transferir para um atendente/)
  })

  it('o dono troca o texto no arquivo e vale na hora', () => {
    const cfg = comArquivo('## transferencia\nCerto! Já chamei alguém da equipe, só um minutinho 🙌\n')
    assert.equal(textoTransferencia(cfg), 'Certo! Já chamei alguém da equipe, só um minutinho 🙌')
    assert.equal(msgHandoff(cfg, 'x'), 'Certo! Já chamei alguém da equipe, só um minutinho 🙌')
  })

  it('seção ausente, vazia ou arquivo ilegível: cai no padrão e o cliente nunca fica sem resposta', () => {
    assert.equal(textoTransferencia(comArquivo('## outra\ntexto\n')), MSG_HANDOFF_PADRAO)
    assert.equal(textoTransferencia(comArquivo('## transferencia\n\n## outra\ntexto\n')), MSG_HANDOFF_PADRAO)
    assert.equal(textoTransferencia(criarConfigDeTeste({ MENSAGENS_PATH: '/nao/existe/mensagens.md' })), MSG_HANDOFF_PADRAO)
  })

  it('o arquivo sem a seção continua válido para o resto do bot (a seção é opcional)', async () => {
    const { carregarMensagens } = await import('../src/mensagens.js')
    const pasta = pastaTemporaria()
    writeFileSync(join(pasta, 'm.md'), readFileSync('./mensagens.md', 'utf8').replace(/## transferencia[\s\S]*$/, ''))
    assert.doesNotThrow(() => carregarMensagens(join(pasta, 'm.md')))
  })
})
