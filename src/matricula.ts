import { limparNome } from './prompt.js'

/**
 * Cadastro da matrícula feito pela conversa do WhatsApp: o assistente recolhe os dados, a equipe
 * lança depois na plataforma da academia. O bot não cobra nem confirma pagamento: só registra o
 * pedido, informa a forma combinada e passa para a equipe.
 */

export type FormaPagamento = 'pix' | 'cartao'

export interface DadosMatricula {
  nome: string
  /** Só dígitos, com 55. */
  telefone: string
  email: string
  /** AAAA-MM-DD, ou vazio se a pessoa não quis informar. */
  nascimento: string
  plano: string
  pagamento: FormaPagamento
  observacao: string
}

export type Validacao = { ok: true; dados: DadosMatricula } | { ok: false; motivo: string }

const SO_DIGITOS = (t: string) => t.replace(/\D/g, '')

/** Telefone brasileiro em dígitos com 55. Vazio quando não dá para aproveitar o que foi digitado. */
export function normalizarTelefone(bruto: string): string {
  let n = SO_DIGITOS(bruto)
  if (n.length === 10 || n.length === 11) n = `55${n}`
  return /^55\d{10,11}$/.test(n) ? n : ''
}

/** Aceita 31/12/1990, 31-12-1990 ou 1990-12-31. Devolve AAAA-MM-DD, ou vazio se não for data real. */
export function normalizarNascimento(bruto: string): string {
  const t = bruto.trim()
  let a: number, m: number, d: number
  const br = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(t)
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (br) [d, m, a] = [Number(br[1]), Number(br[2]), Number(br[3])]
  else if (iso) [a, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  else return ''
  const data = new Date(Date.UTC(a, m - 1, d))
  if (data.getUTCFullYear() !== a || data.getUTCMonth() !== m - 1 || data.getUTCDate() !== d) return ''
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function idadeEm(nascimentoISO: string, agora: Date): number {
  const [a, m, d] = nascimentoISO.split('-').map(Number) as [number, number, number]
  let idade = agora.getUTCFullYear() - a
  const mes = agora.getUTCMonth() + 1
  if (mes < m || (mes === m && agora.getUTCDate() < d)) idade--
  return idade
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i

export const IDADE_MINIMA = 13

/**
 * Confere o que o assistente recolheu. Devolve um motivo em português quando falta algo:
 * esse texto volta para o modelo, que pergunta ao cliente de novo.
 */
export function validarMatricula(entrada: Partial<Record<keyof DadosMatricula, string>>, agora: Date): Validacao {
  const nome = limparNome(entrada.nome).replace(/\s+/g, ' ')
  if (nome.split(' ').filter((p) => p.length > 1).length < 2) {
    return { ok: false, motivo: 'Falta o nome completo: peça o nome e o sobrenome do cliente.' }
  }

  const telefone = normalizarTelefone(entrada.telefone ?? '')
  if (!telefone) return { ok: false, motivo: 'Telefone inválido: peça o número com DDD, por exemplo (11) 99999-8888.' }

  const email = (entrada.email ?? '').trim()
  if (email !== '' && !EMAIL.test(email)) {
    return { ok: false, motivo: 'E-mail inválido: confirme com o cliente ou registre sem e-mail (ele é opcional).' }
  }

  const bruto = (entrada.nascimento ?? '').trim()
  const nascimento = bruto === '' ? '' : normalizarNascimento(bruto)
  if (bruto !== '' && nascimento === '') {
    return { ok: false, motivo: 'Data de nascimento inválida: peça no formato dia/mês/ano, por exemplo 25/03/1990.' }
  }
  if (nascimento !== '') {
    const idade = idadeEm(nascimento, agora)
    if (idade < 0 || idade > 120) return { ok: false, motivo: 'Data de nascimento fora do comum: confirme o ano com o cliente.' }
    if (idade < IDADE_MINIMA) {
      return { ok: false, motivo: `O cliente tem ${idade} anos e a idade mínima é ${IDADE_MINIMA}. Não registre a matrícula: use chamar_humano para a equipe orientar.` }
    }
  }

  const plano = (entrada.plano ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!plano) return { ok: false, motivo: 'Falta o plano escolhido: confirme qual plano o cliente quer.' }

  const p = (entrada.pagamento ?? '').toLowerCase()
  const pagamento: FormaPagamento | undefined = p === 'pix' ? 'pix' : p === 'cartao' || p === 'cartão' ? 'cartao' : undefined
  if (!pagamento) return { ok: false, motivo: 'Falta a forma de pagamento: pergunte se vai ser no Pix ou no cartão.' }

  return {
    ok: true,
    dados: { nome, telefone, email, nascimento, plano, pagamento, observacao: (entrada.observacao ?? '').replace(/[\r\t]+/g, ' ').trim().slice(0, 300) },
  }
}

/** dd/mm/aaaa para mostrar à equipe. */
export function nascimentoBonito(iso: string): string {
  if (!iso) return ''
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

/** Aviso que vai para o WhatsApp da equipe, com tudo o que ela precisa para lançar na plataforma. */
export function avisoDeMatricula(d: DadosMatricula, chat: string, jaPagou = false): string {
  return [
    '📝 MATRÍCULA PELO WHATSAPP (lançar na plataforma)',
    ...(jaPagou ? ['💰 O cliente diz que JÁ PAGOU: confira o comprovante antes de finalizar'] : []),
    `Nome: ${d.nome}`,
    `Telefone: +${d.telefone}`,
    ...(d.email ? [`E-mail: ${d.email}`] : ['E-mail: (não informado)']),
    ...(d.nascimento ? [`Nascimento: ${nascimentoBonito(d.nascimento)}`] : ['Nascimento: (não informado)']),
    `Plano: ${d.plano}`,
    `Pagamento: ${d.pagamento === 'pix' ? 'Pix (o cliente recebeu a chave; confira o comprovante)' : 'cartão na recepção'}`,
    ...(d.observacao ? [`Obs.: ${d.observacao}`] : []),
    `Conversa: +${chat}`,
  ].join('\n')
}
