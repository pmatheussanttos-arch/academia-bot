import { NOME_PERIODO, diaDaSemana, epochLocal, horariosDoDia, hojeISO, limitesDoDia, periodoDe, rotulo, somarDias, dataExiste, type Periodo } from './agenda.js'
import type { ServicoAgenda } from './agendamento.js'
import type { EventoAgenda, GoogleAgendaApi } from './google.js'
import { limparNome } from './prompt.js'
import type { Comparecimento, StatusComparecimento, Store } from './store.js'

/**
 * Agenda dos professores: ver a semana, marcar, desmarcar e remarcar avaliações na MESMA agenda do Google que o bot usa,
 * com as mesmas regras do agenda.json (janelas, grade de 30 minutos, feriados). Usa a mesma trava do bot, então uma marcação
 * de professor e uma do assistente nunca ficam com o mesmo horário.
 */

/** Erro com texto próprio para o professor ver na tela. */
export class ErroPainel extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
    readonly codigo: string,
  ) {
    super(mensagem)
  }
}

/** Marcar com mais de ~6 meses de antecedência é quase sempre erro de digitação. */
export const DIAS_MAXIMO_PAINEL = 180

export interface Ocupante {
  id: string
  titulo: string
  /** Só eventos cujo título começa com "Avaliação" podem ser desmarcados ou remarcados aqui. */
  ehAvaliacao: boolean
  cliente: string
  /** Só dígitos, com 55. */
  whatsapp?: string
  /** Professor que marcou, "Assistente (WhatsApp)" ou vazio (criado direto no Google Agenda). */
  marcadoPor: string
  inicio: number
  fim: number
  /** O que a equipe anotou depois da avaliação (veio, faltou ou matriculou). */
  comparecimento?: StatusComparecimento
}

export type EstadoSlot = 'livre' | 'ocupado' | 'passado' | 'fechado'

export interface SlotPainel {
  hhmm: string
  inicio: number
  periodo?: Periodo
  estado: EstadoSlot
  ocupantes: Ocupante[]
  /** Dá para desmarcar/remarcar: é uma avaliação que ainda não começou. */
  podeAlterar: boolean
  /** Dá para anotar se o cliente veio: é uma avaliação que já começou. */
  podeAnotar: boolean
}

export interface DiaPainel {
  data: string
  /** Ex.: "Quinta-feira, 22/10" */
  rotulo: string
  curto: string
  hoje: boolean
  /** Se o dia está fechado (feriado), o motivo. */
  fechado?: string
  slots: SlotPainel[]
}

export interface SemanaPainel {
  inicio: string
  anterior: string
  proxima: string
  rotulo: string
  hoje: string
  agora: number
  dias: DiaPainel[]
  nomesPeriodos: Record<Periodo, string>
}

export interface PedidoMarcar {
  data: string
  hhmm: string
  nome: string
  whatsapp: string
  obs?: string
  professor: string
}

export interface ResultadoAcao {
  /** Frase pronta para mostrar na tela. */
  mensagem: string
  /** Horário (data e hora) que ficou livre, no caso de desmarcar ou remarcar. */
  liberado?: { data: string; hhmm: string }
}

const SEM_ACENTO = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** "Avaliação — Maria" e variações ("avaliacao - Maria") são avaliações; "Reunião" e "FECHADO" não são. */
export function ehAvaliacao(titulo: string): boolean {
  return /^avaliacao(?=$|[\s—–-])/i.test(SEM_ACENTO(titulo.trim()))
}

export function nomeDoCliente(titulo: string): string {
  const m = /^avalia[cç][aã]o\s*[—–-]\s*(.+)$/i.exec(titulo.trim())
  return m ? m[1]!.trim() : ''
}

/** WhatsApp do cliente, das marcas internas do evento ou da linha "WhatsApp: +55…" da descrição. */
export function whatsappDoEvento(e: EventoAgenda): string | undefined {
  const marca = e.privado?.whatsapp?.replace(/\D/g, '')
  if (marca) return marca
  const m = /WhatsApp:\s*\+?([0-9][0-9 ()-]{7,})/i.exec(e.descricao ?? '')
  const digitos = m?.[1]?.replace(/\D/g, '')
  return digitos || undefined
}

