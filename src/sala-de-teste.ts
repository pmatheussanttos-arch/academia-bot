import { randomUUID } from 'node:crypto'
import { AgendaSimulada } from './agenda-simulada.js'
import { carregarAgenda } from './agenda.js'
import { ServicoAgenda } from './agendamento.js'
import type { ClienteClaude } from './agent.js'
import { tratarMensagem, type AtendimentoDeps } from './atendimento.js'
import type { Config } from './config.js'
import { carregarMensagens } from './mensagens.js'
import { Store } from './store.js'

/**
 * Conversa de teste com o assistente, sem WhatsApp. Cada sessão é um mundo à parte: banco na memória,
 * agenda simulada e avisos à equipe capturados em vez de enviados. Nada daqui chega ao WhatsApp, ao
 * Google Agenda nem à lista de matrículas de verdade. Só a Claude API é real (é ela que está sendo testada).
 */

const MAX_SESSOES = 12
const OCIOSA_MS = 2 * 3_600_000

export interface RespostaTeste {
  /** O que o cliente receberia no WhatsApp, uma mensagem por item. */
  mensagens: string[]
  /** Avisos que a equipe receberia (matrícula, pedido de avaliação, atendimento humano...). */
  avisos: string[]
  /** O que o assistente fez nos bastidores (consultou horários, registrou matrícula...). */
  ferramentas: string[]
  /** O bot ficaria em silêncio nesta conversa (passou para a equipe). */
  emSilencio: boolean
  matriculas: number
  avaliacoesAgendadas: number
}

interface Sessao {
  id: string
  chat: string
  store: Store
  google: AgendaSimulada
  servico: ServicoAgenda
  saida: string[]
  avisos: string[]
  ferramentas: string[]
  ultimaAtividade: number
  fila: Promise<unknown>
}

export class SalaDeTeste {
  private sessoes = new Map<string, Sessao>()

  constructor(
    private cfg: Config,
    private claude: ClienteClaude,
    private agora: () => number = Date.now,
  ) {}

  /** Configuração do teste: sem filtro de números, sem equipe, sem limite apertado. O resto é idêntico ao de verdade. */
  private get cfgTeste(): Config {
    return { ...this.cfg, numerosPermitidos: [], numerosAvisos: [], limiteMsgsPorHora: 500, google: undefined }
  }

  private varrer(): void {
    const t = this.agora()
    for (const [id, s] of this.sessoes) {
      if (t - s.ultimaAtividade > OCIOSA_MS) this.encerrar(id)
    }
    while (this.sessoes.size >= MAX_SESSOES) {
      const maisAntiga = [...this.sessoes.values()].sort((a, b) => a.ultimaAtividade - b.ultimaAtividade)[0]!
      this.encerrar(maisAntiga.id)
    }
  }

  private encerrar(id: string): void {
    const s = this.sessoes.get(id)
    if (!s) return
    this.sessoes.delete(id)
    try {
      s.store.fechar()
    } catch {
      // já fechado
    }
  }

  private criar(id: string): Sessao {
    this.varrer()
    const cfg = this.cfgTeste
    const store = new Store(':memory:')
    const google = new AgendaSimulada()
    const avisos: string[] = []
    const servico = new ServicoAgenda({
      store,
      agenda: carregarAgenda(cfg.agendaPath),
      mensagens: carregarMensagens(cfg.mensagensPath),
      notificar: async (t) => void avisos.push(t),
      google,
      agendaId: 'simulada',
      numeroRecepcao: cfg.numeroRecepcao,
      automatico: true,
      agora: () => new Date(this.agora()),
    })
    const s: Sessao = {
      id,
      chat: `5500${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`,
      store,
      google,
      servico,
      saida: [],
      avisos,
      ferramentas: [],
      ultimaAtividade: this.agora(),
      fila: Promise.resolve(),
    }
    this.sessoes.set(id, s)
    return s
  }

  private sessao(id: string): Sessao {
    const existente = this.sessoes.get(id)
    if (existente) return existente
    return this.criar(id)
  }

  /** Identificador novo para uma conversa de teste. */
  static novoId(): string {
    return randomUUID()
  }

  get total(): number {
    return this.sessoes.size
  }

  /** Recomeça do zero: apaga a conversa, a agenda simulada e os avisos. */
  reiniciar(id: string): void {
    this.encerrar(id)
    this.criar(id)
  }

  /** O cliente de teste escreve; devolve o que ele receberia e o que aconteceu nos bastidores. */
  enviar(id: string, texto: string): Promise<RespostaTeste> {
    const s = this.sessao(id)
    const tarefa = s.fila.then(() => this.processar(s, texto))
    s.fila = tarefa.catch(() => undefined)
    return tarefa
  }

  private async processar(s: Sessao, texto: string): Promise<RespostaTeste> {
    s.ultimaAtividade = this.agora()
    s.saida.length = 0
    const avisosAntes = s.avisos.length
    const ferramentasAntes = s.ferramentas.length

    const deps: AtendimentoDeps = {
      cfg: this.cfgTeste,
      store: s.store,
      claude: this.claude,
      notificar: async (t) => void s.avisos.push(t),
      agenda: s.servico,
      agora: () => new Date(this.agora()),
      wa: {
        async enviarTexto(_para, t) {
          s.saida.push(t)
        },
        async marcarLida() {},
      },
      avisarErro: async (_chave, t) => void s.avisos.push(`⚠️ ${t}`),
      pausaEntreMensagensMs: 0,
      aoUsarFerramenta: (linha) => void s.ferramentas.push(linha),
    }

    await tratarMensagem(deps, { wamid: `teste-${randomUUID()}`, from: s.chat, nome: '', tipo: 'text', texto })

    return {
      mensagens: [...s.saida],
      avisos: s.avisos.slice(avisosAntes),
      ferramentas: s.ferramentas.slice(ferramentasAntes),
      emSilencio: s.store.emHandoff(s.chat, this.agora()),
      matriculas: s.store.matriculas().length,
      avaliacoesAgendadas: s.google.total,
    }
  }
}
