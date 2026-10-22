import type { EventoAgenda, GoogleAgendaApi, MudancaEvento, NovoEvento } from './google.js'

/**
 * Google Agenda de mentira, que vive só na memória. Serve para a página de teste: o assistente
 * "agenda" avaliações de verdade no fluxo, mas nada chega à agenda real da academia.
 */
export class AgendaSimulada implements GoogleAgendaApi {
  private eventos: EventoAgenda[] = []
  private contador = 0

  async listarEventos(_agendaId: string, desde: number, ate: number): Promise<EventoAgenda[]> {
    return this.eventos.filter((e) => e.diaInteiro || (e.inicio! < ate && e.fim! > desde))
  }

  async criarEvento(_agendaId: string, e: NovoEvento): Promise<string> {
    const id = `simulado${++this.contador}`
    this.eventos.push({ id, titulo: e.titulo, ocupa: true, inicio: e.inicio, fim: e.fim, descricao: e.descricao, ...(e.privado ? { privado: { ...e.privado } } : {}) })
    return id
  }

  async obterEvento(_agendaId: string, eventoId: string): Promise<EventoAgenda | null> {
    return this.eventos.find((e) => e.id === eventoId && e.ocupa) ?? null
  }

  async removerEvento(_agendaId: string, eventoId: string): Promise<void> {
    this.eventos = this.eventos.filter((e) => e.id !== eventoId)
  }

  async moverEvento(_agendaId: string, eventoId: string, m: MudancaEvento): Promise<void> {
    const e = this.eventos.find((x) => x.id === eventoId)
    if (!e) return
    e.inicio = m.inicio
    e.fim = m.fim
    if (m.descricao !== undefined) e.descricao = m.descricao
    if (m.privado) e.privado = { ...e.privado, ...m.privado }
  }

  /** Quantos eventos "agendados" existem nesta conversa de teste. */
  get total(): number {
    return this.eventos.length
  }
}