function quemMarcou(e: EventoAgenda): string {
  if (e.privado?.marcadoPor) return e.privado.marcadoPor
  if (e.privado?.origem === 'assistente-whatsapp') return 'Assistente (WhatsApp)'
  return ''
}

/** WhatsApp digitado pelo professor → só dígitos com 55; erro de texto claro se não parecer um telefone brasileiro. */
export function normalizarWhatsapp(bruto: string): string {
  let n = bruto.replace(/\D/g, '')
  if (n.length === 10 || n.length === 11) n = `55${n}`
  if (!/^55\d{10,11}$/.test(n)) throw new ErroPainel('WhatsApp inválido: informe o DDD e o número, por exemplo (11) 99999-8888.', 400, 'whatsapp_invalido')
  return n
}

const INDICE_DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']

/** Segunda-feira da semana que contém a data. */
export function segundaDaSemana(dataISO: string): string {
  const i = INDICE_DIA.indexOf(diaDaSemana(dataISO))
  return somarDias(dataISO, -((i + 6) % 7))
}

export class PainelAgenda {
  constructor(
    private servico: ServicoAgenda,
    private store: Store,
  ) {}

  private get google(): { api: GoogleAgendaApi; agendaId: string } {
    const g = this.servico.googleAgenda
    if (!g) throw new ErroPainel('O Google Agenda não está ligado no bot.', 503, 'google_desligado')
    return g
  }

  private get regras() {
    return this.servico.regras
  }

  private agoraMs(): number {
    return this.servico.agora().getTime()
  }

  private hoje(): string {
    return hojeISO(this.servico.agora(), this.regras.fusoHorario)
  }

  private ocupante(e: EventoAgenda, marcas: Map<string, Comparecimento>): Ocupante {
    const avaliacao = ehAvaliacao(e.titulo)
    return {
      id: e.id,
      titulo: e.titulo,
      ehAvaliacao: avaliacao,
      cliente: avaliacao ? nomeDoCliente(e.titulo) || 'Cliente' : e.titulo || '(sem título)',
      whatsapp: avaliacao ? whatsappDoEvento(e) : undefined,
      marcadoPor: avaliacao ? quemMarcou(e) : '',
      inicio: e.inicio!,
      fim: e.fim!,
      ...(avaliacao && marcas.get(e.id) ? { comparecimento: marcas.get(e.id)!.status } : {}),
    }
  }

  /** Motivo de o dia estar fechado (feriado em diasFechados ou evento de dia inteiro "Fechado"), ou undefined. */
  private motivoFechado(dataISO: string, eventos: EventoAgenda[]): string | undefined {
    if (this.regras.diasFechados.includes(dataISO)) return 'Fechado (feriado)'
    if (this.servico.diaFechado(dataISO, eventos)) {
      const e = eventos.find((x) => x.ocupa && x.diaInteiro && x.diaInteiro.de <= dataISO && dataISO < x.diaInteiro.ate && /fechad/i.test(x.titulo))
      return e?.titulo || 'Fechado'
    }
    return undefined
  }

