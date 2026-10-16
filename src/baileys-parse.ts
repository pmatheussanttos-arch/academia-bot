/**
 * Funções puras para interpretar as mensagens do WhatsApp recebidas pela biblioteca Baileys (modo QR code).
 * Ficam separadas do código de conexão para poderem ser testadas sem um WhatsApp de verdade.
 */
import type { MensagemRecebida } from './whatsapp.js'

/** Forma mínima de uma mensagem do Baileys que usamos (evita depender dos tipos pesados da lib nos testes). */
export interface MensagemBaileys {
  key: {
    remoteJid?: string | null
    fromMe?: boolean | null
    id?: string | null
    participant?: string | null
  }
  message?: Record<string, unknown> | null
  pushName?: string | null
}

/** Chats de pessoa: número comum (@s.whatsapp.net) ou identificador novo do WhatsApp (@lid). */
export function ehChatPrivado(jid: string | null | undefined): boolean {
  if (!jid || jid === 'status@broadcast') return false
  return jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')
}

/** Extrai só os dígitos do número a partir do JID (parte antes do @, sem o sufixo de aparelho :NN). */
export function numeroDeJid(jid: string | null | undefined): string {
  if (!jid) return ''
  const usuario = jid.split('@')[0] ?? ''
  return (usuario.split(':')[0] ?? '').replace(/\D/g, '')
}

const ENVELOPES = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
] as const

/** Descasca os invólucros (mensagem temporária, ver uma vez, etc.) até o conteúdo real. */
export function conteudoReal(message: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  let atual = message ?? undefined
  for (let i = 0; i < 6 && atual; i++) {
    const envelope = ENVELOPES.find((e) => atual && typeof atual[e] === 'object' && atual[e] !== null)
    if (!envelope) break
    const interno = (atual[envelope] as { message?: Record<string, unknown> }).message
    if (!interno) break
    atual = interno
  }
  return atual
}

export interface ConteudoMensagem {
  tipo: string
  texto?: string
}

const COM_LEGENDA = ['imageMessage', 'videoMessage', 'documentMessage'] as const

/** Descobre o tipo da mensagem e o texto (ou legenda), no formato que o resto do bot já entende. */
export function interpretarConteudo(message: Record<string, unknown> | null | undefined): ConteudoMensagem {
  const c = conteudoReal(message)
  if (!c) return { tipo: 'unknown' }

  if (typeof c.conversation === 'string') return { tipo: 'text', texto: c.conversation }
  const ext = c.extendedTextMessage as { text?: string } | undefined
  if (ext && typeof ext.text === 'string') return { tipo: 'text', texto: ext.text }

  // Clique em botão ou item de lista que a academia tenha enviado: tratamos como texto.
  const btn = c.buttonsResponseMessage as { selectedDisplayText?: string } | undefined
  if (btn?.selectedDisplayText) return { tipo: 'text', texto: btn.selectedDisplayText }
  const lista = c.listResponseMessage as { title?: string } | undefined
  if (lista?.title) return { tipo: 'text', texto: lista.title }
  const template = c.templateButtonReplyMessage as { selectedDisplayText?: string } | undefined
  if (template?.selectedDisplayText) return { tipo: 'text', texto: template.selectedDisplayText }

  for (const chave of COM_LEGENDA) {
    const m = c[chave] as { caption?: string } | undefined
    if (m) return { tipo: chave.replace('Message', ''), texto: typeof m.caption === 'string' ? m.caption : undefined }
  }
  if (c.audioMessage) return { tipo: 'audio' }
  if (c.stickerMessage) return { tipo: 'sticker' }
  if (c.locationMessage) return { tipo: 'location' }
  if (c.contactMessage || c.contactsArrayMessage) return { tipo: 'contacts' }
  if (c.reactionMessage) return { tipo: 'reaction' }
  if (c.protocolMessage) return { tipo: 'protocol' } // edição/exclusão/sincronização: ignoramos
  return { tipo: 'unknown' }
}

export type Classificacao =
  | { acao: 'ignorar' }
  | { acao: 'eco' } // mensagem enviada pelo próprio bot que voltou
  | { acao: 'humano'; numero: string; jid: string } // a equipe respondeu pelo celular
  | { acao: 'cliente'; msg: MensagemRecebida; jid: string }

/**
 * Decide o que fazer com uma mensagem recebida.
 * @param idsDoBot ids de mensagens que o próprio bot enviou (para não reagir ao próprio eco)
 */
export function classificar(m: MensagemBaileys, idsDoBot: ReadonlySet<string>): Classificacao {
  const jid = m.key.remoteJid ?? ''
  if (!ehChatPrivado(jid)) return { acao: 'ignorar' } // grupos, status, listas de transmissão

  if (m.key.fromMe) {
    // Mensagem saiu deste número. Se foi o bot, é eco; senão, a equipe respondeu pelo celular.
    if (m.key.id && idsDoBot.has(m.key.id)) return { acao: 'eco' }
    return { acao: 'humano', numero: numeroDeJid(jid), jid }
  }

  const conteudo = interpretarConteudo(m.message)
  if (['unknown', 'protocol', 'reaction'].includes(conteudo.tipo)) return { acao: 'ignorar' }

  return {
    acao: 'cliente',
    jid,
    msg: {
      wamid: m.key.id ?? '',
      from: numeroDeJid(jid),
      nome: m.pushName ?? '',
      tipo: conteudo.tipo,
      texto: conteudo.texto,
    },
  }
}
