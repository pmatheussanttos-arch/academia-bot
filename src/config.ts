import { lerCredenciaisGoogle } from './google.js'
import { normalizarNumeroRecepcao } from './recepcao.js'

export type Esforco = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface ConfigWhatsapp {
  accessToken: string
  phoneNumberId: string
  verifyToken: string
  appSecret: string
  apiVersion: string
}

export type ModoWhatsapp = 'qr' | 'cloud'

export interface Config {
  /** 'qr': conecta no número da academia por QR code (não oficial). 'cloud': API oficial da Meta. */
  modoWhatsapp: ModoWhatsapp
  model: string
  effort: Esforco
  port: number
  dataDir: string
  instrucoesPath: string
  /** Regras de horário das visitas (aula experimental e avaliação). */
  agendaPath: string
  /** Textos que o bot envia ao cliente quando agenda uma visita. */
  mensagensPath: string
  /** Google Agenda das avaliações. Sem isto, o bot trabalha em modo manual (a equipe confirma). */
  google?: { agendaId: string; clientEmail: string; privateKey: string }
  /** Se o bot agenda avaliações sozinho no Google Agenda (precisa de `google`). */
  agendamentoAutomatico: boolean
  /** WhatsApp da recepção (só dígitos, com 55). Se definido, o bot entrega um link para falar com a equipe. */
  numeroRecepcao?: string
  /** Horas em que o bot fica calado depois de passar a conversa para uma pessoa (0 = não se cala). */
  handoffHoras: number
  /** Máximo de mensagens que um mesmo número pode mandar por hora (protege o seu custo). */
  limiteMsgsPorHora: number
  /** Quantas mensagens recentes entram no contexto de cada resposta. */
  historicoMax: number
  /** Dias que as conversas ficam guardadas (LGPD: não guarde mais do que precisa). */
  retencaoDias: number
  /** Se preenchida, o bot só responde a estes números (modo de teste). Vazia = todos. */
  numerosPermitidos: string[]
  /**
   * WhatsApps da equipe que recebem os avisos do bot (pedido de avaliação, cliente que quer uma pessoa).
   * Só no modo QR: o bot manda a mensagem do próprio número da academia. Devem ser OUTROS números.
   */
  numerosAvisos: string[]
  adminToken?: string
  telegram?: { token: string; chatId: string }
  /** Só é exigido pelo servidor; o modo de teste no terminal (npm run chat) dispensa. */
  whatsapp: Partial<ConfigWhatsapp>
  permitirInstrucoesIncompletas: boolean
  /** Só para testes: deixa o servidor subir sem NUMERO_RECEPCAO (o cliente que pedir uma pessoa ficaria sem saída). */
  permitirSemRecepcao: boolean
}

const ESFORCOS: Esforco[] = ['low', 'medium', 'high', 'xhigh', 'max']

function numero(valor: string | undefined, padrao: number): number {
  if (valor === undefined || valor.trim() === '') return padrao
  const n = Number(valor)
  return Number.isFinite(n) && n > 0 ? n : padrao
}