  /** A grade da semana que contém `data` (segunda a domingo, só os dias que têm horários), com o estado de cada horário. */
  async semana(data: string): Promise<SemanaPainel> {
    const { api, agendaId } = this.google
    const regras = this.regras
    const hoje = this.hoje()
    const ref = dataExiste(data) ? data : hoje
    const segunda = segundaDaSemana(ref)
    const eventos = await api.listarEventos(agendaId, epochLocal(segunda, '00:00', regras.fusoHorario), epochLocal(somarDias(segunda, 7), '00:00', regras.fusoHorario))
    const agora = this.agoraMs()
    const marcas = this.store.comparecimentoDe(eventos.filter((e) => ehAvaliacao(e.titulo)).map((e) => e.id))

    const dias: DiaPainel[] = []
    for (let i = 0; i < 7; i++) {
      const dataDia = somarDias(segunda, i)
      const todos = horariosDoDia(regras, dataDia)
      if (todos.length === 0) continue
      const fechado = this.motivoFechado(dataDia, eventos)
      const [, m, d] = dataDia.split('-')
      const slots: SlotPainel[] = todos.map((hhmm) => {
        const inicio = epochLocal(dataDia, hhmm, regras.fusoHorario)
        const fim = inicio + regras.duracaoMin * 60_000
        const ocupantes = eventos
          .filter((e) => e.ocupa && e.inicio !== undefined && e.fim !== undefined && e.inicio < fim && e.fim > inicio)
          .map((e) => this.ocupante(e, marcas))
        const cheio = ocupantes.length >= regras.capacidade
        const estado: EstadoSlot = fechado ? 'fechado' : cheio ? 'ocupado' : inicio <= agora ? 'passado' : 'livre'
        const alteravel = ocupantes.find((o) => o.ehAvaliacao)
        return {
          hhmm,
          inicio,
          periodo: periodoDe(regras, hhmm),
          estado,
          ocupantes,
          podeAlterar: estado === 'ocupado' && alteravel !== undefined && inicio > agora,
          podeAnotar: estado === 'ocupado' && alteravel !== undefined && inicio <= agora,
        }
      })
      dias.push({ data: dataDia, rotulo: rotulo(epochLocal(dataDia, '12:00', regras.fusoHorario), regras.fusoHorario).dia, curto: `${d}/${m}`, hoje: dataDia === hoje, ...(fechado ? { fechado } : {}), slots })
    }
    const primeiro = dias[0]?.curto ?? ''
    const ultimo = dias.at(-1)?.curto ?? ''
    return {
      inicio: segunda,
      anterior: somarDias(segunda, -7),
      proxima: somarDias(segunda, 7),
      rotulo: primeiro && ultimo ? `${primeiro} a ${ultimo}` : segunda,
      hoje,
      agora,
      dias,
      nomesPeriodos: NOME_PERIODO,
    }
  }

  /** Confere que o horário existe na grade e não passou. Os feriados e a agenda do Google são conferidos dentro da trava. */
  private validarSlot(dataISO: string, hhmm: string): { hhmm: string; inicio: number } {
    const regras = this.regras
    if (!dataExiste(dataISO)) throw new ErroPainel('Data inválida.', 400, 'data_invalida')
    const hoje = this.hoje()
    if (dataISO < hoje) throw new ErroPainel('Esse dia já passou.', 400, 'passado')
    if (dataISO > somarDias(hoje, DIAS_MAXIMO_PAINEL)) throw new ErroPainel(`Só dá para marcar com até ${DIAS_MAXIMO_PAINEL} dias de antecedência.`, 400, 'muito_longe')
    if (regras.diasFechados.includes(dataISO)) throw new ErroPainel('Esse dia está fechado (feriado).', 400, 'fechado')
    if (horariosDoDia(regras, dataISO).length === 0) throw new ErroPainel('Não há avaliações nesse dia da semana.', 400, 'fora_da_grade')
    if (!horariosDoDia(regras, dataISO).includes(hhmm)) throw new ErroPainel('Esse horário não existe na grade de avaliações.', 400, 'fora_da_grade')
    const inicio = epochLocal(dataISO, hhmm, regras.fusoHorario)
    if (inicio <= this.agoraMs()) throw new ErroPainel('Esse horário já passou.', 400, 'passado')
    return { hhmm, inicio }
  }

  /** Relê a agenda NA HORA de gravar: se alguém ocupou o horário, avisa em vez de marcar por cima. */
  private async conferirLivre(dataISO: string, slot: { inicio: number }, ignorarEvento?: string): Promise<void> {
    const { api, agendaId } = this.google
    const { de, ate } = limitesDoDia(this.regras, dataISO)
    const eventos = (await api.listarEventos(agendaId, de, ate)).filter((e) => e.id !== ignorarEvento)
    const fechado = this.motivoFechado(dataISO, eventos)
    if (fechado) throw new ErroPainel(`Esse dia está marcado como fechado na agenda (${fechado}).`, 409, 'fechado')
    if (this.servico.ocupado({ hhmm: '', inicio: slot.inicio }, eventos)) {
      const fim = slot.inicio + this.regras.duracaoMin * 60_000
      const quem = eventos.find((e) => e.ocupa && e.inicio !== undefined && e.fim !== undefined && e.inicio < fim && e.fim > slot.inicio)
      const nome = quem ? (ehAvaliacao(quem.titulo) ? nomeDoCliente(quem.titulo) || 'outro cliente' : quem.titulo) : 'outra pessoa'
      throw new ErroPainel(`Esse horário acabou de ser ocupado (${nome}). Escolha outro.`, 409, 'ocupado')
    }
  }

  private quando(inicio: number): string {
    const r = rotulo(inicio, this.regras.fusoHorario)
    return `${r.dia} às ${r.hora}`
  }

