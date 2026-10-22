import { diaDaSemana, hojeISO, limitesDoDia, rotulo, somarDias } from './agenda.js'
import type { ServicoAgenda } from './agendamento.js'
import type { Config } from './config.js'
import { normalizarNumero } from './config.js'
import { carregarMensagens, renderizar } from './mensagens.js'
import type { Metricas, ResumoSemana } from './metricas.js'
import type { Notificador } from './notify.js'
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

export type NomeRotina = 'resumo' | 'lembrete'

const CHAVE: Record<NomeRotina, string> = { resumo: 'rotina_resumo', lembrete: 'rotina_lembrete' }
const PADRAO: Record<NomeRotina, boolean> = { resumo: true, lembrete: false }

export function rotinaLigada(store: Store, nome: NomeRotina): boolean {
  const v = store.lerAjuste(CHAVE[nome])
  return v === undefined ? PADRAO[nome] : v === '1'
}

export function definirRotina(store: Store, nome: NomeRotina, ligada: boolean): void {
  store.definirAjuste(CHAVE[nome], ligada ? '1' : '0')
}

export const HORA_RESUMO = 8
export const HORA_LEMBRETE_DE = 17
export const HORA_LEMBRETE_ATE = 20
export const LEMBRETES_POR_DIA = 30
/** Pausa entre dois lembretes: mensagens em rajada são o que o WhatsApp mais estranha. */
export const INTERVALO_LEMBRETES_MS = 12_000

export const LEMBRETE_PADRAO = 'Oi, {nome}! Passando para lembrar da sua avaliação aqui na GarageFit: {dia}, às {hora} 😊\nQualquer imprevisto, é só me avisar por aqui. Te esperamos!'

export interface RotinasDeps {
  store: Store
  cfg: Config
  servico: ServicoAgenda
  metricas: Metricas
  notificar: Notificador
  wa: Pick<ClienteWhatsapp, 'enviarTexto'>
  /** O WhatsApp está conectado agora? (só existe no modo QR) */
  conectado?: () => boolean
  esperar?: (ms: number) => Promise<void>
  intervaloLembretesMs?: number
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

  private textoDoLembrete(nome: string, inicio: number): string {
    let modelo = LEMBRETE_PADRAO
    try {
      modelo = carregarMensagens(this.d.cfg.mensagensPath)['lembrete-avaliacao']?.trim() || modelo
    } catch {
      // mensagens.md ilegível: usa o texto padrão
    }
    const r = rotulo(inicio, this.fuso)
    return renderizar(modelo, { nome, dia: r.dia, hora: r.hora }).replace(/,\s*!/g, '!')
  }

  /**
   * Lembrete da avaliação de amanhã, das 17h às 20h, só para quem já conversou com o bot. Desligado por padrão.
   * Devolve quantos lembretes saíram.
   */
  async lembretes(): Promise<number> {
    const { store, cfg, servico, wa } = this.d
    if (!rotinaLigada(store, 'lembrete')) return 0
    if (cfg.modoWhatsapp !== 'qr') return 0 // na API oficial, mensagem fora das 24h exige modelo aprovado pela Meta
    const hora = this.horaLocal()
    if (hora < HORA_LEMBRETE_DE || hora >= HORA_LEMBRETE_ATE) return 0
    const g = servico.googleAgenda
    if (!g) return 0
    if (this.d.conectado && !this.d.conectado()) return 0
    if (store.pausa(this.agoraMs())) return 0 // assistente pausado: a equipe está cuidando, nada automático sai

    const hoje = hojeISO(servico.agora(), this.fuso)
    const { de, ate } = limitesDoDia(servico.regras, somarDias(hoje, 1))
    const doDia = (await g.api.listarEventos(g.agendaId, de, ate)).filter((e) => e.ocupa && !e.diaInteiro && e.inicio !== undefined && ehAvaliacao(e.titulo)).sort((a, b) => a.inicio! - b.inicio!)

    const inicioDoHoje = limitesDoDia(servico.regras, hoje).de
    let enviadosHoje = store.contarLembretes(inicioDoHoje, 'enviado')
    let saiu = 0
    for (const e of doDia) {
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
      if (store.emHandoff(chat, this.agoraMs())) {
        store.registrarLembrete(e.id, 'pulado: a equipe está na conversa', this.agoraMs())
        continue
      }
      if (enviadosHoje >= LEMBRETES_POR_DIA) break // teto diário: melhor perder um lembrete do que mandar em rajada
      if (saiu > 0) await (this.d.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(this.d.intervaloLembretesMs ?? INTERVALO_LEMBRETES_MS)

      const nome = nomeDoCliente(e.titulo).split(' ')[0] ?? ''
      const texto = this.textoDoLembrete(nome, e.inicio!)
      store.registrarLembrete(e.id, 'enviando', this.agoraMs()) // no máximo uma vez, mesmo que o envio falhe
      try {
        await wa.enviarTexto(chat, texto)
        store.adicionarMensagem(chat, 'assistant', texto, this.agoraMs()) // o bot sabe do que o cliente está falando se ele responder
        store.atualizarLembrete(e.id, 'enviado')
        enviadosHoje++
        saiu++
        console.log('[rotinas] lembrete de avaliação enviado')
      } catch (err) {
        store.atualizarLembrete(e.id, `falhou: ${err instanceof Error ? err.message : String(err)}`)
        console.error('[rotinas] não consegui enviar o lembrete:', err instanceof Error ? err.message : err)
      }
    }
    return saiu
  }
}
