import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { Store } from './store.js'

/**
 * Acesso à agenda dos professores. Não tem senha nem login: a página mora num endereço secreto
 * (/agenda/<código>), que fica no grupo privado da equipe. Quem não tem o endereço recebe 404,
 * como se a página não existisse. O código é gerado pelo dono na página de administração e pode
 * ser trocado a qualquer momento, o que derruba o endereço antigo.
 */

/** 26 caracteres sorteados (156 bits): impossível de adivinhar tentando. */
export function gerarCodigo(): string {
  return randomBytes(21).toString('base64url').slice(0, 26)
}

const FORMATO = /^[A-Za-z0-9_-]{16,64}$/

export function codigoValido(c: string): boolean {
  return FORMATO.test(c)
}

/** Comparação que não entrega o código pelo tempo de resposta. */
export function codigosIguais(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export interface EstadoAgendaProfessores {
  ligada: boolean
  codigo?: string
  professores: string[]
}

const CHAVE_CODIGO = 'agenda_codigo'
const MAX_PROFESSORES = 40

/** Nomes dos professores que aparecem na lista da página (quem fez cada ação). */
export function lerProfessores(bruto: string | undefined): string[] {
  const nomes = (bruto ?? '')
    .split(',')
    .map((n) => n.replace(/[\r\n\t<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40))
    .filter(Boolean)
  return [...new Set(nomes)].slice(0, MAX_PROFESSORES)
}

export class AcessoAgenda {
  constructor(
    private store: Store,
    private professores: string[],
  ) {}

  estado(): EstadoAgendaProfessores {
    const codigo = this.store.lerAjuste(CHAVE_CODIGO)
    return { ligada: codigo !== undefined, ...(codigo ? { codigo } : {}), professores: this.professores }
  }

  /** Liga a página (ou troca o endereço por um novo, derrubando o anterior). Devolve o código novo. */
  ligar(): string {
    const codigo = gerarCodigo()
    this.store.definirAjuste(CHAVE_CODIGO, codigo)
    return codigo
  }

  /** Desliga a página: o endereço para de funcionar na hora. */
  desligar(): boolean {
    return this.store.apagarAjuste(CHAVE_CODIGO)
  }

  /** O código do endereço confere? Falso também quando a página está desligada. */
  liberado(codigo: string | undefined): boolean {
    const atual = this.store.lerAjuste(CHAVE_CODIGO)
    return atual !== undefined && codigo !== undefined && codigosIguais(atual, codigo)
  }

  /** O nome tem que ser um dos da lista: o registro de quem fez cada ação não aceita nome digitado. */
  professorValido(nome: string | undefined): boolean {
    return nome !== undefined && this.professores.includes(nome)
  }
}