  private async umaAvaliacao(eventoId: string): Promise<EventoAgenda> {
    const { api, agendaId } = this.google
    const ev = await api.obterEvento(agendaId, eventoId)
    if (!ev) throw new ErroPainel('Esse evento não existe mais na agenda. A tela vai atualizar.', 404, 'nao_existe')
    if (!ehAvaliacao(ev.titulo) || ev.inicio === undefined || ev.fim === undefined || ev.diaInteiro) {
      throw new ErroPainel('Só dá para mudar eventos de avaliação ("Avaliação — Nome"). Este não pode ser alterado aqui.', 403, 'nao_e_avaliacao')
    }
    if (ev.inicio <= this.agoraMs()) throw new ErroPainel('Essa avaliação já começou ou já passou e não pode ser alterada aqui.', 400, 'passado')
    return ev
  }

  private traduzir(err: unknown): never {
    if (err instanceof ErroPainel) throw err
    console.error('[agenda-professores] erro no Google Agenda:', err instanceof Error ? err.message : err)
    throw new ErroPainel('Não consegui falar com o Google Agenda agora. Nada foi alterado. Tente de novo em instantes.', 502, 'google')
  }

  async marcar(p: PedidoMarcar): Promise<ResultadoAcao> {
    const nome = limparNome(p.nome)
    if (!nome) throw new ErroPainel('Informe o nome do cliente.', 400, 'nome')
    const whatsapp = normalizarWhatsapp(p.whatsapp)
    const obs = (p.obs ?? '').replace(/[\r\t]+/g, ' ').trim().slice(0, 300)
    const slot = this.validarSlot(p.data, p.hhmm)

    return this.servico
      .exclusivo(async () => {
        await this.conferirLivre(p.data, slot)
        const { api, agendaId } = this.google
        const eventoId = await api.criarEvento(agendaId, {
          titulo: `Avaliação — ${nome}`,
          descricao: [`WhatsApp: +${whatsapp}`, ...(obs ? [`Obs.: ${obs}`] : []), '', `Marcado por ${p.professor} na agenda dos professores.`].join('\n'),
          inicio: slot.inicio,
          fim: slot.inicio + this.regras.duracaoMin * 60_000,
          fuso: this.regras.fusoHorario,
          privado: { origem: 'painel-professores', whatsapp, marcadoPor: p.professor },
        })
        const quando = this.quando(slot.inicio)
        // O bot passa a saber que esse cliente já tem avaliação (não marca outra) e a dizer o horário certo.
        this.store.registrarAgendamento({ chat: whatsapp, eventoId, inicio: slot.inicio, nome }, this.agoraMs())
        this.store.registrarAcaoAgenda({ professor: p.professor, acao: 'marcou', eventoId, cliente: nome, whatsapp, detalhe: quando }, this.agoraMs())
        console.log(`[agenda-professores] ${p.professor} marcou avaliação de ${nome} para ${quando}`)
        return { mensagem: `Avaliação de ${nome} marcada para ${quando}.` }
      })
      .catch((e) => this.traduzir(e))
  }

  async desmarcar(eventoId: string, professor: string): Promise<ResultadoAcao> {
    return this.servico
      .exclusivo(async () => {
        const ev = await this.umaAvaliacao(eventoId)
        const { api, agendaId } = this.google
        await api.removerEvento(agendaId, eventoId)
        this.store.cancelarAgendamentoDoEvento(eventoId)
        const cliente = nomeDoCliente(ev.titulo) || 'Cliente'
        const whatsapp = whatsappDoEvento(ev) ?? ''
        const quando = this.quando(ev.inicio!)
        const r = rotulo(ev.inicio!, this.regras.fusoHorario)
        this.store.registrarAcaoAgenda({ professor, acao: 'desmarcou', eventoId, cliente, whatsapp, detalhe: quando }, this.agoraMs())
        console.log(`[agenda-professores] ${professor} desmarcou a avaliação de ${cliente} (${quando})`)
        const data = new Intl.DateTimeFormat('en-CA', { timeZone: this.regras.fusoHorario }).format(new Date(ev.inicio!))
        return { mensagem: `Avaliação de ${cliente} desmarcada. O horário de ${r.dia} às ${r.hora} voltou a ficar livre.`, liberado: { data, hhmm: r.hora } }
      })
      .catch((e) => this.traduzir(e))
  }

