import { hojeISO, limitesDoDia } from './agenda.js'
import type { ServicoAgenda } from './agendamento.js'
import type { Store } from './store.js'

/**
 * Regras que valem para QUALQUER mensagem automática que o bot manda a um cliente por iniciativa própria (lembrete de
 * avaliação, retomada de conversa): no máximo 10 por dia, contadas juntas, e um intervalo aleatório de 1 a 5 minutos entre
 * uma e outra. Rajadas e horários regulares são o que mais chama a atenção do WhatsApp (risco de bloqueio no modo QR).
 */

export const AUTOMATICAS_POR_DIA = 10
export const INTERVALO_MIN_MS = 60_000
export const INTERVALO_MAX_MS = 300_000

const CHAVE_PROXIMA = 'automatica_proxima'

/** Quantas mensagens automáticas a clientes já saíram hoje (todas as rotinas somadas). */
export function enviadasHoje(store: Store, servico: ServicoAgenda): number {
  const hoje = hojeISO(servico.agora(), servico.regras.fusoHorario)
  const desde = limitesDoDia(servico.regras, hoje).de
  return store.contarLembretes(desde, 'enviado') + store.contarAcompanhamentos(desde, 'lembrete_', 'enviado')
}

/** Pode sair uma mensagem automática agora? Só se o teto do dia não foi atingido e já passou o intervalo desde a última. */
export function podeEnviarAutomatica(store: Store, servico: ServicoAgenda): { ok: true } | { ok: false; motivo: string } {
  if (enviadasHoje(store, servico) >= AUTOMATICAS_POR_DIA) return { ok: false, motivo: 'teto diário' }
  const proxima = Number(store.lerAjuste(CHAVE_PROXIMA) ?? 0)
  if (servico.agora().getTime() < proxima) return { ok: false, motivo: 'intervalo' }
  return { ok: true }
}

/** Marca que uma automática acabou de sair: a próxima só depois de 1 a 5 minutos (sorteado). */
export function registrarAutomaticaEnviada(store: Store, servico: ServicoAgenda, aleatorio: () => number = Math.random): void {
  const espera = Math.min(INTERVALO_MAX_MS, INTERVALO_MIN_MS + Math.floor(aleatorio() * (INTERVALO_MAX_MS - INTERVALO_MIN_MS + 1)))
  store.definirAjuste(CHAVE_PROXIMA, String(servico.agora().getTime() + espera))
}

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** O cliente pediu para não ser incomodado? Olha tudo o que ele escreveu. */
const PEDIU_PARA_PARAR =
  /\b(pare|parar|para de (me )?(mandar|enviar|escrever|chamar|incomodar)|nao quero|nao tenho interesse|sem interesse|nao preciso|me deixa em paz|nao (me )?(mande|envie|chame|escreva)|remova|stop|descadastr\w*)\b/

export function pediuParaParar(mensagensDoCliente: string[]): boolean {
  return mensagensDoCliente.some((m) => PEDIU_PARA_PARAR.test(semAcento(m)))
}
