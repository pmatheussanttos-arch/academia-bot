import { diaDaSemana, hojeISO, horaLocalDe, limitesDoDia, rotulo, somarDias } from './agenda.js'
import type { ServicoAgenda } from './agendamento.js'
import type { Config } from './config.js'
import { normalizarNumero, numeroNaLista } from './config.js'
import { carregarMensagens, renderizar } from './mensagens.js'
import type { Metricas, ResumoSemana } from './metricas.js'
import type { Notificador } from './notify.js'
import { AUTOMATICAS_POR_DIA, enviadasHoje, pediuParaParar, podeEnviarAutomatica, registrarAutomaticaEnviada } from './automaticas.js'
import { ehAvaliacao, nomeDoCliente, segundaDaSemana, whatsappDoEvento } from './painel-agenda.js'
import type { Store } from './store.js'
import type { ClienteWhatsapp } from './whatsapp.js'

/**
 * Rotinas automáticas: tudo é "no máximo uma vez" (o marcador é gravado ANTES de enviar), porque repetir um aviso
 * é pior do que perder um. O relógio é injetável para os testes.
 *
 * - Resumo semanal para a equipe: segunda de manhã. Ligado por padrão (só vai para os números de aviso).
 * - Lembrete ao cliente no dia anterior: DESLIGADO por padrão. É mensagem automática saindo do número da academia,
 *   o que pesa no risco de bloqueio, então só vai para quem JÁ conversou com o bot, com limite diário e pausa entre envios.
 * - Aviso de gasto da IA: a 80% e a 100% do limite do mês.
 */

export type NomeRotina = 'resumo' | 'lembrete' | 'alerta_espera' | 'retomada'

const CHAVE: Record<NomeRotina, string> = { resumo: 'rotina_resumo', lembrete: 'rotina_lembrete', alerta_espera: 'rotina_alerta_espera', retomada: 'rotina_retomada' }
// Só o que fala com a equipe nasce ligado. O que escreve para cliente por conta própria nasce desligado (risco de bloqueio).
const PADRAO: Record<NomeRotina, boolean> = { resumo: true, lembrete: false, alerta_espera: true, retomada: false }

export function rotinaLigada(store: Store, nome: NomeRotina): boolean {
  const v = store.lerAjuste(CHAVE[nome])
  return v === undefined ? PADRAO[nome] : v === '1'
}

export function definirRotina(store: Store, nome: NomeRotina, ligada: boolean): void {
  store.definirAjuste(CHAVE[nome], ligada ? '1' : '0')
}

export const HORA_RESUMO = 8
/** O lembrete sai cerca de 4 horas antes da avaliação, no mesmo dia... */
export const LEMBRETE_ANTECEDENCIA_MS = 4 * 3_600_000
/** ...mas nunca depois de faltar menos de 1 hora, e nunca antes das 7h. */
export const LEMBRETE_FALTANDO_MINIMO_MS = 3_600_000
export const HORA_LEMBRETE_MESMO_DIA_DE = 7
/** Avaliação cedo demais para lembrar no mesmo dia (4 h antes cairia antes das 7h): lembra na véspera, entre 17h e 20h. */
export const HORA_LEMBRETE_DE = 17
export const HORA_LEMBRETE_ATE = 20

export const LEMBRETE_PADRAO = 'Oi, {nome}! Passando para lembrar da sua avaliação aqui na GarageFit {quando}, às {hora} 😊\nQualquer imprevisto, é só me avisar por aqui. Te esperamos!'

export interface RotinasDeps {
  store: Store
  cfg: Config
  servico: ServicoAgenda
  metricas: Metricas
  notificar: Notificador
  wa: Pick<ClienteWhatsapp, 'enviarTexto'>
  /** O WhatsApp está conectado agora? (só existe no modo QR) */
  conectado?: () => boolean
  /** Sorteio do intervalo entre mensagens automáticas (os testes fixam). */
  aleatorio?: () => number
}

