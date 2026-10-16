import { readFileSync } from 'node:fs'

export const SECOES_OBRIGATORIAS = [
  'avaliacao-agendada',
  'avaliacao-pedido',
  'experimental-pedido',
  'linha-valor-pago',
  'linha-valor-vip',
  'linha-mensalidade',
  'confirmacao-recepcao',
  'confirmacao-equipe',
] as const

export type Mensagens = Record<string, string>

/** Lê o mensagens.md: cada título "## nome" abre uma mensagem que vai até o próximo título. */
export function carregarMensagens(caminho: string): Mensagens {
  const texto = readFileSync(caminho, 'utf8')
  const partes = texto.split(/^## (.+)$/m)
  const secoes: Mensagens = {}
  for (let i = 1; i < partes.length; i += 2) secoes[partes[i]!.trim()] = (partes[i + 1] ?? '').trim()
  const faltando = SECOES_OBRIGATORIAS.filter((nome) => !secoes[nome])
  if (faltando.length > 0) {
    throw new Error(`mensagens.md está sem as seções: ${faltando.join(', ')}`)
  }
  return secoes
}

/** Troca {chave} pelos dados e tira linhas em branco sobrando. */
export function renderizar(modelo: string, dados: Record<string, string>): string {
  return modelo
    .replace(/\{(\w+)\}/g, (_, chave: string) => dados[chave] ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
