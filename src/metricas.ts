import type { EstadoWhatsapp } from './baileys.js'
import { diaDaSemana, epochLocal, horariosDoDia, hojeISO, somarDias, type DiaSemana } from './agenda.js'
import type { ServicoAgenda } from './agendamento.js'
import { normalizarNumero, type Config } from './config.js'
import { ehAvaliacao, nomeDoCliente, segundaDaSemana, whatsappDoEvento } from './painel-agenda.js'
import { calcularStatus, type Status } from './status.js'
import type { Comparecimento, EventoRegistrado, MatriculaSalva, StatusComparecimento, Store } from './store.js'
import type { EventoAgenda } from './google.js'

/**
 * Os números do painel do dono. Tudo aqui só LÊ: da agenda do Google (todas as avaliações, não só as que o
 * assistente marcou) e do banco do bot. Nada muda o atendimento.
 */

export type OrigemAvaliacao = 'bot' | 'recepcao' | 'professores' | 'agenda'

export const ROTULO_ORIGEM: Record<OrigemAvaliacao, string> = {
  bot: 'Assistente (WhatsApp)',
  recepcao: 'Recepção (lista)',
  professores: 'Página dos professores',
  agenda: 'Direto na agenda do Google',
}

/** Há quantos minutos um cliente esperando a equipe vira alerta. */
export const ESPERA_ALERTA_MIN = 15
/** O WhatsApp está conectado e um cliente ficou tanto tempo sem resposta: o bot pode estar mudo. */
export const MUDO_APOS_MIN = 10
const CACHE_AGENDA_MS = 60_000
const MOTIVO_DA_EQUIPE = /^(Transferido pela equipe|A equipe respondeu)/

/** Preço por milhão de tokens, em dólar (entrada, saída). Tabela cacheada: confira em anthropic.com/pricing. */
const PRECOS: Record<string, { entrada: number; saida: number }> = {
  'claude-haiku-5-5': { entrada: 0.1, saida: 0.5 },
  'claude-sonnet-5-5': { entrada: 2, saida: 10 },
  'claude-opus-5-5': { entrada: 4, saida: 20 },
}
const PRECO_DESCONHECIDO = { entrada: 5, saida: 25 } // na dúvida, estima para cima

export interface AvaliacaoInfo {
  id: string
  cliente: string
  whatsapp?: string
  inicio: number
  origem: OrigemAvaliacao
  marcadoPor: string
  comparecimento?: StatusComparecimento
}

export interface Contagem {
  total: number
  feitas: number
  aVir: number
}

export interface CustoIa {
  chamadas: number
  usd: number
  reais: number
}

export interface ResumoPainel {
  geradoEm: number
  agenda: { ligada: boolean; erro?: string }
  mesRotulo: string
  hoje: AvaliacaoInfo[]
  proximas: AvaliacaoInfo[]
  semana: Contagem
  mes: Contagem
  porOrigem: Array<{ origem: OrigemAvaliacao; rotulo: string; total: number }>
  porDiaSemana: Array<{ dia: DiaSemana; rotulo: string; total: number }>
  porHorario: Array<{ hhmm: string; total: number }>
  ocupacao: { dias: number; total: number; ocupados: number; livres: number; percentual: number }
  funil: { conversas: number; avaliacoesPeloBot: number; avaliacoes: number; matriculasPeloBot: number; avaliacoesQueMatricularam: number }
  comparecimento: {
    veio: number
    faltou: number
    matriculou: number
    semMarcar: AvaliacaoInfo[]
    /** faltou ÷ (veio + faltou + matriculou), ou undefined sem dados. */
    taxaFalta?: number
    /** matriculou ÷ (veio + matriculou), ou undefined sem dados. */
    taxaConversao?: number
  }
  pendentes: MatriculaSalva[]
  espera: Array<{ chat: string; minutos: number; motivo: string; alerta: boolean }>
  bot: {
    conversasNoMes: number
    conversasQueChamaramEquipe: number
    /** Conversas do mês que o bot resolveu sozinho, em %, ou undefined sem conversas. */
    resolvidasPct?: number
    semResposta: EventoRegistrado[]
    mensagensPorHora: number[]
  }
  custo: { hoje: CustoIa; mes: CustoIa; projecaoMesReais: number; limiteReais: number; percentualDoLimite?: number; porConversaReais?: number; precoEstimado: boolean }
  saude: { whatsapp: Status; ultimaMensagemCliente?: number; ultimaRespostaBot?: number; mudo: boolean; clientesSemResposta: number }
}

