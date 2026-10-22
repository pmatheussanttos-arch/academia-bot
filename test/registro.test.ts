import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { responder } from '../src/agent.js'
import { ehSemResposta, tratarMensagem, type AtendimentoDeps } from '../src/atendimento.js'
import { SalaDeTeste } from '../src/sala-de-teste.js'
import { Store } from '../src/store.js'
import type { ClienteWhatsapp } from '../src/whatsapp.js'
import { AGORA, SEGUNDA, chamarHumano, claudeFalso, criarConfigDeTeste, criarDepsDeAgente, texto, usarFerramenta } from './helpers.js'

const CHAT = '5511977776666'
const MATRICULA = { nome: 'Maria Silva Souza', telefone: '(11) 97777-6666', email: '', nascimento: '', plano: 'Anual VIP', pagamento: 'pix', observacao: '' }
const DESDE = 0

function comUso<T extends { content: unknown[]; stop_reason: string }>(r: T, usage: Record<string, number | null>) {
  return { ...r, usage } as unknown as T
}

function montar(respostas: Parameters<typeof criarDepsDeAgente>[0]) {
  const base = criarDepsDeAgente(respostas)
  const enviadas: string[] = []
  const wa: ClienteWhatsapp = {
    async enviarTexto(_p, t) {
      enviadas.push(t)
    },
    async marcarLida() {},
  }
  const deps: AtendimentoDeps = { ...base.deps, wa, avisarErro: async () => {}, pausaEntreMensagensMs: 0 }
  return { ...base, deps, enviadas }
}

describe('registro do que acontece (para o painel)', () => {
  it('anota o consumo da IA de cada chamada, inclusive as da ferramenta', async () => {
    const t = criarDepsDeAgente([
      comUso(usarFerramenta('consultar_horarios', { tipo: 'avaliacao_fisica', data: SEGUNDA, periodo: 'qualquer' }), { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5000, cache_creation_input_tokens: 300 }),
      comUso(texto('ok'), { input_tokens: 50, output_tokens: 10, cache_read_input_tokens: null, cache_creation_input_tokens: null }),
    ])
    t.store.adicionarMensagem(CHAT, 'user', 'horários?')
    await responder(t.deps, CHAT, undefined)
    const soma = t.store.somaUsoIa(DESDE)
    assert.equal(soma.chamadas, 2)
    assert.equal(soma.entrada, 150)
    assert.equal(soma.saida, 30)
    assert.equal(soma.cacheLeitura, 5000)
    assert.equal(soma.cacheEscrita, 300)
  })

  it('chamar a equipe vira evento "transferencia" com o motivo', async () => {
    const t = criarDepsDeAgente([chamarHumano('quer cancelar o plano'), texto('Vou te transferir')])
    t.store.adicionarMensagem(CHAT, 'user', 'quero cancelar')
    await responder(t.deps, CHAT, undefined)
    const [e] = t.store.eventosRecentes('transferencia')
    assert.equal(e!.chat, CHAT)
    assert.equal(e!.detalhe, 'quer cancelar o plano')
  })

  it('matrícula e avaliação marcadas pelo bot viram eventos', async () => {
    const t = criarDepsDeAgente([
      usarFerramenta('solicitar_avaliacao', { tipo: 'avaliacao_fisica', nome: 'Beto', data: SEGUNDA, horario: '10:00', observacao: '', ja_e_aluno: false, plano_vip: false }, 'a'),
      usarFerramenta('registrar_matricula', MATRICULA, 'b'),
      texto('ok'),
    ])
    t.store.adicionarMensagem(CHAT, 'user', 'fechar')
    await responder(t.deps, CHAT, undefined)
    assert.equal(t.store.contarEventos('avaliacao_bot', DESDE), 1)
    assert.match(t.store.eventosRecentes('avaliacao_bot')[0]!.detalhe, /avaliacao_fisica .*10:00/)
    assert.equal(t.store.contarEventos('matricula', DESDE), 1)
    assert.equal(t.store.eventosRecentes('matricula')[0]!.detalhe, 'Anual VIP')
  })

  it('matrícula recusada (dados ruins) NÃO vira evento', async () => {
    const t = criarDepsDeAgente([usarFerramenta('registrar_matricula', { ...MATRICULA, nome: 'Maria' }), texto('ok')])
    t.store.adicionarMensagem(CHAT, 'user', 'fechar')
    await responder(t.deps, CHAT, undefined)
    assert.equal(t.store.contarEventos('matricula', DESDE), 0)
  })

  it('reconhece a frase "essa informação eu não tenho" e guarda a pergunta do cliente', async () => {
    assert.equal(ehSemResposta('Essa informação eu não tenho aqui no momento 😊 Vou pedir...'), true)
    assert.equal(ehSemResposta('essa informacao eu nao tenho'), true)
    assert.equal(ehSemResposta('O plano custa R$ 89,90'), false)

    const t = montar([texto('Essa informação eu não tenho aqui no momento 😊 Vou pedir para a equipe te responder certinho, pode ser?')])
    await tratarMensagem(t.deps, { wamid: 'w1', from: CHAT, nome: '', tipo: 'text', texto: 'Tem estacionamento coberto?' })
    assert.equal(t.enviadas.length, 1)
    const [e] = t.store.eventosRecentes('sem_resposta')
    assert.equal(e!.detalhe, 'Tem estacionamento coberto?')
    assert.equal(e!.chat, CHAT)
  })

  it('resposta normal não gera "sem_resposta"', async () => {
    const t = montar([texto('Temos sim!')])
    await tratarMensagem(t.deps, { wamid: 'w1', from: CHAT, nome: '', tipo: 'text', texto: 'Tem ar condicionado?' })
    assert.equal(t.store.contarEventos('sem_resposta', DESDE), 0)
  })

  it('se anotar falhar, o cliente recebe a resposta do mesmo jeito', async () => {
    const t = montar([texto('Essa informação eu não tenho aqui no momento 😊 pode ser?')])
    t.store.registrarEvento = () => {
      throw new Error('banco travou')
    }
    t.store.registrarUsoIa = () => {
      throw new Error('banco travou')
    }
    const erros = console.error
    console.error = () => {}
    try {
      await tratarMensagem(t.deps, { wamid: 'w1', from: CHAT, nome: '', tipo: 'text', texto: 'Tem sauna?' })
    } finally {
      console.error = erros
    }
    assert.equal(t.enviadas.length, 1)
  })

  it('a conversa de teste gasta de verdade: o consumo vai para o banco real, mas os eventos ficam isolados', async () => {
    const real = new Store(':memory:')
    const cfg = criarConfigDeTeste()
    const { claude } = claudeFalso([comUso(chamarHumano('teste'), { input_tokens: 70, output_tokens: 7 }), comUso(texto('ok'), { input_tokens: 30, output_tokens: 3 })])
    const sala = new SalaDeTeste(cfg, claude, () => AGORA.getTime(), (u) => real.registrarUsoIa(u, AGORA.getTime()))
    await sala.enviar('s1', 'oi')
    assert.equal(real.somaUsoIa(DESDE).entrada, 100)
    assert.equal(real.somaUsoIa(DESDE).chamadas, 2)
    assert.equal(real.contarEventos('transferencia', DESDE), 0, 'nada da simulação entra nos números reais')
  })
})
