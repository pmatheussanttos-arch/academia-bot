import { createSign } from 'node:crypto'

/** Um evento da agenda, já simplificado para o que o bot precisa. */
export interface EventoAgenda {
  id: string
  titulo: string
  /** Eventos "livres" (transparent) e cancelados não ocupam horário. */
  ocupa: boolean
  /** Evento de dia inteiro: início e fim são datas AAAA-MM-DD (o fim não está incluído). */
  diaInteiro?: { de: string; ate: string }
  inicio?: number
  fim?: number
  /** Texto da descrição (o bot e o painel gravam o WhatsApp do cliente aqui). */
  descricao?: string
  /** Marcas internas gravadas na criação (origem, quem marcou, WhatsApp), invisíveis na tela do Google Agenda. */
  privado?: Record<string, string>
}

export interface NovoEvento {
  titulo: string
  descricao: string
  inicio: number
  fim: number
  fuso: string
  /** Marcas internas, invisíveis na tela do Google Agenda. */
  privado?: Record<string, string>
}

/** O que o bot usa do Google Agenda; os testes trocam por uma versão falsa. */
export interface GoogleAgendaApi {
  listarEventos(agendaId: string, desde: number, ate: number): Promise<EventoAgenda[]>
  criarEvento(agendaId: string, evento: NovoEvento): Promise<string>
  /** Devolve null se o evento foi apagado ou cancelado. */
  obterEvento(agendaId: string, eventoId: string): Promise<EventoAgenda | null>
  /** Apaga o evento. Não dá erro se ele já não existir. */
  removerEvento(agendaId: string, eventoId: string): Promise<void>
  /** Muda o horário de um evento, mantendo o resto (título, WhatsApp...). `descricao` e `privado` só mexem se informados. */
  moverEvento(agendaId: string, eventoId: string, mudanca: MudancaEvento): Promise<void>
}

export interface MudancaEvento {
  inicio: number
  fim: number
  fuso: string
  descricao?: string
  /** Marcas a acrescentar às que o evento já tem (as outras continuam). */
  privado?: Record<string, string>
}

export class ErroGoogle extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
  ) {
    super(mensagem)
  }
}

interface EventoBruto {
  id?: string
  status?: string
  summary?: string
  description?: string
  transparency?: string
  extendedProperties?: { private?: Record<string, string> }
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
}

export function normalizarEvento(e: EventoBruto): EventoAgenda {
  const ocupa = e.status !== 'cancelled' && e.transparency !== 'transparent'
  const base = {
    id: e.id ?? '',
    titulo: e.summary ?? '',
    ocupa,
    ...(e.description ? { descricao: e.description } : {}),
    ...(e.extendedProperties?.private ? { privado: e.extendedProperties.private } : {}),
  }
  if (e.start?.date && e.end?.date) return { ...base, diaInteiro: { de: e.start.date, ate: e.end.date } }
  const inicio = e.start?.dateTime ? Date.parse(e.start.dateTime) : NaN
  const fim = e.end?.dateTime ? Date.parse(e.end.dateTime) : NaN
  if (Number.isNaN(inicio) || Number.isNaN(fim)) return { ...base, ocupa: false }
  return { ...base, inicio, fim }
}

export interface CredenciaisGoogle {
  clientEmail: string
  privateKey: string
}

/** Aceita o conteúdo do arquivo JSON da conta de serviço, puro ou em base64. */
export function lerCredenciaisGoogle(bruto: string): CredenciaisGoogle {
  const texto = bruto.trim()
  let json: { client_email?: unknown; private_key?: unknown }
  try {
    json = JSON.parse(texto.startsWith('{') ? texto : Buffer.from(texto, 'base64').toString('utf8'))
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não é um JSON válido (cole o conteúdo inteiro do arquivo baixado do Google).')
  }
  if (typeof json.client_email !== 'string' || typeof json.private_key !== 'string') {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON está sem "client_email" ou "private_key": confira se é o arquivo de chave da conta de serviço.')
  }
  const privateKey = json.private_key.includes('\n') ? json.private_key : json.private_key.replace(/\\n/g, '\n')
  return { clientEmail: json.client_email, privateKey }
}

const ESCOPO = 'https://www.googleapis.com/auth/calendar.events'
const URL_TOKEN = 'https://oauth2.googleapis.com/token'
const URL_API = 'https://www.googleapis.com/calendar/v3/calendars'

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url')
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Conversa com o Google Agenda usando uma conta de serviço (sem tela de login). */
export class ClienteGoogleAgenda implements GoogleAgendaApi {
  private token?: { valor: string; expira: number }

  constructor(
    private cred: CredenciaisGoogle,
    private fetchFn: typeof fetch = fetch,
    private agoraMs: () => number = Date.now,
  ) {}

