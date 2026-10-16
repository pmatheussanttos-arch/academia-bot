/**
 * Número de WhatsApp da recepção (o que a equipe atende pelo app). O bot atende num número só dele, onde
 * não há ninguém lendo, então quando o cliente precisa de uma pessoa ele recebe um link que abre a
 * conversa com a recepção, já com a mensagem pronta.
 */
export function normalizarNumeroRecepcao(bruto: string): string {
  let n = bruto.replace(/\D/g, '')
  if (n.length === 10 || n.length === 11) n = `55${n}`
  if (!/^55\d{10,11}$/.test(n)) {
    throw new Error('NUMERO_RECEPCAO inválido: informe o WhatsApp da recepção com DDD, por exemplo 11999998888.')
  }
  return n
}

export function linkRecepcao(numero: string | undefined, mensagem: string): string | undefined {
  return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(mensagem.slice(0, 500))}` : undefined
}