export function origemDe(e: EventoAgenda): OrigemAvaliacao {
  const origem = e.privado?.origem
  if (origem === 'assistente-whatsapp') return 'bot'
  if (origem === 'painel-professores') return /^recep/i.test(e.privado?.marcadoPor ?? '') ? 'recepcao' : 'professores'
  return 'agenda'
}

function marcadoPorDe(e: EventoAgenda): string {
  if (e.privado?.marcadoPor) return e.privado.marcadoPor
  return origemDe(e) === 'bot' ? 'Assistente (WhatsApp)' : ''
}

/** Hora cheia (0 a 23) no fuso da academia. */
function horaLocal(ms: number, fuso: string): number {
  const h = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: fuso }).format(new Date(ms))
  return Number(h) % 24
}

function hhmmLocal(ms: number, fuso: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: fuso }).format(new Date(ms)).replace(/^24/, '00')
}

const DIAS_ORDEM: DiaSemana[] = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom']
const ROTULO_DIA: Record<DiaSemana, string> = { seg: 'Segunda', ter: 'Terça', qua: 'Quarta', qui: 'Quinta', sex: 'Sexta', sab: 'Sábado', dom: 'Domingo' }

/** Início do mês seguinte (AAAA-MM-DD) ao da data. */
function proximoMes(dataISO: string): string {
  const [y, m] = dataISO.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
}

