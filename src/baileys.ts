import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
} from '@whiskeysockets/baileys'
import { classificar, ehLid, numeroDeJid, telefoneDaChave, type MensagemBaileys } from './baileys-parse.js'
import { normalizarNumero } from './config.js'
import type { Comando } from './pausa.js'
import type { ClienteWhatsapp, MensagemRecebida } from './whatsapp.js'

export type StatusConexao = 'iniciando' | 'aguardando_qr' | 'conectado' | 'desconectado' | 'desligado'

export interface EstadoWhatsapp {
  status: StatusConexao
  /** Texto bruto do QR code atual (para desenhar a imagem). Só existe enquanto aguarda leitura. */
  qr?: string
  /** Número conectado, quando já pareado. */
  numero?: string
  /** Última mudança de status. */
  desde: number
  /** Mensagem curta de diagnóstico para a tela. */
  detalhe?: string
}

export interface HandlersBaileys {
  /** Chama o atendimento para uma mensagem de cliente (o servidor serializa por número). */
  dispatch: (msg: MensagemRecebida) => void
  /** A equipe respondeu pelo próprio celular: o bot deve silenciar aquele cliente. */
  humano: (numero: string, texto: string | undefined, transferido: boolean) => void
  /** O celular da academia escreveu um comando (pausar, retomar...) na conversa consigo mesmo. `responder` escreve lá. */
  comando: (comando: Comando, responder: (texto: string) => Promise<void>) => void
}

/** Logger mínimo no formato que a Baileys espera; silencioso, exceto avisos e erros. */
interface LoggerBaileys {
  level: string
  child(obj: Record<string, unknown>): LoggerBaileys
  trace(obj: unknown, msg?: string): void
  debug(obj: unknown, msg?: string): void
  info(obj: unknown, msg?: string): void
  warn(obj: unknown, msg?: string): void
  error(obj: unknown, msg?: string): void
}

const logSilencioso: LoggerBaileys = {
  level: 'silent',
  child: () => logSilencioso,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: (o: unknown, m?: string) => console.error('[baileys]', m ?? o),
  error: (o: unknown, m?: string) => console.error('[baileys]', m ?? o),
}

const LIMITE_IDS = 400

/**
 * Conecta ao WhatsApp pelo método de QR code (biblioteca Baileys), no mesmo número da academia.
 * ATENÇÃO: esse método não é oficial e pode levar ao banimento do número (ver QR-WHATSAPP.md).
 */
export class DriverBaileys implements ClienteWhatsapp {
  private sock?: WASocket
  private estadoAtual: EstadoWhatsapp = { status: 'iniciando', desde: Date.now() }
  private handlers?: HandlersBaileys
  private readonly authDir: string
  /** ids de mensagens enviadas pelo bot, para não reagir ao próprio eco. */
  private readonly idsDoBot = new Set<string>()
  /** número do cliente -> JID exato de onde a última mensagem veio (para responder no lugar certo). */
  private readonly jidPorNumero = new Map<string, string>()
  /** número da equipe -> JID confirmado pelo WhatsApp (resolve detalhes como o 9 extra dos celulares). */
  private readonly jidDaEquipe = new Map<string, string>()
  /** wamid -> chave completa, para marcar como lida. */
  private readonly chavePorWamid = new Map<string, MensagemBaileys['key']>()
  private encerrando = false
  private tentativaReconexao = 0

  constructor(
    private readonly opts: { dataDir: string; onEstado?: (e: EstadoWhatsapp) => void },
  ) {
    this.authDir = join(opts.dataDir, 'whatsapp-sessao')
  }

  estado(): EstadoWhatsapp {
    return this.estadoAtual
  }

  private mudarEstado(parcial: Partial<EstadoWhatsapp>): void {
    this.estadoAtual = { ...this.estadoAtual, ...parcial, desde: Date.now() }
    this.opts.onEstado?.(this.estadoAtual)
  }

  private lembrarId(set: Set<string>, id: string): void {
    set.add(id)
    if (set.size > LIMITE_IDS) set.delete(set.values().next().value as string)
  }

  async iniciar(handlers: HandlersBaileys): Promise<void> {
    this.handlers = handlers
    await this.conectar()
  }

  private async conectar(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir)

    let version: [number, number, number] | undefined
    try {
      version = (await fetchLatestBaileysVersion()).version
    } catch {
      // sem rede para descobrir a versão: a lib usa a padrão dela
    }

