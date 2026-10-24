import type { Config } from './config.js'
import { carregarMensagens, renderizar, type Mensagens } from './mensagens.js'

/**
 * Link de pagamento no cartão (InfinitePay). Os links são criados pelo dono no aplicativo da InfinitePay (um por valor) e
 * ficam no mensagens.md, na seção "links-pagamento", uma linha por plano: `chave | endereço`. O bot só ENVIA o link certo.
 * Ele não vê quem pagou: a equipe confere o comprovante, e o bot nunca confirma pagamento sozinho. Dados de cartão nunca
 * passam pelo WhatsApp: são digitados só na página da InfinitePay.
 */

export const PLANOS_PAGAMENTO = {
  '3x_por_semana': '3x por semana',
  acesso_livre: 'Acesso livre',
  trimestral_vip: 'Trimestral VIP (total R$ 269,70)',
  semestral_vip: 'Semestral VIP (total R$ 479,40)',
  anual_vip: 'Anual VIP (total R$ 838,80)',
} as const

export type ChavePlano = keyof typeof PLANOS_PAGAMENTO
export const CHAVES_PLANOS = Object.keys(PLANOS_PAGAMENTO) as ChavePlano[]

/** Até quantas parcelas a página do link oferece em cada plano VIP (os planos básicos são mensais, sem parcelamento). */
export const PARCELAS_MAXIMAS: Partial<Record<ChavePlano, number>> = { trimestral_vip: 3, semestral_vip: 6, anual_vip: 12 }

/** Só endereços https da própria InfinitePay: o que estiver fora disso no arquivo é ignorado, nunca enviado ao cliente. */
const LINK_VALIDO = /^https:\/\/([a-z0-9-]+\.)*infinitepay\.io\/\S+$/i

/** Lê a seção "links-pagamento". Linhas em branco, comentários (#) e chaves ou endereços inválidos são ignorados. */
export function lerLinksPagamento(secoes: Mensagens): Partial<Record<ChavePlano, string>> {
  const links: Partial<Record<ChavePlano, string>> = {}
  for (const linha of (secoes['links-pagamento'] ?? '').split('\n')) {
    const limpa = linha.trim()
    if (!limpa || limpa.startsWith('#')) continue
    const [chave, ...resto] = limpa.split('|')
    const url = resto.join('|').trim()
    const k = chave?.trim() as ChavePlano
    if (CHAVES_PLANOS.includes(k) && LINK_VALIDO.test(url)) links[k] = url
  }
  return links
}

/** Descobre o plano a partir do texto livre que o cliente ou o bot escreveu ("Anual VIP (12x de R$ 69,90)", "3x por semana"...). */
export function chaveDoPlano(texto: string): ChavePlano | undefined {
  const t = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (/trimestral/.test(t)) return 'trimestral_vip'
  if (/semestral/.test(t)) return 'semestral_vip'
  if (/anual/.test(t)) return 'anual_vip'
  if (/livre|todos os dias/.test(t)) return 'acesso_livre'
  if (/\b3x\b|tres vezes|3 vezes/.test(t)) return '3x_por_semana'
  return undefined
}

export const PAGAMENTO_CARTAO_RESERVA =
  'Segue o link para pagar no cartão ({plano}) 👇\n{link}\n{parcelamento}\n\nÉ o pagamento seguro da InfinitePay: os dados do cartão você digita só lá, nunca por aqui. Depois de pagar, é só me enviar o comprovante que a recepção confere e finaliza o seu cadastro 😊'

export const CARTAO_NA_RECEPCAO_RESERVA = 'O cartão é passado na recepção da academia. Pode vir no seu horário que a equipe finaliza tudo com você. Qualquer dúvida, tô aqui!'

function secoes(cfg: Config): Mensagens {
  try {
    return carregarMensagens(cfg.mensagensPath)
  } catch {
    return {} // mensagens.md ilegível: sem link, o cartão cai na recepção
  }
}

/** A mensagem com o link do plano, ou undefined se o plano não tem link configurado. */
export function textoPagamentoCartao(cfg: Config, chave: ChavePlano): string | undefined {
  const s = secoes(cfg)
  const link = lerLinksPagamento(s)[chave]
  if (!link) return undefined
  const parcelas = PARCELAS_MAXIMAS[chave]
  const parcelamento = parcelas ? `Na própria página você pode parcelar em até ${parcelas}x.` : ''
  return renderizar(s['pagamento-cartao']?.trim() || PAGAMENTO_CARTAO_RESERVA, { plano: PLANOS_PAGAMENTO[chave], link, parcelamento })
}

/** O trecho "como pagar no cartão" da mensagem de matrícula: o link, se o plano tem, ou o aviso de pagar na recepção. */
export function trechoCartaoDaMatricula(cfg: Config, plano: string): string {
  const chave = chaveDoPlano(plano)
  const comLink = chave ? textoPagamentoCartao(cfg, chave) : undefined
  return comLink ?? (secoes(cfg)['cartao-recepcao']?.trim() || CARTAO_NA_RECEPCAO_RESERVA)
}
