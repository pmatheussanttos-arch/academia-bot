import type { Store } from './store.js'

/**
 * Pausa GERAL do assistente (todos os clientes). Dois jeitos de acionar, com as mesmas regras: o botão da página
 * /conectar e uma palavra que o celular da academia escreve na conversa consigo mesmo.
 * (Pausar só UMA conversa é outra coisa: a palavra "transferido" escrita na conversa do cliente, tratada em baileys.ts.)
 */

export type Comando =
  | { acao: 'pausar'; horas: number | null } // null = até alguém reativar
  | { acao: 'retomar' }
  | { acao: 'status' }
  | { acao: 'ajuda' }

/** Pausa sem prazo explícito: volta sozinha, porque uma pausa esquecida deixaria os clientes sem resposta. */
export const PAUSA_PADRAO_HORAS = 1
export const PAUSA_MAX_HORAS = 72

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Normaliza para comparar: sem acento, minúsculas, sem barra inicial nem pontuação final. */
function normalizar(texto: string): string {
  return semAcento(texto)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[/!]+/, '')
    .replace(/[.!?\s]+$/, '')
}

/** A palavra "transferido" (ou "transferida"), escrita pelo celular da academia numa conversa de cliente. */
export function ehPalavraTransferido(texto: string | undefined): boolean {
  return texto !== undefined && /^transferid[oa]$/.test(normalizar(texto))
}

/**
 * Entende a mensagem inteira como comando ou devolve undefined (conversa normal). Só reconhece mensagens que SÃO
 * o comando, não frases que o contenham ("quero pausar meu plano" não é comando).
 */
export function interpretarComando(texto: string | undefined): Comando | undefined {
  if (!texto) return undefined
  const t = normalizar(texto)
  if (t === 'retomar' || t === 'reativar') return { acao: 'retomar' }
  if (t === 'status') return { acao: 'status' }
  if (t === 'ajuda' || t === 'comandos') return { acao: 'ajuda' }
  const m = /^pausar(?: (sempre|(\d{1,4})(?: ?(?:h|hora|horas))?))?$/.exec(t)
  if (!m) return undefined
  if (m[1] === 'sempre') return { acao: 'pausar', horas: null }
  if (m[2] === undefined) return { acao: 'pausar', horas: PAUSA_PADRAO_HORAS }
  const horas = Number(m[2])
  return horas >= 1 && horas <= PAUSA_MAX_HORAS ? { acao: 'pausar', horas } : { acao: 'ajuda' }
}

export function aplicarPausa(store: Store, horas: number | null, agora = Date.now()): void {
  store.pausar(horas === null ? null : agora + horas * 3_600_000)
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** "às 15:30" se for hoje, "em 21/10 às 08:00" se não. No fuso da academia. */
export function quando(ate: number, fuso: string, agora = Date.now()): string {
  const f = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const partes = (ms: number) => Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  const a = partes(ate)
  const hoje = partes(agora)
  const hora = `às ${a.hour}:${a.minute}`
  return a.day === hoje.day && a.month === hoje.month ? hora : `em ${a.day}/${a.month} ${hora}`
}

export function descreverPausa(pausa: { ate: number | null } | undefined, fuso: string, agora = Date.now()): string {
  if (!pausa) return '🟢 Assistente ativo: está respondendo os clientes.'
  if (pausa.ate === null) return '⏸️ Assistente pausado até você reativar.'
  return `⏸️ Assistente pausado: volta sozinho ${quando(pausa.ate, fuso, agora)}.`
}

const AJUDA = [
  'Comandos do assistente (envie só a palavra):',
  '• pausar: pausa por 1 hora',
  '• pausar 5: pausa por 5 horas (de 1 a 72)',
  '• pausar sempre: pausa até você reativar',
  '• retomar: volta a responder',
  '• status: mostra se está ativo',
].join('\n')

/** Executa o comando e devolve o texto de confirmação para quem o enviou. */
export function respostaComando(store: Store, comando: Comando, fuso: string, agora = Date.now()): string {
  switch (comando.acao) {
    case 'pausar': {
      aplicarPausa(store, comando.horas, agora)
      const titulo =
        comando.horas === null
          ? '⏸️ Assistente pausado até você reativar.'
          : `⏸️ Assistente pausado por ${plural(comando.horas, 'hora', 'horas')}: volta sozinho ${quando(agora + comando.horas * 3_600_000, fuso, agora)}.`
      return [
        titulo,
        'Enquanto estiver pausado ele não responde ninguém, e as mensagens ficam não lidas no celular para a equipe ver.',
        'Para voltar antes, envie: retomar',
      ].join('\n')
    }
    case 'retomar':
      return store.retomar() ? '▶️ Assistente reativado: volta a responder os clientes.' : '🟢 O assistente já estava ativo.'
    case 'status':
      return descreverPausa(store.pausa(agora), fuso, agora)
    case 'ajuda':
      return AJUDA
  }
}