    const sock = makeWASocket({
      auth: state,
      version,
      logger: logSilencioso,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false, // não "rouba" as notificações do celular da equipe
      syncFullHistory: false,
      printQRInTerminal: false,
    })
    this.sock = sock

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', (u) => {
      if (u.qr) this.mudarEstado({ status: 'aguardando_qr', qr: u.qr, detalhe: 'Escaneie o QR code no WhatsApp.' })
      if (u.connection === 'open') {
        this.tentativaReconexao = 0
        const numero = sock.user?.id ? sock.user.id.split(':')[0]?.replace(/\D/g, '') : undefined
        this.mudarEstado({ status: 'conectado', qr: undefined, numero, detalhe: undefined })
        console.log(`[baileys] conectado${numero ? ` como +${numero}` : ''}`)
      }
      if (u.connection === 'close') this.aoFechar(u.lastDisconnect?.error)
    })

    sock.ev.on('messages.upsert', (ev) => {
      if (ev.type !== 'notify') return // 'append' = sincronização de histórico, não mensagens novas
      for (const m of ev.messages) this.tratarInbound(m as MensagemBaileys).catch((e) => console.error('[baileys] inbound:', e))
    })
  }

  private async aoFechar(erro: unknown): Promise<void> {
    if (this.encerrando) return
    const codigo = (erro as { output?: { statusCode?: number } })?.output?.statusCode

    if (codigo === DisconnectReason.loggedOut) {
      // A sessão foi desconectada no celular (ou o número foi deslogado): apaga e pede novo QR.
      console.error('[baileys] sessão encerrada no WhatsApp; será preciso escanear o QR de novo')
      await rm(this.authDir, { recursive: true, force: true }).catch(() => {})
      this.mudarEstado({ status: 'aguardando_qr', numero: undefined, detalhe: 'Desconectado no WhatsApp. Escaneie o QR de novo.' })
      return this.conectar()
    }

    this.tentativaReconexao++
    const espera = Math.min(30_000, 2 ** this.tentativaReconexao * 1000)
    this.mudarEstado({ status: 'desconectado', detalhe: `Reconectando em ${Math.round(espera / 1000)}s…` })
    console.error(`[baileys] conexão caiu (código ${codigo ?? '?'}); reconectando em ${espera}ms`)
    setTimeout(() => {
      if (!this.encerrando) this.conectar().catch((e) => console.error('[baileys] falha ao reconectar:', e))
    }, espera).unref()
  }

  /**
   * O WhatsApp pode identificar o contato por um código interno (@lid) em vez do telefone. Descobrimos o telefone pelo
   * que veio na própria mensagem ou pela tabela de conversão que a biblioteca mantém; sem isso, o filtro de teste e os
   * avisos à equipe ficariam com um número que não existe.
   */
  private async descobrirTelefone(key: MensagemBaileys['key']): Promise<string | undefined> {
    const direto = telefoneDaChave(key)
    if (direto || !ehLid(key.remoteJid) || !this.sock) return direto
    try {
      const pn = await this.sock.signalRepository.lidMapping.getPNForLID(key.remoteJid!)
      return pn ? numeroDeJid(pn) || undefined : undefined
    } catch {
      return undefined
    }
  }

  /** Dígitos do telefone e do código interno do próprio número da academia (para reconhecer a conversa consigo mesmo). */
  private identificadoresProprios(): string[] {
    const eu = this.sock?.user
    return [eu?.id, eu?.lid].map((j) => numeroDeJid(j)).filter(Boolean)
  }

  private async enviarNoChat(jid: string, texto: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp ainda não conectado')
    const enviado = await this.sock.sendMessage(jid, { text: texto })
    if (enviado?.key?.id) this.lembrarId(this.idsDoBot, enviado.key.id)
  }

  private async tratarInbound(m: MensagemBaileys): Promise<void> {
    const telefone = ehLid(m.key.remoteJid) ? await this.descobrirTelefone(m.key) : undefined
    const c = classificar(m, this.idsDoBot, telefone, this.identificadoresProprios())
    if (c.acao === 'ignorar' || c.acao === 'eco') return

    if (c.acao === 'humano') {
      // A equipe respondeu pelo celular: o bot sai da conversa.
      this.handlers?.humano(c.numero, undefined, c.transferido)
      return
    }

    if (c.acao === 'comando') {
      this.handlers?.comando(c.comando, (texto) => this.enviarNoChat(c.jid, texto))
      return
    }

    // Mensagem de cliente.
    this.jidPorNumero.set(c.msg.from, c.jid)
    if (c.msg.wamid) {
      this.chavePorWamid.set(c.msg.wamid, m.key)
      if (this.chavePorWamid.size > LIMITE_IDS) this.chavePorWamid.delete(this.chavePorWamid.keys().next().value as string)
    }
    this.handlers?.dispatch(c.msg)
  }

  // --- ClienteWhatsapp ---

  async enviarTexto(numero: string, texto: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp ainda não conectado')
    const jid = this.jidPorNumero.get(numero) ?? `${numero.replace(/\D/g, '')}@s.whatsapp.net`
    const enviado = await this.sock.sendMessage(jid, { text: texto })
    if (enviado?.key?.id) this.lembrarId(this.idsDoBot, enviado.key.id)
  }

  /**
   * Manda um aviso para o WhatsApp de alguém da equipe, a partir do número da academia. Lança erro se não conseguir
   * (quem chama decide se tenta de novo).
   */
  async enviarAviso(numero: string, texto: string): Promise<void> {
    if (!this.sock || this.estadoAtual.status !== 'conectado') throw new Error('WhatsApp da academia desconectado')
    const proprio = this.estadoAtual.numero
    if (proprio && normalizarNumero(proprio) === normalizarNumero(numero)) {
      throw new Error(
        `o número de avisos (+${numero}) é o MESMO número conectado ao bot: o aviso cairia numa conversa consigo mesmo e ninguém seria notificado. Use o celular de outra pessoa da equipe.`,
      )
    }
    let jid = this.jidDaEquipe.get(numero)
    if (!jid) {
      const achado = (await this.sock.onWhatsApp(numero))?.[0]
      if (!achado?.exists) throw new Error(`+${numero} não tem WhatsApp (ou não foi possível confirmar)`)
      jid = achado.jid
      this.jidDaEquipe.set(numero, jid)
    }
    const enviado = await this.sock.sendMessage(jid, { text: texto })
    if (enviado?.key?.id) this.lembrarId(this.idsDoBot, enviado.key.id)
  }

  async marcarLida(wamid: string): Promise<void> {
    const chave = this.chavePorWamid.get(wamid)
    if (this.sock && chave) await this.sock.readMessages([chave])
  }

  async encerrar(): Promise<void> {
    this.encerrando = true
    try {
      this.sock?.end(undefined)
    } catch {
      // nada a fazer no desligamento
    }
    this.mudarEstado({ status: 'desligado' })
  }
}
