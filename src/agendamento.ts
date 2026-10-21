import { NOME_PERIODO, PERIODOS, carregarAgenda, gradeDoDia, limitesDoDia, periodoDe, rotulo, type Agenda, type Periodo, type Slot } from './agenda.js'
import type { Config } from './config.js'
import { ClienteGoogleAgenda, type EventoAgenda, type GoogleAgendaApi } from './google.js'
import { carregarMensagens, renderizar, type Mensagens } from './mensagens.js'
import type { Notificador } from './notify.js'
import { formatarWhatsapp, linkRecepcao } from './recepcao.js'
import type { Store } from './store.js'

export type TipoVisita = 'aula_experimental' | 'avaliacao_fisica'
/** Período pedido na consulta de horários; 'qualquer' = sem filtro. */
export type PeriodoPedido = Periodo | 'qualquer'

export interface AgendamentoDeps {
  store: Store
  agenda: Agenda
  mensagens: Mensagens
  notificar: Notificador
  /** Sem isto, tudo é pedido: a equipe confirma o horário na conversa (modo manual). */
  google?: GoogleAgendaApi
  agendaId?: string
  /** WhatsApp da recepção: nos pedidos que a equipe confirma, o cliente recebe um link com a mensagem pronta. */
  numeroRecepcao?: string
  /** Chave geral para desligar o agendamento automático sem apagar as credenciais. */
  automatico: boolean
  agora?: () => Date
}

export interface PedidoVisita {
  chat: string
  /** Nome que aparece no perfil do WhatsApp. */
  nomeContato: string
  /** Nome que o cliente informou na conversa. */
  nomeCliente: string
  tipo: TipoVisita
  dataISO: string
  hhmm: string
  obs: string
  jaEAluno: boolean
  planoVip: boolean
}

export type ResultadoPedido =
  | { ok: true; agendada: boolean; mensagem: string }
  | { ok: false; motivo: string }

const NOME_TIPO: Record<TipoVisita, string> = { aula_experimental: 'aula experimental', avaliacao_fisica: 'avaliação' }

