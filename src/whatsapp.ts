import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ConfigWhatsapp } from './config.js'

export interface MensagemRecebida {
  wamid: string
  from: string
  nome: string
  tipo: string
  texto?: string
  /** Código interno (`lid`) com que o WhatsApp identificou o remetente, quando ele difere do telefone em `from`. */
  lid?: string
}

export interface ClienteWhatsapp {
  enviarTexto(para: string, texto: string, responderA?: string): Promise<void>
  marcarLida(wamid: string): Promise<void>
}

export class ErroWhatsapp extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
    readonly codigo?: number,
  ) {
    super(mensagem)
  }
}

/** Confere que o webhook veio mesmo da Meta (HMAC-SHA256 do corpo com o App Secret). */
export function verificarAssinatura(corpoBruto: string, cabecalho: string | undefined, appSecret: string): boolean {
  if (!cabecalho) return false
  const recebida = cabecalho.replace(/^sha256=/, '')
  if (!recebida) return false
  const esperada = createHmac('sha256', appSecret).update(corpoBruto).digest('hex')
  const a = Buffer.from(recebida)
  const b = Buffer.from(esperada)
  return a.length === b.length && timingSafeEqual(a, b)
}

interface WaMensagem {
  id: string
  from: string
  type: string
  text?: { body: string }
  image?: { caption?: string }
  document?: { caption?: string }
  video?: { caption?: string }
  interactive?: {
    button_reply?: { title?: string }
    list_reply?: { title?: string }
  }
  button?: { text?: string }
}

interface WaPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string }
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>
        messages?: WaMensagem[]
      }
    }>
  }>
}

/** Extrai as mensagens de clientes de um webhook, só do número de telefone configurado. */
export function extrairMensagens(payload: unknown, phoneNumberId: string): MensagemRecebida[] {
  const saida: MensagemRecebida[] = []
  const p = payload as WaPayload
  for (const entry of p?.entry ?? []) {
    for (const mudanca of entry.changes ?? []) {
      const valor = mudanca.value
      if (!valor?.messages) continue
      if (valor.metadata?.phone_number_id !== phoneNumberId) continue
      const nomes = new Map<string, string>()
      for (const c of valor.contacts ?? []) {
        if (c.wa_id) nomes.set(c.wa_id, c.profile?.name ?? '')
      }
      for (const m of valor.messages) {
        const nome = nomes.get(m.from) ?? ''
        const base = { wamid: m.id, from: m.from, nome }
        switch (m.type) {
          case 'text':
            saida.push({ ...base, tipo: 'text', texto: m.text?.body })
            break
          case 'interactive': {
            // Clique em botão/lista que a academia enviou. Tratamos como texto.
            const titulo = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title
            saida.push({ ...base, tipo: titulo ? 'text' : 'interactive', texto: titulo })
            break
          }
          case 'button':
            saida.push({ ...base, tipo: m.button?.text ? 'text' : 'button', texto: m.button?.text })
            break
          case 'image':
          case 'document':
          case 'video': {
            const legenda = m[m.type]?.caption
            saida.push({ ...base, tipo: m.type, texto: legenda })
            break
          }
          default:
            saida.push({ ...base, tipo: m.type })
        }
      }
    }
  }
  return saida
}

/** O WhatsApp aceita até 4096 caracteres por mensagem; quebramos em parágrafos antes disso. */
export function dividirTexto(texto: string, max = 3800): string[] {
  if (texto.length <= max) return [texto]
  const partes: string[] = []
  let atual = ''
  for (const paragrafo of texto.split(/\n{2,}/)) {
    if (paragrafo.length > max) {
      if (atual) partes.push(atual)
      atual = ''
      for (let i = 0; i < paragrafo.length; i += max) partes.push(paragrafo.slice(i, i + max))
      continue
    }
    const candidato = atual ? `${atual}\n\n${paragrafo}` : paragrafo
    if (candidato.length > max) {
      partes.push(atual)
      atual = paragrafo
    } else {
      atual = candidato
    }
  }
  if (atual) partes.push(atual)
  return partes
}

export function criarClienteWhatsapp(cfg: ConfigWhatsapp, fetchFn: typeof fetch = fetch): ClienteWhatsapp {
  const base = `https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`

  async function chamar(corpo: Record<string, unknown>): Promise<void> {
    const res = await fetchFn(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.accessToken}` },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...corpo }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      let codigo: number | undefined
      let detalhe = ''
      try {
        const dados = (await res.json()) as { error?: { code?: number; message?: string } }
        codigo = dados.error?.code
        detalhe = dados.error?.message ?? ''
      } catch {
        // resposta sem JSON: segue só com o status
      }
      throw new ErroWhatsapp(`WhatsApp API ${res.status}${codigo ? ` (código ${codigo})` : ''}: ${detalhe}`, res.status, codigo)
    }
  }

  return {
    async enviarTexto(para, texto, responderA) {
      const partes = dividirTexto(texto)
      for (const [i, parte] of partes.entries()) {
        await chamar({
          to: para,
          type: 'text',
          text: { body: parte, preview_url: false },
          ...(i === 0 && responderA ? { context: { message_id: responderA } } : {}),
        })
      }
    },
    async marcarLida(wamid) {
      await chamar({ status: 'read', message_id: wamid })
    },
  }
}
