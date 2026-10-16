import type { Config } from './config.js'

export type Notificador = (texto: string) => Promise<void>

/**
 * Avisa a equipe (por exemplo, quando um cliente precisa de uma pessoa). Usa o Telegram porque
 * não depende da janela de 24h do WhatsApp. Sem Telegram configurado, só escreve no log.
 * Nunca lança erro: falhar em avisar não pode derrubar o atendimento.
 */
export function criarNotificador(cfg: Config, fetchFn: typeof fetch = fetch): Notificador {
  return async (texto) => {
    console.log(`[aviso à equipe] ${texto.replace(/\n/g, ' | ')}`)
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
      console.error('[aviso à equipe] falha ao chamar o Telegram:', err instanceof Error ? err.message : err)
    }
  }
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
