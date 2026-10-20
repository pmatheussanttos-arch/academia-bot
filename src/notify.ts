import type { Config } from './config.js'

export type Notificador = (texto: string) => Promise<void>

export interface CanaisAviso {
  fetchFn?: typeof fetch
  /**
   * Manda um aviso para o WhatsApp de um membro da equipe (só no modo QR; o bot envia do número da academia).
   * Deve lançar erro se não conseguir: o notificador tenta de novo.
   */
  whatsapp?: (numero: string, texto: string) => Promise<void>
  /** Esperas entre as tentativas quando o envio por WhatsApp falha, em ms. Depois da última, desiste. */
  esperasMs?: number[]
  /** Teto de avisos por WhatsApp por hora (protege o número da academia contra rajadas). */
  limitePorHora?: number
  prazoEnvioMs?: number
  agora?: () => number
}

export type NotificadorComEnvios = Notificador & {
  /** Espera os envios por WhatsApp em andamento (inclusive as novas tentativas). Útil em testes e no desligamento. */
  aguardarEnvios(): Promise<void>
}

const UMA_HORA = 3_600_000

function descrever(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Rejeita se a promessa não terminar no prazo (uma conexão travada não pode ficar pendurada para sempre). */
function comPrazo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout
  const limite = new Promise<never>((_, rejeitar) => {
    timer = setTimeout(() => rejeitar(new Error(`sem resposta em ${Math.round(ms / 1000)}s`)), ms)
  })
  return Promise.race([promessa, limite]).finally(() => clearTimeout(timer))
}

/**
 * Avisa a equipe (por exemplo, quando um cliente precisa de uma pessoa). Sempre escreve no log; além disso usa os
 * canais configurados: Telegram e/ou WhatsApp da equipe. O WhatsApp não bloqueia o atendimento: se falhar, tenta de
 * novo em segundo plano. Nunca lança erro: falhar em avisar não pode derrubar o atendimento.
 */
export function criarNotificador(cfg: Config, canais: CanaisAviso = {}): NotificadorComEnvios {
  const fetchFn = canais.fetchFn ?? fetch
  const esperas = canais.esperasMs ?? [10_000, 60_000, 300_000]
  const limite = canais.limitePorHora ?? 60
  const prazo = canais.prazoEnvioMs ?? 20_000
  const agora = canais.agora ?? Date.now
  const enviadosNaJanela: number[] = []
  const emAndamento = new Set<Promise<void>>()

  async function telegram(texto: string): Promise<void> {
    if (!cfg.telegram) return
    try {
      const res = await fetchFn(`https://api.telegram.org/bot${cfg.telegram.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: cfg.telegram.chatId, text: texto }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) console.error(`[aviso à equipe] Telegram respondeu ${res.status}`)
    } catch (err) {
      console.error('[aviso à equipe] falha ao chamar o Telegram:', descrever(err))
    }
  }

  function dentroDoLimite(): boolean {
    const t = agora()
    while (enviadosNaJanela.length > 0 && t - enviadosNaJanela[0]! > UMA_HORA) enviadosNaJanela.shift()
    if (enviadosNaJanela.length >= limite) return false
    enviadosNaJanela.push(t)
    return true
  }

  async function whatsapp(numero: string, texto: string): Promise<void> {
    for (let tentativa = 0; ; tentativa++) {
      try {
        await comPrazo(canais.whatsapp!(numero, texto), prazo)
        return
      } catch (err) {
        const espera = esperas[tentativa]
        if (espera === undefined) {
          console.error(`[aviso à equipe] desisti de avisar +${numero} pelo WhatsApp: ${descrever(err)}`)
          return
        }
        console.error(`[aviso à equipe] não consegui avisar +${numero} pelo WhatsApp (${descrever(err)}); nova tentativa em ${Math.round(espera / 1000)}s`)
        await new Promise((r) => setTimeout(r, espera))
      }
    }
  }

  const notificar: Notificador = async (texto) => {
    console.log(`[aviso à equipe] ${texto.replace(/\n/g, ' | ')}`)
    await telegram(texto)
    if (!canais.whatsapp) return
    for (const numero of cfg.numerosAvisos) {
      if (!dentroDoLimite()) {
        console.error(`[aviso à equipe] limite de ${limite} avisos por hora pelo WhatsApp atingido; este só ficou no log`)
        continue
      }
      const envio: Promise<void> = whatsapp(numero, texto).finally(() => emAndamento.delete(envio))
      emAndamento.add(envio)
    }
  }

  return Object.assign(notificar, {
    async aguardarEnvios() {
      while (emAndamento.size > 0) await Promise.all([...emAndamento])
    },
  })
}

/** Evita repetir o mesmo alerta técnico (ex.: token expirado) a cada mensagem. */
export function limitarAvisos(notificar: Notificador, intervaloMs = 10 * 60_000) {
  const ultimo = new Map<string, number>()
  return async (chave: string, texto: string): Promise<void> => {
    const agora = Date.now()
    if (agora - (ultimo.get(chave) ?? 0) < intervaloMs) return
    ultimo.set(chave, agora)
    await notificar(texto)
  }
}
