import { abertoEm, horaLocalDe } from './agenda.js'
import type { ServicoAgenda } from './agendamento.js'
import { numeroNaLista, type Config } from './config.js'
import { AUTOMATICAS_POR_DIA, enviadasHoje, pediuParaParar, podeEnviarAutomatica, registrarAutomaticaEnviada } from './automaticas.js'
import { carregarMensagens, renderizar } from './mensagens.js'
import type { Notificador } from './notify.js'
import { vezesQuePediuNome } from './prompt.js'
import { formatarWhatsapp } from './recepcao.js'
import { rotinaLigada } from './rotinas.js'
import type { MensagemSalva, Store, TransferenciaSemResposta } from './store.js'
import type { ClienteWhatsapp } from './whatsapp.js'

/**
 * Conversas paradas: avisa a equipe quando um cliente transferido fica sem resposta, e (se o dono ligar) retoma com UMA
 * mensagem curta o cliente que ficou sem resposta da equipe ou que parou no meio de uma venda.
 *
 * Tudo é "no máximo uma vez" (o registro é gravado ANTES de enviar). Só no modo QR: é lá que o bot enxerga quando a equipe
 * responde pelo celular da academia.
 */

const MIN = 60_000
const HORA = 3_600_000

/** Avisos à equipe. */
export const PRIMEIRO_AVISO_APOS_MIN = 30
/** Passadas 3 horas de espera o aviso não serve mais (a equipe já viu): evita uma enxurrada de avisos velhos quando a academia abre. */
export const AVISO_VALIDO_ATE_MIN = 180
/** Lembretes ao cliente. */
export const LEMBRETE_TRANSFERIDA_APOS_MIN = 120
export const LEMBRETE_PARADA_APOS_MIN = 15
export const JANELA_CLIENTE_HORAS = 24
/** Mensagem a cliente nunca sai de madrugada, mesmo que a academia abra cedo. */
export const HORA_CLIENTE_DE = 8
export const HORA_CLIENTE_ATE = 20

export const LEMBRETE_TRANSFERIDA_PADRAO = 'Oi, {nome}! Aqui é o GFIT da GarageFit 😊 Desculpa a demora. Ficou alguma dúvida ou posso te ajudar a finalizar seu agendamento?'
export const LEMBRETE_PARADA_PADRAO = 'Oi, {nome}! Conseguiu ver minha mensagem? Vamos continuar? 😊'

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * O nome que o cliente DISSE nesta conversa (nunca o do perfil do WhatsApp): a resposta logo depois de o bot perguntar.
 * Devolve só o primeiro nome, ou vazio se não deu para ter certeza.
 */
export function nomeInformado(historico: MensagemSalva[]): string {
  for (let i = 0; i < historico.length - 1; i++) {
    if (historico[i]!.papel !== 'assistant' || vezesQuePediuNome([historico[i]!.conteudo]) === 0) continue
    const resposta = historico.slice(i + 1).find((m) => m.papel === 'user')?.conteudo.trim() ?? ''
    const limpo = resposta.replace(/^(meu nome (é|e)|me chamo|sou (a|o)?|pode me chamar de|aqui (é|e) (a|o)?)\s+/i, '').replace(/[.!]+$/, '').trim()
    if (/^[\p{L}][\p{L}'.-]*(\s+[\p{L}][\p{L}'.-]*){0,3}$/u.test(limpo) && limpo.length <= 40) {
      const primeiro = limpo.split(/\s+/)[0]!
      return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase()
    }
  }
  return ''
}

/** A conversa era uma venda ou um agendamento em andamento e o bot ficou esperando uma resposta (terminou em pergunta)? */
export function parouNoMeioDeUmaVenda(historico: MensagemSalva[], desde: number): boolean {
  const recentes = historico.filter((m) => m.ts >= desde)
  const ultima = recentes.at(-1)
  if (!ultima || ultima.papel !== 'assistant' || !ultima.conteudo.slice(-220).includes('?')) return false
  return recentes.some((m) => /\b(plano|mensalidade|r\$|valor|pre[cç]o|avalia[cç][aã]o|aula experimental|matr[ií]cula|agend\w*|hor[aá]rio|pix|treinar)\b/i.test(semAcento(m.conteudo)))
}

/** "35 min" ou "2h05". */
export function tempoEspera(min: number): string {
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
}