  /** Monta o "passe" assinado que o Google troca por um token de acesso (válido por cerca de 1 hora). */
  private assinarJwt(): string {
    const iat = Math.floor(this.agoraMs() / 1000)
    const corpo = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
      JSON.stringify({ iss: this.cred.clientEmail, scope: ESCOPO, aud: URL_TOKEN, iat, exp: iat + 3600 }),
    )}`
    const assinatura = createSign('RSA-SHA256').update(corpo).sign(this.cred.privateKey)
    return `${corpo}.${b64url(assinatura)}`
  }

  private async obterToken(): Promise<string> {
    if (this.token && this.token.expira - 60_000 > this.agoraMs()) return this.token.valor
    const res = await this.fetchFn(URL_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: this.assinarJwt() }),
      signal: AbortSignal.timeout(15_000),
    })
    const dados = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string }
    if (!res.ok || !dados.access_token) {
      throw new ErroGoogle(`Google recusou o acesso da conta de serviço: ${dados.error_description ?? dados.error ?? res.status}`, res.status)
    }
    this.token = { valor: dados.access_token, expira: this.agoraMs() + (dados.expires_in ?? 3600) * 1000 }
    return this.token.valor
  }

  private async requisitar(metodo: string, url: string, corpo?: unknown, tentativa = 1): Promise<Response> {
    const token = await this.obterToken()
    const res = await this.fetchFn(url, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(15_000),
    })
    if (tentativa < 2 && (res.status === 429 || res.status >= 500)) {
      await dormir(500)
      return this.requisitar(metodo, url, corpo, tentativa + 1)
    }
    if (tentativa < 2 && res.status === 401) {
      this.token = undefined
      return this.requisitar(metodo, url, corpo, tentativa + 1)
    }
    return res
  }

  private async falhar(res: Response, acao: string): Promise<never> {
    const dados = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new ErroGoogle(`Google Agenda (${acao}): ${dados.error?.message ?? res.status}`, res.status)
  }

  async listarEventos(agendaId: string, desde: number, ate: number): Promise<EventoAgenda[]> {
    const saida: EventoAgenda[] = []
    let pagina: string | undefined
    do {
      const params = new URLSearchParams({
        timeMin: new Date(desde).toISOString(),
        timeMax: new Date(ate).toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
      })
      if (pagina) params.set('pageToken', pagina)
      const res = await this.requisitar('GET', `${URL_API}/${encodeURIComponent(agendaId)}/events?${params}`)
      if (!res.ok) await this.falhar(res, 'listar eventos')
      const dados = (await res.json()) as { items?: EventoBruto[]; nextPageToken?: string }
      for (const e of dados.items ?? []) saida.push(normalizarEvento(e))
      pagina = dados.nextPageToken
    } while (pagina)
    return saida
  }

  async criarEvento(agendaId: string, e: NovoEvento): Promise<string> {
    const res = await this.requisitar('POST', `${URL_API}/${encodeURIComponent(agendaId)}/events`, {
      summary: e.titulo,
      description: e.descricao,
      start: { dateTime: new Date(e.inicio).toISOString(), timeZone: e.fuso },
      end: { dateTime: new Date(e.fim).toISOString(), timeZone: e.fuso },
      ...(e.privado ? { extendedProperties: { private: e.privado } } : {}),
    })
    if (!res.ok) await this.falhar(res, 'criar evento')
    const dados = (await res.json()) as { id?: string }
    if (!dados.id) throw new ErroGoogle('Google Agenda não devolveu o ID do evento criado.', 502)
    return dados.id
  }

  async removerEvento(agendaId: string, eventoId: string): Promise<void> {
    const res = await this.requisitar('DELETE', `${URL_API}/${encodeURIComponent(agendaId)}/events/${encodeURIComponent(eventoId)}`)
    if (res.status === 404 || res.status === 410) return // já não existe: o objetivo (horário livre) está cumprido
    if (!res.ok) await this.falhar(res, 'apagar evento')
  }

  async moverEvento(agendaId: string, eventoId: string, m: MudancaEvento): Promise<void> {
    const res = await this.requisitar('PATCH', `${URL_API}/${encodeURIComponent(agendaId)}/events/${encodeURIComponent(eventoId)}`, {
      start: { dateTime: new Date(m.inicio).toISOString(), timeZone: m.fuso },
      end: { dateTime: new Date(m.fim).toISOString(), timeZone: m.fuso },
      ...(m.descricao !== undefined ? { description: m.descricao } : {}),
      ...(m.privado ? { extendedProperties: { private: m.privado } } : {}),
    })
    if (!res.ok) await this.falhar(res, 'mover evento')
  }

  async obterEvento(agendaId: string, eventoId: string): Promise<EventoAgenda | null> {
    const res = await this.requisitar('GET', `${URL_API}/${encodeURIComponent(agendaId)}/events/${encodeURIComponent(eventoId)}`)
    if (res.status === 404 || res.status === 410) return null
    if (!res.ok) await this.falhar(res, 'consultar evento')
    const evento = normalizarEvento((await res.json()) as EventoBruto)
    return evento.ocupa ? evento : null
  }
}