const reais = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`

export function textoDoResumo(r: ResumoSemana): string {
  const a = r.avaliacoes
  const linhas = [`📊 Resumo da semana (${r.rotulo}) — GarageFit`, '']
  if (!r.agendaOk) {
    linhas.push('⚠️ Não consegui ler a agenda do Google, então as avaliações abaixo podem estar incompletas.')
  }
  const detalhe = [a.veio + a.matriculou > 0 ? `${a.veio + a.matriculou} vieram` : '', a.faltou > 0 ? `${a.faltou} faltaram` : '', a.matriculou > 0 ? `${a.matriculou} fecharam matrícula` : '', a.semAnotar > 0 ? `${a.semAnotar} sem anotação` : '']
    .filter(Boolean)
    .join(' · ')
  linhas.push(`🗓️ Avaliações: ${a.total}${detalhe ? ` (${detalhe})` : ''}`)
  linhas.push(`📝 Matrículas pelo WhatsApp: ${r.matriculasPeloBot}`)
  linhas.push(`💬 Conversas novas: ${r.conversasNovas}${r.resolvidasPct !== undefined ? ` (o bot resolveu ${r.resolvidasPct}% sozinho)` : ''}`)
  linhas.push(`💸 Gasto estimado com a IA: ${reais(r.gastoReais)}`)
  if (r.pendentes > 0) linhas.push('', `⏳ ${r.pendentes} matrícula(s) ainda para lançar na plataforma.`)
  if (a.semAnotar > 0) linhas.push(`🗒️ ${a.semAnotar} avaliação(ões) sem anotar se o cliente veio (painel, aba Avaliações).`)
  linhas.push('', `➡️ Esta semana já tem ${r.marcadasProximaSemana} avaliação(ões) marcada(s).`)
  return linhas.join('\n')
}

/** O número com e sem o 9 extra: o WhatsApp às vezes guarda um, às vezes o outro. */
export function variantesDoNumero(bruto: string): string[] {
  const n = bruto.replace(/\D/g, '')
  const base = normalizarNumero(n) // sem o 9
  const com9 = base.startsWith('55') && base.length === 12 ? `${base.slice(0, 4)}9${base.slice(4)}` : base
  return [...new Set([base, com9])]
}

export class Rotinas {
  constructor(private d: RotinasDeps) {}

  private agoraMs(): number {
    return this.d.servico.agora().getTime()
  }

  private get fuso(): string {
    return this.d.servico.regras.fusoHorario
  }

  private horaLocal(): number {
    return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: this.fuso }).format(new Date(this.agoraMs()))) % 24
  }

  /** Chame de tempos em tempos (a cada poucos minutos): cada rotina decide sozinha se já é a hora e se já fez. */
  async tick(): Promise<void> {
    for (const [nome, rotina] of [
      ['resumo semanal', () => this.resumoSemanal()],
      ['lembretes', () => this.lembretes()],
      ['alerta de gasto', () => this.alertaGasto()],
    ] as const) {
      try {
        await rotina()
      } catch (err) {
        console.error(`[rotinas] ${nome} falhou:`, err instanceof Error ? err.message : err)
      }
    }
  }

  /** Segunda-feira, a partir das 8h: o balanço da semana que acabou. Uma vez por semana. */
  async resumoSemanal(): Promise<boolean> {
    const { store, metricas, notificar } = this.d
    if (!rotinaLigada(store, 'resumo')) return false
    const hoje = hojeISO(this.d.servico.agora(), this.fuso)
    if (diaDaSemana(hoje) !== 'seg' || this.horaLocal() < HORA_RESUMO) return false
    if (store.lerAjuste('resumo_ultimo') === hoje) return false
    store.definirAjuste('resumo_ultimo', hoje) // antes de enviar: no máximo uma vez
    const passada = somarDias(segundaDaSemana(hoje), -7)
    await notificar(textoDoResumo(await metricas.resumoDaSemana(passada)))
    console.log(`[rotinas] resumo da semana de ${passada} enviado para a equipe`)
    return true
  }

  /** A 80% e a 100% do limite mensal: um aviso de cada, por mês. */
  async alertaGasto(): Promise<boolean> {
    const { store, metricas, notificar } = this.d
    const g = metricas.gastoDoMes()
    if (g.percentual === undefined || g.percentual < 80) return false
    const nivel = g.percentual >= 100 ? '100' : '80'
    const chave = `alerta_gasto_${g.mes}`
    const ja = store.lerAjuste(chave)
    if (ja === '100' || ja === nivel) return false
    store.definirAjuste(chave, nivel)
    await notificar(
      nivel === '100'
        ? `🚨 O gasto estimado com a IA passou do limite do mês: ${reais(g.reais)} de ${reais(g.limiteReais)}. O bot continua funcionando; confira em console.anthropic.com e, se quiser, aumente o limite (variável GASTO_LIMITE_MENSAL na Render).`
        : `💸 O gasto estimado com a IA chegou a ${g.percentual}% do limite do mês: ${reais(g.reais)} de ${reais(g.limiteReais)}.`,
    )
    console.log(`[rotinas] alerta de gasto (${nivel}%) enviado`)
    return true
  }

  private textoDoLembrete(nome: string, inicio: number, quando: 'hoje' | 'amanhã'): string {
    let modelo = LEMBRETE_PADRAO
    try {
      modelo = carregarMensagens(this.d.cfg.mensagensPath)['lembrete-avaliacao']?.trim() || modelo
    } catch {
      // mensagens.md ilegível: usa o texto padrão
    }
    const r = rotulo(inicio, this.fuso)
    return renderizar(modelo, { nome, dia: r.dia, hora: r.hora, quando }).replace(/,\s*!/g, '!')
  }

  /**
   * Esta avaliação deve ser lembrada AGORA? Devolve "hoje" (lembrete de uns 4 h antes, no mesmo dia), "amanhã" (avaliação cedo
   * demais para isso: lembra na véspera, das 17h às 20h) ou undefined (não é a hora).
   */
  private quandoLembrar(inicio: number, hoje: string, amanha: string): 'hoje' | 'amanhã' | undefined {
    const { servico } = this.d
    const agora = this.agoraMs()
    const hora = this.horaLocal()
    const dataDoEvento = hojeISO(new Date(inicio), this.fuso)
    const ideal = inicio - LEMBRETE_ANTECEDENCIA_MS
    const cedoDemais = horaLocalDe(servico.regras, ideal) < HORA_LEMBRETE_MESMO_DIA_DE
    if (dataDoEvento === hoje) {
      if (cedoDemais) return undefined // essa já foi lembrada na véspera
      return agora >= ideal && agora <= inicio - LEMBRETE_FALTANDO_MINIMO_MS && hora >= HORA_LEMBRETE_MESMO_DIA_DE && hora < HORA_LEMBRETE_ATE ? 'hoje' : undefined
    }
    if (dataDoEvento === amanha && cedoDemais) {
      return hora >= HORA_LEMBRETE_DE && hora < HORA_LEMBRETE_ATE ? 'amanhã' : undefined
    }
    return undefined
  }

  /**
   * Lembrete da avaliação, uns 4 horas antes no mesmo dia (para as da tarde) ou na véspera à noite (para as da manhã cedo), das 17h às 20h, só para quem já conversou com o bot. Desligado por padrão.
   * Sai no máximo UM por chamada (a próxima só depois do intervalo de 1 a 5 minutos) e dentro do teto diário
   * compartilhado com as outras mensagens automáticas. Devolve quantos saíram (0 ou 1).
   */
  async lembretes(): Promise<number> {
    const { store, cfg, servico, wa } = this.d
    if (!rotinaLigada(store, 'lembrete')) return 0
    if (cfg.modoWhatsapp !== 'qr') return 0 // na API oficial, mensagem fora das 24h exige modelo aprovado pela Meta
    const g = servico.googleAgenda
    if (!g) return 0
    if (this.d.conectado && !this.d.conectado()) return 0
    if (store.pausa(this.agoraMs())) return 0 // assistente pausado: a equipe está cuidando, nada automático sai
    if (!podeEnviarAutomatica(store, servico).ok) return 0

    const hoje = hojeISO(servico.agora(), this.fuso)
    const amanha = somarDias(hoje, 1)
    const de = limitesDoDia(servico.regras, hoje).de
    const ate = limitesDoDia(servico.regras, amanha).ate
    const doDia = (await g.api.listarEventos(g.agendaId, de, ate)).filter((e) => e.ocupa && !e.diaInteiro && e.inicio !== undefined && ehAvaliacao(e.titulo)).sort((a, b) => a.inicio! - b.inicio!)

    for (const e of doDia) {
      const quando = this.quandoLembrar(e.inicio!, hoje, amanha)
      if (!quando) continue // ainda não é a hora (ou já passou) para esta avaliação
      if (store.lembreteRegistrado(e.id)) continue
      const numero = whatsappDoEvento(e)
      if (!numero) {
        store.registrarLembrete(e.id, 'pulado: sem WhatsApp no evento', this.agoraMs())
        continue
      }
      const chat = store.chatComConversa(variantesDoNumero(numero))
      if (!chat) {
        store.registrarLembrete(e.id, 'pulado: nunca conversou com o bot', this.agoraMs())
        continue
      }
      if (numeroNaLista(chat, cfg.numerosAvisos)) {
        store.registrarLembrete(e.id, 'pulado: número da equipe', this.agoraMs())
        continue
      }
      if (pediuParaParar(store.historico(chat, 300).filter((m) => m.papel === 'user').map((m) => m.conteudo))) {
        store.registrarLembrete(e.id, 'pulado: pediu para não receber mensagens', this.agoraMs())
        continue
      }
      if (store.emHandoff(chat, this.agoraMs())) {
        store.registrarLembrete(e.id, 'pulado: a equipe está na conversa', this.agoraMs())
        continue
      }

      const nome = nomeDoCliente(e.titulo).split(' ')[0] ?? ''
      const texto = this.textoDoLembrete(nome, e.inicio!, quando)
      store.registrarLembrete(e.id, 'enviando', this.agoraMs()) // no máximo uma vez, mesmo que o envio falhe
      try {
        await wa.enviarTexto(chat, texto)
        store.adicionarMensagem(chat, 'assistant', texto, this.agoraMs()) // o bot sabe do que o cliente está falando se ele responder
        store.atualizarLembrete(e.id, 'enviado')
        registrarAutomaticaEnviada(store, servico, this.d.aleatorio)
        console.log(`[rotinas] lembrete de avaliação enviado (${enviadasHoje(store, servico)}/${AUTOMATICAS_POR_DIA} automáticas hoje)`)
        return 1
      } catch (err) {
        store.atualizarLembrete(e.id, `falhou: ${err instanceof Error ? err.message : String(err)}`)
        console.error('[rotinas] não consegui enviar o lembrete:', err instanceof Error ? err.message : err)
      }
    }
    return 0
  }
}