/** Tira o "Oi, !" e as vírgulas soltas que sobram quando o cliente não disse o nome. */
function semNomeVazio(texto: string): string {
  return texto.replace(/,\s*,/g, ',').replace(/,\s*([!?.])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim()
}

export interface AcompanhamentoDeps {
  store: Store
  cfg: Config
  servico: ServicoAgenda
  notificar: Notificador
  wa: Pick<ClienteWhatsapp, 'enviarTexto'>
  /** O WhatsApp está conectado agora? */
  conectado?: () => boolean
  /** Sorteio do intervalo entre mensagens automáticas (os testes fixam). */
  aleatorio?: () => number
}

interface Candidato {
  tipo: 'lembrete_transferida' | 'lembrete_parou'
  chat: string
  /** Identifica o episódio (id da transferência, ou a hora da última mensagem do cliente). */
  ref: number
  /** Desde quando a equipe não respondeu / o cliente está parado. */
  desde: number
}

export class Acompanhamento {
  private emAndamento = false

  constructor(private d: AcompanhamentoDeps) {}

  private agoraMs(): number {
    return this.d.servico.agora().getTime()
  }

  /** Chame a cada minuto: cada parte decide sozinha se já é hora e se já fez. */
  async tick(): Promise<void> {
    if (this.emAndamento) return
    this.emAndamento = true
    try {
      for (const [nome, parte] of [
        ['aviso à equipe', () => this.alertasEquipe()],
        ['lembrete ao cliente', () => this.lembretes()],
      ] as const) {
        try {
          await parte()
        } catch (err) {
          console.error(`[acompanhamento] ${nome} falhou:`, err instanceof Error ? err.message : err)
        }
      }
    } finally {
      this.emAndamento = false
    }
  }

  private get modoQr(): boolean {
    return this.d.cfg.modoWhatsapp === 'qr'
  }

  private ultimaMensagemDoCliente(historico: MensagemSalva[]): MensagemSalva | undefined {
    return [...historico].reverse().find((m) => m.papel === 'user')
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Aviso à equipe
  // -------------------------------------------------------------------------------------------------------------------

  private textoDoAlerta(t: TransferenciaSemResposta): string {
    const historico = this.d.store.historico(t.chat, 300)
    const nome = nomeInformado(historico) || t.nomePerfil.trim() || '(sem nome)'
    const ultima = this.ultimaMensagemDoCliente(historico)?.conteudo.replace(/\s+/g, ' ').trim() ?? '(nenhuma)'
    const espera = tempoEspera(Math.max(0, Math.floor((this.agoraMs() - t.ts) / MIN)))
    return [
      `⏳ Cliente esperando a equipe há ${espera}`,
      `Nome: ${nome}`,
      `WhatsApp: ${formatarWhatsapp(t.chat)}`,
      `Última mensagem do cliente: "${ultima.length > 200 ? `${ultima.slice(0, 200)}…` : ultima}"`,
      `Motivo da transferência: ${t.motivo || '(sem motivo)'}`,
      'Responda pelo WhatsApp da academia.',
    ].join('\n')
  }

  /**
   * Cliente transferido que a equipe não respondeu: UM aviso, depois de 30 min (nunca um segundo: a equipe confere o WhatsApp o tempo todo).
   * Só com a academia funcionando (a equipe presente). Devolve quantos avisos saíram.
   */
  async alertasEquipe(): Promise<number> {
    const { store, servico, notificar } = this.d
    if (!rotinaLigada(store, 'alerta_espera') || !this.modoQr) return 0
    const agora = this.agoraMs()
    if (!abertoEm(servico.regras, agora)) return 0

    let enviados = 0
    for (const t of store.transferenciasSemResposta(agora - JANELA_CLIENTE_HORAS * HORA)) {
      const esperaMin = (agora - t.ts) / MIN
      if (esperaMin < PRIMEIRO_AVISO_APOS_MIN || esperaMin > AVISO_VALIDO_ATE_MIN) continue
      if (!store.registrarAcompanhamento(t.chat, 'alerta_equipe_1', t.id, 'enviado', agora)) continue // antes de enviar: no máximo uma vez
      await notificar(this.textoDoAlerta(t))
      enviados++
      console.log(`[acompanhamento] aviso à equipe: cliente esperando há ${Math.floor(esperaMin)} min`)
    }
    return enviados
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Lembrete ao cliente
  // -------------------------------------------------------------------------------------------------------------------

  /** Por que NÃO mandar a este candidato (e nunca mais olhar para este episódio)? undefined = pode mandar. */
  private motivoDePular(c: Candidato, historico: MensagemSalva[]): string | undefined {
    const { store, cfg } = this.d
    const agora = this.agoraMs()
    if (!/^\d{8,15}$/.test(c.chat)) return 'não é uma conversa de pessoa'
    if (numeroNaLista(c.chat, cfg.numerosAvisos)) return 'número da equipe'
    if (store.jaRecebeuLembrete(c.chat)) return 'já recebeu um lembrete (só um por conversa)'
    if (pediuParaParar(historico.filter((m) => m.papel === 'user').map((m) => m.conteudo))) return 'pediu para não receber mensagens'
    const ultimo = this.ultimaMensagemDoCliente(historico)
    if (!ultimo || ultimo.ts < agora - JANELA_CLIENTE_HORAS * HORA) return 'não escreve há mais de 24 horas'
    if (store.equipeRespondeuDesde(c.chat, c.tipo === 'lembrete_transferida' ? c.desde : ultimo.ts)) return 'a equipe respondeu'
    if (store.teveEvento(c.chat, ['avaliacao_bot', 'matricula'], agora - JANELA_CLIENTE_HORAS * HORA)) return 'já concluiu o agendamento ou a matrícula'
    if (c.tipo === 'lembrete_parou' && !parouNoMeioDeUmaVenda(historico, agora - JANELA_CLIENTE_HORAS * HORA)) return 'não estava no meio de uma venda'
    return undefined
  }

  private textoDoLembrete(c: Candidato, historico: MensagemSalva[]): string {
    const secao = c.tipo === 'lembrete_transferida' ? 'lembrete-transferida' : 'lembrete-parada'
    let modelo = c.tipo === 'lembrete_transferida' ? LEMBRETE_TRANSFERIDA_PADRAO : LEMBRETE_PARADA_PADRAO
    try {
      modelo = carregarMensagens(this.d.cfg.mensagensPath)[secao]?.trim() || modelo
    } catch {
      // mensagens.md ilegível: usa o texto padrão
    }
    return semNomeVazio(renderizar(modelo, { nome: nomeInformado(historico) }))
  }

  /**
   * UMA mensagem curta, no máximo uma por conversa:
   * - transferida e sem resposta da equipe há 2 horas (e o bot volta a atender a conversa depois);
   * - parada no meio de uma venda há 15 minutos.
   * Só com a academia funcionando, entre 8h e 20h, para quem escreveu nas últimas 24h, respeitando o teto e o intervalo
   * das mensagens automáticas. Devolve quantas saíram (0 ou 1).
   */
  async lembretes(): Promise<number> {
    const { store, cfg, servico, wa } = this.d
    if (!rotinaLigada(store, 'retomada') || !this.modoQr) return 0
    const agora = this.agoraMs()
    const hora = horaLocalDe(servico.regras, agora)
    if (hora < HORA_CLIENTE_DE || hora >= HORA_CLIENTE_ATE || !abertoEm(servico.regras, agora)) return 0
    if (this.d.conectado && !this.d.conectado()) return 0
    if (store.pausa(agora)) return 0 // assistente pausado: a equipe está cuidando
    if (!podeEnviarAutomatica(store, servico).ok) return 0

    const limite = agora - JANELA_CLIENTE_HORAS * HORA
    const transferencias = store.transferenciasSemResposta(limite)
    const emTransferencia = new Set(transferencias.map((t) => t.chat))
    const candidatos: Candidato[] = [
      ...transferencias.filter((t) => agora - t.ts >= LEMBRETE_TRANSFERIDA_APOS_MIN * MIN).map((t): Candidato => ({ tipo: 'lembrete_transferida', chat: t.chat, ref: t.id, desde: t.ts })),
      ...store
        .conversasParadas(limite, agora - LEMBRETE_PARADA_APOS_MIN * MIN, agora)
        .filter((p) => !emTransferencia.has(p.chat))
        .map((p): Candidato => ({ tipo: 'lembrete_parou', chat: p.chat, ref: p.cliente, desde: p.bot })),
    ]

    for (const c of candidatos) {
      if (store.acompanhamentoFeito(c.chat, 'pulado', c.ref) || store.acompanhamentoFeito(c.chat, c.tipo, c.ref)) continue
      const historico = store.historico(c.chat, 300)
      const pular = this.motivoDePular(c, historico)
      if (pular) {
        store.registrarAcompanhamento(c.chat, 'pulado', c.ref, `pulado: ${pular}`, agora)
        continue
      }
      const texto = this.textoDoLembrete(c, historico)
      if (!store.registrarAcompanhamento(c.chat, c.tipo, c.ref, 'enviando', agora, texto)) continue // antes de enviar: no máximo uma vez
      try {
        await wa.enviarTexto(c.chat, texto)
        store.adicionarMensagem(c.chat, 'assistant', texto, agora) // o bot sabe a que o cliente está respondendo
        store.atualizarAcompanhamento(c.chat, c.tipo, c.ref, 'enviado')
        // Depois do lembrete a conversa volta para o bot (transferida e sem resposta da equipe).
        if (c.tipo === 'lembrete_transferida') store.liberarHandoff(c.chat)
        registrarAutomaticaEnviada(store, servico, this.d.aleatorio)
        console.log(`[acompanhamento] ${c.tipo === 'lembrete_transferida' ? 'lembrete a cliente transferido' : 'lembrete a cliente parado'} enviado (${enviadasHoje(store, servico)}/${AUTOMATICAS_POR_DIA} automáticas hoje)`)
        return 1
      } catch (err) {
        store.atualizarAcompanhamento(c.chat, c.tipo, c.ref, `falhou: ${err instanceof Error ? err.message : String(err)}`)
        console.error('[acompanhamento] não consegui enviar o lembrete:', err instanceof Error ? err.message : err)
      }
    }
    return 0
  }
}