function limparNome(n: string): string {
  return n.replace(/[\r\n\t]+/g, ' ').replace(/[<>`]/g, '').trim().slice(0, 60)
}

/**
 * Horários de aula experimental e de avaliação.
 * - Avaliação, com Google configurado: lê a agenda de verdade e cria o evento.
 * - Aula experimental, ou sem Google: só registra o pedido e a equipe confirma.
 */
export class ServicoAgenda {
  private trava: Promise<unknown> = Promise.resolve()

  constructor(private d: AgendamentoDeps) {}

  get fuso(): string {
    return this.d.agenda.fusoHorario
  }

  get modo(): 'google' | 'manual' {
    return this.googleAtivo() ? 'google' : 'manual'
  }

  /** Regras da grade (agenda.json). O painel dos professores usa as mesmas. */
  get regras(): Agenda {
    return this.d.agenda
  }

  /** Google Agenda e ID da agenda, quando o agendamento automático está ligado. O painel dos professores usa a mesma agenda. */
  get googleAgenda(): { api: GoogleAgendaApi; agendaId: string } | undefined {
    return this.googleAtivo() ? { api: this.d.google!, agendaId: this.d.agendaId! } : undefined
  }

  private googleAtivo(): boolean {
    return this.d.automatico && this.d.google !== undefined && this.d.agendaId !== undefined
  }

  agora(): Date {
    return (this.d.agora ?? (() => new Date()))()
  }

  /**
   * Duas pessoas pedindo o mesmo horário ao mesmo tempo: uma de cada vez, para a segunda ver o horário já ocupado.
   * O painel dos professores usa a MESMA trava, para o assistente e os professores também não colidirem.
   */
  exclusivo<T>(tarefa: () => Promise<T>): Promise<T> {
    const r = this.trava.then(tarefa, tarefa)
    this.trava = r.catch(() => undefined)
    return r
  }

  ocupado(slot: Slot, eventos: EventoAgenda[]): boolean {
    const fim = slot.inicio + this.d.agenda.duracaoMin * 60_000
    const sobrepostos = eventos.filter((e) => e.ocupa && e.inicio !== undefined && e.fim !== undefined && e.inicio < fim && e.fim > slot.inicio)
    return sobrepostos.length >= this.d.agenda.capacidade
  }

  /** Dia marcado como fechado na agenda: um evento de dia inteiro com "fechado" no título. */
  diaFechado(dataISO: string, eventos: EventoAgenda[]): boolean {
    return eventos.some((e) => e.ocupa && e.diaInteiro && e.diaInteiro.de <= dataISO && dataISO < e.diaInteiro.ate && /fechad/i.test(e.titulo))
  }

  private async eventosDoDia(dataISO: string): Promise<EventoAgenda[]> {
    const { de, ate } = limitesDoDia(this.d.agenda, dataISO)
    return this.d.google!.listarEventos(this.d.agendaId!, de, ate)
  }

  /**
   * Lista os horários para o modelo oferecer ao cliente, já filtrados pelo período do dia que ele escolheu
   * (manhã, tarde ou noite), para a conversa não ficar cheia de horários. Nunca lança erro: devolve sempre um texto.
   */
  async consultar(tipo: TipoVisita, dataISO: string, periodo: PeriodoPedido = 'qualquer'): Promise<string> {
    const grade = gradeDoDia(this.d.agenda, dataISO, this.agora())
    if (!grade.ok) return grade.motivo

    const { agenda } = this.d
    const quando = periodo === 'qualquer' ? '' : ` ${NOME_PERIODO[periodo]}`
    const noPeriodo = (hhmms: string[]) => (periodo === 'qualquer' ? hhmms : hhmms.filter((h) => periodoDe(agenda, h) === periodo))
    const dica = (lista: string[]) => (lista.length > 4 ? ' Ofereça só 3 ou 4 desses, bem espalhados, e diga que há outros horários se a pessoa quiser.' : '')
    /** O que existe nos outros períodos, para o modelo sugerir quando o escolhido está cheio. */
    const outros = (hhmms: string[]) => {
      const partes = PERIODOS.filter((p) => p !== periodo)
        .map((p) => ({ p, lista: hhmms.filter((h) => periodoDe(agenda, h) === p) }))
        .filter((x) => x.lista.length > 0)
        .map((x) => `${NOME_PERIODO[x.p]}: ${x.lista.join(', ')}`)
      return partes.length > 0 ? `Há horários ${partes.join('; ')}.` : ''
    }
    const daGrade = (aviso: string) => {
      const todos = grade.slots.map((s) => s.hhmm)
      const lista = noPeriodo(todos)
      if (lista.length === 0) return `${aviso}Não há horários da grade${quando} em ${grade.rotuloDia}. ${outros(todos)}`.trim()
      return (
        `${aviso}Horários da grade em ${grade.rotuloDia}${quando}: ${lista.join(', ')}. ` +
        `Você não sabe quais já estão ocupados: diga ao cliente que a equipe confirma a disponibilidade.${dica(lista)}`
      )
    }

    const usaGoogle = tipo === 'avaliacao_fisica' && this.googleAtivo()
    if (!usaGoogle) return daGrade('')

    try {
      const eventos = await this.eventosDoDia(grade.dataISO)
      if (this.diaFechado(grade.dataISO, eventos)) return `A academia marcou ${grade.rotuloDia} como fechado. Não há avaliações neste dia.`
      const livres = grade.slots.filter((s) => !this.ocupado(s, eventos)).map((s) => s.hhmm)
      if (livres.length === 0) return `Não há horários livres para avaliação em ${grade.rotuloDia}. Sugira outro dia.`
      const lista = noPeriodo(livres)
      if (lista.length === 0) {
        return `Não há horários livres para avaliação${quando} em ${grade.rotuloDia}. ${outros(livres)} Pergunte se a pessoa prefere outro período ou outro dia.`
      }
      return `Horários livres para avaliação em ${grade.rotuloDia}${quando}: ${lista.join(', ')}.${dica(lista)}`
    } catch (err) {
      console.error('[agenda] não consegui ler o Google Agenda:', err instanceof Error ? err.message : err)
      return daGrade('A agenda está indisponível agora. ')
    }
  }

  private mensagem(chave: string, p: PedidoVisita, slot: Slot): string {
    const r = rotulo(slot.inicio, this.d.agenda.fusoHorario)
    const m = this.d.mensagens
    const nome = limparNome(p.nomeCliente) || limparNome(p.nomeContato)
    const link = linkRecepcao(
      this.d.numeroRecepcao,
      `Oi! Quero confirmar minha ${NOME_TIPO[p.tipo]} na ${r.dia} às ${r.hora}.${nome ? ` Meu nome: ${nome}.` : ''}`,
    )
    return renderizar(m[chave]!, {
      dia: r.dia,
      hora: r.hora,
      confirmacao: link ? renderizar(m['confirmacao-recepcao']!, { link }) : m['confirmacao-equipe']!,
      linha_valor: p.planoVip ? m['linha-valor-vip']! : m['linha-valor-pago']!,
      linha_mensalidade: p.jaEAluno ? '' : m['linha-mensalidade']!,
    })
  }

  private async avisarEquipe(p: PedidoVisita, slot: Slot, situacao: string): Promise<void> {
    const r = rotulo(slot.inicio, this.d.agenda.fusoHorario)
    await this.d.notificar(
      [
        `🗓️ ${situacao}`,
        `Nome: ${limparNome(p.nomeCliente) || limparNome(p.nomeContato) || '(sem nome)'}`,
        `WhatsApp: ${formatarWhatsapp(p.chat)}`,
        `Tipo: ${NOME_TIPO[p.tipo]}${p.planoVip ? ' (plano VIP)' : ''}${p.jaEAluno ? ' (já é aluno)' : ''}`,
        `Quando: ${r.dia} às ${r.hora}`,
        ...(p.obs ? [`Obs.: ${p.obs}`] : []),
      ].join('\n'),
    )
  }

  /** Registra o pedido sem tocar na agenda: a equipe confirma o horário na conversa. */
  private async pedidoManual(p: PedidoVisita, slot: Slot, aviso?: string): Promise<ResultadoPedido> {
    await this.avisarEquipe(p, slot, aviso ?? `Pedido de ${NOME_TIPO[p.tipo]} (a equipe confirma)`)
    const chave = p.tipo === 'aula_experimental' ? 'experimental-pedido' : 'avaliacao-pedido'
    return { ok: true, agendada: false, mensagem: this.mensagem(chave, p, slot) }
  }

  async solicitar(p: PedidoVisita): Promise<ResultadoPedido> {
    const grade = gradeDoDia(this.d.agenda, p.dataISO, this.agora())
    if (!grade.ok) return { ok: false, motivo: grade.motivo }
    const slot = grade.slots.find((s) => s.hhmm === p.hhmm)
    if (!slot) {
      return {
        ok: false,
        motivo: `${p.hhmm} não é um horário válido em ${grade.rotuloDia}. Horários da grade: ${grade.slots.map((s) => s.hhmm).join(', ')}.`,
      }
    }

    if (p.tipo === 'aula_experimental' || !this.googleAtivo()) return this.pedidoManual(p, slot)

    return this.exclusivo(() => this.agendarAvaliacao(p, grade.rotuloDia, grade.dataISO, grade.slots, slot))
  }

  private async agendarAvaliacao(p: PedidoVisita, rotuloDia: string, dataISO: string, grade: Slot[], slot: Slot): Promise<ResultadoPedido> {
    const { store, agenda, google, agendaId } = this.d
    const agora = this.agora().getTime()

    try {
      const anterior = store.agendamentoAtivo(p.chat, agora)
      if (anterior) {
        const vivo = await google!.obterEvento(agendaId!, anterior.eventoId)
        if (vivo) {
          const r = rotulo(anterior.inicio, agenda.fusoHorario)
          return {
            ok: false,
            motivo: `Este cliente já tem uma avaliação agendada: ${r.dia} às ${r.hora}. Não agende outra. Se ele quiser mudar ou cancelar, use chamar_humano.`,
          }
        }
        store.cancelarAgendamento(anterior.id) // a equipe apagou o evento na agenda: o cliente pode marcar de novo
      }

      const eventos = await this.eventosDoDia(dataISO)
      if (this.diaFechado(dataISO, eventos)) return { ok: false, motivo: `A academia marcou ${rotuloDia} como fechado.` }
      if (this.ocupado(slot, eventos)) {
        const livres = grade.filter((s) => !this.ocupado(s, eventos)).map((s) => s.hhmm)
        return {
          ok: false,
          motivo: `${slot.hhmm} já está ocupado em ${rotuloDia}. ${livres.length > 0 ? `Horários livres: ${livres.join(', ')}.` : 'Não há mais horários livres neste dia.'}`,
        }
      }

      const nome = limparNome(p.nomeCliente) || limparNome(p.nomeContato) || 'Cliente'
      const eventoId = await google!.criarEvento(agendaId!, {
        titulo: `Avaliação — ${nome}`,
        descricao: [
          `WhatsApp: ${formatarWhatsapp(p.chat)}`,
          ...(p.planoVip ? ['Plano VIP (avaliação gratuita)'] : []),
          ...(p.jaEAluno ? ['Já é aluno'] : []),
          ...(p.obs ? [`Obs.: ${p.obs}`] : []),
          '',
          'Agendado automaticamente pelo assistente virtual do WhatsApp.',
        ].join('\n'),
        inicio: slot.inicio,
        fim: slot.inicio + agenda.duracaoMin * 60_000,
        fuso: agenda.fusoHorario,
        privado: { origem: 'assistente-whatsapp', whatsapp: p.chat },
      })
      store.registrarAgendamento({ chat: p.chat, eventoId, inicio: slot.inicio, nome }, agora)
      await this.avisarEquipe(p, slot, 'Avaliação agendada pelo assistente (já está no Google Agenda)')
      return { ok: true, agendada: true, mensagem: this.mensagem('avaliacao-agendada', p, slot) }
    } catch (err) {
      // Google fora do ar, credencial errada, agenda sem permissão: o cliente não fica sem resposta.
      console.error('[agenda] falha ao agendar no Google Agenda:', err instanceof Error ? err.message : err)
      return this.pedidoManual(p, slot, '⚠️ Google Agenda indisponível: pedido de avaliação registrado SEM agendar (confirme o horário e crie o evento)')
    }
  }
}


/** Monta o serviço a partir da configuração: usado pelo servidor e pelo teste no terminal. */
export function criarServicoAgenda(cfg: Config, store: Store, notificar: Notificador): ServicoAgenda {
  return new ServicoAgenda({
    store,
    agenda: carregarAgenda(cfg.agendaPath),
    mensagens: carregarMensagens(cfg.mensagensPath),
    notificar,
    google: cfg.google ? new ClienteGoogleAgenda({ clientEmail: cfg.google.clientEmail, privateKey: cfg.google.privateKey }) : undefined,
    agendaId: cfg.google?.agendaId,
    numeroRecepcao: cfg.numeroRecepcao,
    automatico: cfg.agendamentoAutomatico,
  })
}