  async remarcar(p: { eventoId: string; data: string; hhmm: string; professor: string }): Promise<ResultadoAcao> {
    const slot = this.validarSlot(p.data, p.hhmm)
    return this.servico
      .exclusivo(async () => {
        const ev = await this.umaAvaliacao(p.eventoId)
        if (ev.inicio === slot.inicio) throw new ErroPainel('A avaliação já está nesse horário.', 400, 'mesmo_horario')
        await this.conferirLivre(p.data, slot, p.eventoId) // o próprio evento não conta como ocupando o novo horário
        const { api, agendaId } = this.google
        const duracao = ev.fim! - ev.inicio!
        const antes = this.quando(ev.inicio!)
        const depois = this.quando(slot.inicio)
        const r = rotulo(ev.inicio!, this.regras.fusoHorario)
        const dataAntes = new Intl.DateTimeFormat('en-CA', { timeZone: this.regras.fusoHorario }).format(new Date(ev.inicio!))
        const agoraR = rotulo(this.agoraMs(), this.regras.fusoHorario)
        await api.moverEvento(agendaId, p.eventoId, {
          inicio: slot.inicio,
          fim: slot.inicio + duracao,
          fuso: this.regras.fusoHorario,
          descricao: [ev.descricao?.trimEnd() ?? '', `Remarcado por ${p.professor} em ${agoraR.data} ${agoraR.hora}: de ${antes} para ${depois}.`].filter((l) => l !== '').join('\n'),
          privado: { remarcadoPor: p.professor },
        })
        this.store.atualizarInicioDoAgendamento(p.eventoId, slot.inicio)
        const cliente = nomeDoCliente(ev.titulo) || 'Cliente'
        this.store.registrarAcaoAgenda({ professor: p.professor, acao: 'remarcou', eventoId: p.eventoId, cliente, whatsapp: whatsappDoEvento(ev) ?? '', detalhe: `de ${antes} para ${depois}` }, this.agoraMs())
        console.log(`[agenda-professores] ${p.professor} remarcou a avaliação de ${cliente}: de ${antes} para ${depois}`)
        return { mensagem: `Avaliação de ${cliente} remarcada para ${depois}. O horário de ${antes} voltou a ficar livre.`, liberado: { data: dataAntes, hhmm: r.hora } }
      })
      .catch((e) => this.traduzir(e))
  }

  /**
   * Anota o que aconteceu numa avaliação que já começou: o cliente veio, faltou ou fechou matrícula. "limpar" desfaz.
   * Não mexe na agenda do Google, só no banco do bot (alimenta as taxas de falta e de conversão do painel).
   */
  async comparecimento(p: { eventoId: string; status: StatusComparecimento | 'limpar'; por: string }): Promise<ResultadoAcao & { status?: StatusComparecimento }> {
    try {
      const { api, agendaId } = this.google
      const ev = await api.obterEvento(agendaId, p.eventoId)
      if (!ev) throw new ErroPainel('Esse evento não existe mais na agenda. A tela vai atualizar.', 404, 'nao_existe')
      if (!ehAvaliacao(ev.titulo) || ev.inicio === undefined || ev.diaInteiro) {
        throw new ErroPainel('Só dá para anotar presença em avaliações ("Avaliação — Nome").', 403, 'nao_e_avaliacao')
      }
      const cliente = nomeDoCliente(ev.titulo) || 'Cliente'
      if (p.status === 'limpar') {
        this.store.desfazerComparecimento(p.eventoId)
        return { mensagem: `Anotação de ${cliente} apagada.` }
      }
      if (ev.inicio > this.agoraMs()) throw new ErroPainel('Essa avaliação ainda não aconteceu.', 400, 'futuro')
      this.store.marcarComparecimento({ eventoId: p.eventoId, inicio: ev.inicio, cliente, whatsapp: whatsappDoEvento(ev) ?? '', status: p.status, por: p.por }, this.agoraMs())
      console.log(`[agenda] ${p.por} anotou: ${cliente} ${p.status}`)
      const dito = { veio: 'veio à avaliação', faltou: 'faltou', matriculou: 'veio e fechou matrícula' }[p.status]
      return { mensagem: `${cliente} ${dito}. Anotado!`, status: p.status }
    } catch (e) {
      return this.traduzir(e)
    }
  }
}