function lista(valor: string | undefined): string[] {
  return (valor ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function carregarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const idAgenda = env.GOOGLE_CALENDAR_ID?.trim()
  const credenciais = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()
  if (Boolean(idAgenda) !== Boolean(credenciais)) {
    throw new Error('Para usar o Google Agenda, preencha GOOGLE_CALENDAR_ID e GOOGLE_SERVICE_ACCOUNT_JSON (os dois), ou deixe os dois vazios.')
  }
  const google =
    idAgenda && credenciais ? { agendaId: idAgenda, ...lerCredenciaisGoogle(credenciais) } : undefined
  const recepcaoBruta = env.NUMERO_RECEPCAO?.trim()
  const numeroRecepcao = recepcaoBruta ? normalizarNumeroRecepcao(recepcaoBruta) : undefined
  // Com número da recepção o cliente fala direto com uma pessoa; calar o bot só o deixaria sem resposta.
  const horasBrutas = env.HANDOFF_HORAS?.trim()
  const handoffHoras =
    horasBrutas && Number.isFinite(Number(horasBrutas)) && Number(horasBrutas) >= 0 ? Number(horasBrutas) : numeroRecepcao ? 0 : 6
  const modoWhatsapp: ModoWhatsapp = (env.WHATSAPP_MODO?.trim() || 'cloud') === 'qr' ? 'qr' : 'cloud'
  // Avisos por WhatsApp só existem no modo QR (a API oficial só envia texto livre dentro de 24h da última mensagem do cliente).
  // Sem NUMEROS_AVISOS, usa o NUMERO_RECEPCAO, se houver.
  const avisosBrutos = lista(env.NUMEROS_AVISOS)
  const numerosAvisos =
    modoWhatsapp !== 'qr'
      ? []
      : [...new Set(avisosBrutos.length > 0 ? avisosBrutos.map((n) => normalizarNumeroRecepcao(n, 'NUMEROS_AVISOS')) : numeroRecepcao ? [numeroRecepcao] : [])]
  const effort = (env.CLAUDE_EFFORT ?? 'low') as Esforco
  const telegramToken = env.TELEGRAM_BOT_TOKEN?.trim()
  const telegramChat = env.TELEGRAM_CHAT_ID?.trim()

  return {
    modoWhatsapp,
    model: env.CLAUDE_MODEL?.trim() || 'claude-haiku-5-5',
    effort: ESFORCOS.includes(effort) ? effort : 'low',
    port: numero(env.PORT, 3000),
    dataDir: env.DATA_DIR?.trim() || './data',
    instrucoesPath: env.INSTRUCOES_PATH?.trim() || './instrucoes.md',
    agendaPath: env.AGENDA_PATH?.trim() || './agenda.json',
    mensagensPath: env.MENSAGENS_PATH?.trim() || './mensagens.md',
    google,
    agendamentoAutomatico: google !== undefined && env.AGENDAMENTO_AUTOMATICO !== '0',
    numeroRecepcao,
    handoffHoras,
    limiteMsgsPorHora: numero(env.LIMITE_MSGS_POR_HORA, 30),
    historicoMax: numero(env.HISTORICO_MAX, 30),
    retencaoDias: numero(env.RETENCAO_DIAS, 90),
    numerosPermitidos: lista(env.NUMEROS_PERMITIDOS),
    numerosAvisos,
    adminToken: env.ADMIN_TOKEN?.trim() || undefined,
    telegram: telegramToken && telegramChat ? { token: telegramToken, chatId: telegramChat } : undefined,
    permitirInstrucoesIncompletas: env.PERMITIR_INSTRUCOES_INCOMPLETAS === '1',
    permitirSemRecepcao: env.PERMITIR_SEM_RECEPCAO === '1',
    whatsapp: {
      accessToken: env.WHATSAPP_ACCESS_TOKEN?.trim(),
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID?.trim(),
      verifyToken: env.WHATSAPP_VERIFY_TOKEN?.trim(),
      appSecret: env.WHATSAPP_APP_SECRET?.trim(),
      apiVersion: env.WHATSAPP_API_VERSION?.trim() || 'v21.0',
    },
  }
}

/** Garante que as variáveis do WhatsApp existem; usado só pelo servidor. */
export function exigirWhatsapp(cfg: Config): ConfigWhatsapp {
  const w = cfg.whatsapp
  const faltando: string[] = []
  if (!w.accessToken) faltando.push('WHATSAPP_ACCESS_TOKEN')
  if (!w.phoneNumberId) faltando.push('WHATSAPP_PHONE_NUMBER_ID')
  if (!w.verifyToken) faltando.push('WHATSAPP_VERIFY_TOKEN')
  if (!w.appSecret) faltando.push('WHATSAPP_APP_SECRET')
  if (faltando.length > 0) {
    throw new Error(`Variáveis de ambiente faltando: ${faltando.join(', ')}`)
  }
  return w as ConfigWhatsapp
}

/**
 * Os números chegam em formatos diferentes (com/sem +55, com/sem o 9 extra dos celulares).
 * Normalizamos para comparar: só dígitos e, em celular brasileiro, sem o 9 depois do DDD.
 */
export function normalizarNumero(bruto: string): string {
  let n = bruto.replace(/\D/g, '')
  if (n.length === 11 || n.length === 10) n = `55${n}` // DDD + número sem o 55
  if (n.startsWith('55') && n.length === 13 && n[4] === '9') {
    n = n.slice(0, 4) + n.slice(5)
  }
  return n
}

/** Está na lista? Diferente de `numeroPermitido`, lista vazia = ninguém. */
export function numeroNaLista(numero: string, lista: string[]): boolean {
  if (lista.length === 0) return false
  const alvo = normalizarNumero(numero)
  return lista.some((p) => normalizarNumero(p) === alvo)
}

export function numeroPermitido(numero: string, permitidos: string[]): boolean {
  return permitidos.length === 0 || numeroNaLista(numero, permitidos)
}

/**
 * O WhatsApp às vezes identifica o remetente por um código interno (`lid`) em vez do telefone. Quem monta a
 * mensagem tenta descobrir o telefone; se não conseguir, `numero` é o próprio código. Por isso o modo de teste
 * aceita o telefone OU o código na lista.
 */
export function remetentePermitido(cfg: Pick<Config, 'numerosPermitidos'>, numero: string, lid?: string): boolean {
  return numeroPermitido(numero, cfg.numerosPermitidos) || (lid !== undefined && numeroNaLista(lid, cfg.numerosPermitidos))
}

/**
 * Quem recebe os avisos é equipe, não cliente: se responder um aviso, o bot não deve atender como se fosse um
 * cliente. Exceção: se o número também está em NUMEROS_PERMITIDOS, quem está testando (normalmente o dono) quer
 * mesmo conversar com o bot.
 */
export function ehNumeroDaEquipe(cfg: Pick<Config, 'numerosAvisos' | 'numerosPermitidos'>, numero: string, lid?: string): boolean {
  if (!numeroNaLista(numero, cfg.numerosAvisos)) return false
  const testando = numeroNaLista(numero, cfg.numerosPermitidos) || (lid !== undefined && numeroNaLista(lid, cfg.numerosPermitidos))
  return !testando
}