function diasNoMes(dataISO: string): number {
  const [y, m] = dataISO.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function custoEmReais(
  uso: { entrada: number; saida: number; cacheLeitura: number; cacheEscrita: number },
  preco: { entrada: number; saida: number },
  dolarEmReais: number,
): { usd: number; reais: number } {
  const usd = (uso.entrada * preco.entrada + uso.cacheLeitura * preco.entrada * 0.1 + uso.cacheEscrita * preco.entrada * 1.25 + uso.saida * preco.saida) / 1_000_000
  return { usd, reais: usd * dolarEmReais }
}

export interface MetricasDeps {
  store: Store
  cfg: Config
  servico: ServicoAgenda
  /** Estado da conexão do WhatsApp (só existe no modo QR). */
  estado?: () => EstadoWhatsapp | undefined
  /** Quanto tempo a leitura do Google Agenda fica guardada (os testes usam 0). */
  cacheMs?: number
}

export class Metricas {
  private cache?: { chave: string; ate: number; eventos: EventoAgenda[] }

  constructor(private d: MetricasDeps) {}

  private get fuso(): string {
    return this.d.servico.regras.fusoHorario
  }

  private agora(): number {
    return this.d.servico.agora().getTime()
  }

  /** Eventos do Google no período, com guarda de 1 minuto (o painel recarrega à vontade sem martelar o Google). */
  private async eventos(de: number, ate: number): Promise<EventoAgenda[]> {
    const g = this.d.servico.googleAgenda
    if (!g) return []
    const chave = `${de}-${ate}`
    const t = Date.now()
    if (this.cache && this.cache.chave === chave && this.cache.ate > t) return this.cache.eventos
    const eventos = await g.api.listarEventos(g.agendaId, de, ate)
    this.cache = { chave, ate: t + (this.d.cacheMs ?? CACHE_AGENDA_MS), eventos }
    return eventos
  }

  /** Esquece a leitura guardada (depois de marcar algo, para o painel já mostrar). */
  esquecerCache(): void {
    this.cache = undefined
  }

  private paraAvaliacao(e: EventoAgenda, comp: Map<string, Comparecimento>): AvaliacaoInfo {
    const whatsapp = whatsappDoEvento(e)
    return {
      id: e.id,
      cliente: nomeDoCliente(e.titulo) || 'Cliente',
      ...(whatsapp ? { whatsapp } : {}),
      inicio: e.inicio!,
      origem: origemDe(e),
      marcadoPor: marcadoPorDe(e),
      ...(comp.get(e.id) ? { comparecimento: comp.get(e.id)!.status } : {}),
    }
  }

  async resumo(): Promise<ResumoPainel> {
    const { store, cfg, servico } = this.d
    const regras = servico.regras
    const agora = this.agora()
    const hoje = hojeISO(servico.agora(), this.fuso)
    const mesIni = `${hoje.slice(0, 7)}-01`
    const mesFim = proximoMes(hoje)
    const segunda = segundaDaSemana(hoje)
    const semanaFim = somarDias(segunda, 7)
    const horizonteFim = somarDias(hoje, regras.diasMaximoFuturo + 1)

    const ini = epochLocal(mesIni < segunda ? mesIni : segunda, '00:00', this.fuso)
    const fimDia = [mesFim, semanaFim, horizonteFim].sort().at(-1)!
    const fim = epochLocal(fimDia, '00:00', this.fuso)
    const msMesIni = epochLocal(mesIni, '00:00', this.fuso)
    const msMesFim = epochLocal(mesFim, '00:00', this.fuso)
    const msSemIni = epochLocal(segunda, '00:00', this.fuso)
    const msSemFim = epochLocal(semanaFim, '00:00', this.fuso)
    const msHoje = epochLocal(hoje, '00:00', this.fuso)
    const msAmanha = epochLocal(somarDias(hoje, 1), '00:00', this.fuso)

    // --- agenda ---
    let eventos: EventoAgenda[] = []
    const agenda: ResumoPainel['agenda'] = { ligada: servico.googleAgenda !== undefined }
    if (agenda.ligada) {
      try {
        eventos = await this.eventos(ini, fim)
      } catch (err) {
        agenda.erro = err instanceof Error ? err.message : String(err)
        console.error('[painel] não consegui ler o Google Agenda:', agenda.erro)
      }
    }
    const brutas = eventos.filter((e) => e.ocupa && !e.diaInteiro && e.inicio !== undefined && ehAvaliacao(e.titulo))
    const comp = store.comparecimentoDe(brutas.map((e) => e.id))
    const todas = brutas.map((e) => this.paraAvaliacao(e, comp)).sort((a, b) => a.inicio - b.inicio)
    const noPeriodo = (de: number, ate: number) => todas.filter((a) => a.inicio >= de && a.inicio < ate)
    const contar = (lista: AvaliacaoInfo[]): Contagem => {
      const feitas = lista.filter((a) => a.inicio < agora).length
      return { total: lista.length, feitas, aVir: lista.length - feitas }
    }
    const doMes = noPeriodo(msMesIni, msMesFim)

    const porOrigem = (Object.keys(ROTULO_ORIGEM) as OrigemAvaliacao[])
      .map((origem) => ({ origem, rotulo: ROTULO_ORIGEM[origem], total: doMes.filter((a) => a.origem === origem).length }))
      .filter((o) => o.total > 0)
    const porDiaSemana = DIAS_ORDEM.map((dia) => ({
      dia,
      rotulo: ROTULO_DIA[dia],
      total: doMes.filter((a) => diaDaSemana(new Intl.DateTimeFormat('en-CA', { timeZone: this.fuso }).format(new Date(a.inicio))) === dia).length,
    })).filter((d) => d.total > 0)
    const horarios = new Map<string, number>()
    for (const a of doMes) {
      const h = hhmmLocal(a.inicio, this.fuso)
      horarios.set(h, (horarios.get(h) ?? 0) + 1)
    }
    const porHorario = [...horarios].map(([hhmm, total]) => ({ hhmm, total })).sort((a, b) => a.hhmm.localeCompare(b.hhmm))

    // --- ocupação da grade nos próximos dias (usa TODOS os eventos que ocupam horário, como o bot) ---
    let total = 0
    let ocupados = 0
    for (let i = 0; i < regras.diasMaximoFuturo; i++) {
      const dia = somarDias(hoje, i)
      if (regras.diasFechados.includes(dia) || servico.diaFechado(dia, eventos)) continue
      for (const hhmm of horariosDoDia(regras, dia)) {
        const inicio = epochLocal(dia, hhmm, this.fuso)
        if (inicio < agora) continue
        total += regras.capacidade
        ocupados += Math.min(regras.capacidade, eventos.filter((e) => e.ocupa && e.inicio !== undefined && e.fim !== undefined && e.inicio < inicio + regras.duracaoMin * 60_000 && e.fim > inicio).length)
      }
    }

    // --- funil e comparecimento ---
    const conversas = store.conversasNovas(msMesIni, msMesFim)
    const matriculasMes = store.contarMatriculas(msMesIni, msMesFim)
    const numerosMatriculados = new Set(store.matriculas(500).flatMap((m) => [normalizarNumero(m.telefone), normalizarNumero(m.chat)]))
    const queMatricularam = doMes.filter((a) => a.whatsapp && numerosMatriculados.has(normalizarNumero(a.whatsapp))).length
    const marcasMes = doMes.filter((a) => a.comparecimento)
    const veio = marcasMes.filter((a) => a.comparecimento === 'veio').length
    const faltou = marcasMes.filter((a) => a.comparecimento === 'faltou').length
    const matriculou = marcasMes.filter((a) => a.comparecimento === 'matriculou').length
    const base = veio + faltou + matriculou
    const compareceu = veio + matriculou
    const semMarcar = todas.filter((a) => a.inicio < agora - 3_600_000 && a.inicio >= agora - 14 * 86_400_000 && !a.comparecimento)

    // --- conversas, equipe e bot ---
    const espera = store
      .handoffsParaAcompanhar(agora)
      .filter((h) => !MOTIVO_DA_EQUIPE.test(h.motivo))
      .map((h) => {
        const minutos = Math.max(0, Math.floor((agora - h.ts) / 60_000))
        return { chat: h.chat, minutos, motivo: h.motivo, alerta: minutos >= ESPERA_ALERTA_MIN }
      })
    const chamaramEquipe = Math.min(conversas, store.contarChatsComEvento('transferencia', msMesIni, msMesFim))
    const mensagensPorHora = Array.from({ length: 24 }, () => 0)
    for (const ts of store.mensagensDosClientes(agora - 30 * 86_400_000)) mensagensPorHora[horaLocal(ts, this.fuso)]!++

    // --- custo ---
    const preco = cfg.precosIa ?? PRECOS[cfg.model] ?? PRECO_DESCONHECIDO
    const custo = (desde: number, ate: number): CustoIa => {
      const u = store.somaUsoIa(desde, ate)
      return { chamadas: u.chamadas, ...custoEmReais(u, preco, cfg.dolarEmReais) }
    }
    const custoMes = custo(msMesIni, msMesFim)
    const diaDoMes = Number(hoje.slice(8, 10))
    const projecao = (custoMes.reais / diaDoMes) * diasNoMes(hoje)

    // --- saúde ---
    const whatsapp = calcularStatus(this.d.estado?.(), agora, cfg.toleranciaQuedaMin)
    const semResposta = store.clientesSemResposta(agora - 6 * 3_600_000, agora - MUDO_APOS_MIN * 60_000, agora)
    const pausado = store.pausa(agora) !== undefined
    const [pri, ult] = [store.ultimaMensagem('user'), store.ultimaMensagem('assistant')]

    return {
      geradoEm: agora,
      agenda,
      mesRotulo: new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${mesIni}T00:00:00Z`)),
      hoje: noPeriodo(msHoje, msAmanha),
      proximas: todas.filter((a) => a.inicio >= agora && a.inicio < epochLocal(somarDias(hoje, 15), '00:00', this.fuso)),
      semana: contar(noPeriodo(msSemIni, msSemFim)),
      mes: contar(doMes),
      porOrigem,
      porDiaSemana,
      porHorario,
      ocupacao: { dias: regras.diasMaximoFuturo, total, ocupados, livres: total - ocupados, percentual: total > 0 ? Math.round((ocupados / total) * 100) : 0 },
      funil: { conversas, avaliacoesPeloBot: store.contarEventos('avaliacao_bot', msMesIni, msMesFim), avaliacoes: doMes.length, matriculasPeloBot: matriculasMes, avaliacoesQueMatricularam: queMatricularam },
      comparecimento: {
        veio,
        faltou,
        matriculou,
        semMarcar,
        ...(base > 0 ? { taxaFalta: Math.round((faltou / base) * 100) } : {}),
        ...(compareceu > 0 ? { taxaConversao: Math.round((matriculou / compareceu) * 100) } : {}),
      },
      pendentes: store.matriculas(200).filter((m) => m.lancadaEm === null),
      espera,
      bot: {
        conversasNoMes: conversas,
        conversasQueChamaramEquipe: chamaramEquipe,
        ...(conversas > 0 ? { resolvidasPct: Math.round(((conversas - chamaramEquipe) / conversas) * 100) } : {}),
        semResposta: store.eventosRecentes('sem_resposta', 30, agora - 30 * 86_400_000),
        mensagensPorHora,
      },
      custo: {
        hoje: custo(msHoje, msAmanha),
        mes: custoMes,
        projecaoMesReais: projecao,
        limiteReais: cfg.gastoLimiteMensalReais,
        ...(cfg.gastoLimiteMensalReais > 0 ? { percentualDoLimite: Math.round((custoMes.reais / cfg.gastoLimiteMensalReais) * 100) } : {}),
        ...(conversas > 0 ? { porConversaReais: custoMes.reais / conversas } : {}),
        precoEstimado: cfg.precosIa === undefined && PRECOS[cfg.model] === undefined,
      },
      saude: {
        whatsapp,
        ...(pri !== undefined ? { ultimaMensagemCliente: pri } : {}),
        ...(ult !== undefined ? { ultimaRespostaBot: ult } : {}),
        mudo: whatsapp.ok && whatsapp.estado !== 'cloud' && !pausado && semResposta.length > 0,
        clientesSemResposta: semResposta.length,
      },
    }
  }
}
