import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Anthropic from '@anthropic-ai/sdk'
import type { AgenteDeps, ClienteClaude } from '../src/agent.js'
import { carregarAgenda, epochLocal } from '../src/agenda.js'
import { ServicoAgenda } from '../src/agendamento.js'
import { carregarConfig, type Config } from '../src/config.js'
import type { EventoAgenda, GoogleAgendaApi, NovoEvento } from '../src/google.js'
import { carregarMensagens } from '../src/mensagens.js'
import { Store } from '../src/store.js'

/** Sexta-feira, 16/10/2026, 09:00 em Brasília. A próxima segunda é 2026-10-19. */
export const AGORA = new Date('2026-10-16T12:00:00Z')
export const SEGUNDA = '2026-10-19'

export function pastaTemporaria(): string {
  return mkdtempSync(join(tmpdir(), 'academia-bot-'))
}

export function criarConfigDeTeste(extra: Record<string, string> = {}): Config {
  const pasta = pastaTemporaria()
  const instrucoes = join(pasta, 'instrucoes.md')
  writeFileSync(instrucoes, '# Academia Teste\nPlano único: R$ 100,00.')
  return carregarConfig({
    INSTRUCOES_PATH: instrucoes,
    DATA_DIR: pasta,
    LIMITE_MSGS_POR_HORA: '3',
    WHATSAPP_ACCESS_TOKEN: 'token',
    WHATSAPP_PHONE_NUMBER_ID: '111',
    WHATSAPP_VERIFY_TOKEN: 'verifica',
    WHATSAPP_APP_SECRET: 'segredo',
    ...extra,
  })
}

type RespostaFalsa = { content: unknown[]; stop_reason: string }

export function texto(t: string): RespostaFalsa {
  return { content: [{ type: 'text', text: t, citations: null }], stop_reason: 'end_turn' }
}

export function usarFerramenta(nome: string, input: Record<string, unknown>, id = 'toolu_2'): RespostaFalsa {
  return { content: [{ type: 'tool_use', id, name: nome, input }], stop_reason: 'tool_use' }
}

export function chamarHumano(motivo: string, textoJunto?: string): RespostaFalsa {
  return {
    content: [
      { type: 'thinking', thinking: '', signature: 'assinatura-de-teste' },
      ...(textoJunto ? [{ type: 'text', text: textoJunto, citations: null }] : []),
      { type: 'tool_use', id: 'toolu_1', name: 'chamar_humano', input: { motivo } },
    ],
    stop_reason: 'tool_use',
  }
}

/** Claude falso: devolve as respostas na ordem e guarda uma cópia de cada chamada recebida. */
export function claudeFalso(respostas: Array<RespostaFalsa | Error>) {
  const fila = [...respostas]
  const chamadas: Anthropic.MessageCreateParamsNonStreaming[] = []
  const claude: ClienteClaude = {
    messages: {
      async create(params) {
        chamadas.push(structuredClone(params))
        const proxima = fila.shift()
        if (!proxima) throw new Error('claude falso: sem resposta preparada')
        if (proxima instanceof Error) throw proxima
        return {
          id: 'msg_teste',
          type: 'message',
          role: 'assistant',
          model: params.model,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
          ...proxima,
        } as unknown as Anthropic.Message
      },
    },
  }
  return { claude, chamadas }
}

/** Google Agenda falso, em memória. */
export class GoogleFalso implements GoogleAgendaApi {
  eventos: EventoAgenda[] = []
  criados: Array<{ agendaId: string; evento: NovoEvento; id: string }> = []
  chamadas = { listar: 0, criar: 0, obter: 0 }
  falhar = false
  private contador = 0

  async listarEventos(_agendaId: string, desde: number, ate: number): Promise<EventoAgenda[]> {
    this.chamadas.listar++
    if (this.falhar) throw new Error('google fora do ar')
    return this.eventos.filter((e) => e.diaInteiro || (e.inicio! < ate && e.fim! > desde))
  }

  async criarEvento(agendaId: string, evento: NovoEvento): Promise<string> {
    this.chamadas.criar++
    if (this.falhar) throw new Error('google fora do ar')
    const id = `ev${++this.contador}`
    this.eventos.push({ id, titulo: evento.titulo, ocupa: true, inicio: evento.inicio, fim: evento.fim })
    this.criados.push({ agendaId, evento, id })
    return id
  }

  async obterEvento(_agendaId: string, eventoId: string): Promise<EventoAgenda | null> {
    this.chamadas.obter++
    if (this.falhar) throw new Error('google fora do ar')
    return this.eventos.find((e) => e.id === eventoId && e.ocupa) ?? null
  }

  /** Simula a equipe criando um evento à mão. */
  ocupar(dataISO: string, hhmm: string, minutos = 30, titulo = 'Avaliação — Fulano'): void {
    const inicio = epochLocal(dataISO, hhmm, 'America/Sao_Paulo')
    this.eventos.push({ id: `m${this.eventos.length}`, titulo, ocupa: true, inicio, fim: inicio + minutos * 60_000 })
  }

  /** Simula a equipe apagando um evento. */
  apagar(id: string): void {
    this.eventos = this.eventos.filter((e) => e.id !== id)
  }
}

export interface OpcoesServico {
  google?: GoogleFalso
  automatico?: boolean
  store?: Store
  capacidade?: number
  numeroRecepcao?: string
}

export function criarServico(opcoes: OpcoesServico = {}) {
  const store = opcoes.store ?? new Store(':memory:')
  const avisos: string[] = []
  const agenda = carregarAgenda('./agenda.json')
  if (opcoes.capacidade) agenda.capacidade = opcoes.capacidade
  const servico = new ServicoAgenda({
    store,
    agenda,
    mensagens: carregarMensagens('./mensagens.md'),
    notificar: async (t) => {
      avisos.push(t)
    },
    google: opcoes.google,
    agendaId: opcoes.google ? 'agenda-teste' : undefined,
    automatico: opcoes.automatico ?? true,
    numeroRecepcao: opcoes.numeroRecepcao,
    agora: () => AGORA,
  })
  return { servico, store, avisos, agenda }
}

export function criarDepsDeAgente(respostas: Array<RespostaFalsa | Error>, extraCfg: Record<string, string> = {}, opcoes: OpcoesServico = {}) {
  const cfg = criarConfigDeTeste(extraCfg)
  const store = opcoes.store ?? new Store(':memory:')
  const { claude, chamadas } = claudeFalso(respostas)
  const { servico, avisos } = criarServico({ ...opcoes, store, numeroRecepcao: cfg.numeroRecepcao })
  const deps: AgenteDeps = {
    cfg,
    store,
    claude,
    agenda: servico,
    notificar: async (t) => {
      avisos.push(t)
    },
    agora: () => AGORA,
  }
  return { deps, store, chamadas, avisos, cfg, servico }
}
