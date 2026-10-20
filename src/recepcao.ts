/**
 * Número de WhatsApp da recepção (o que a equipe atende pelo app). O bot atende num número só dele, onde
 * não há ninguém lendo, então quando o cliente precisa de uma pessoa ele recebe um link que abre a
 * conversa com a recepção, já com a mensagem pronta.
 */
export function normalizarNumeroRecepcao(bruto: string, variavel = 'NUMERO_RECEPCAO'): string {
  let n = bruto.replace(/\D/g, '')
  if (n.length === 10 || n.length === 11) n = `55${n}`
  if (!/^55\d{10,11}$/.test(n)) {
    throw new Error(`${variavel} inválido: informe o WhatsApp com DDD, por exemplo 11999998888 (recebi "${bruto.slice(0, 30)}").`)
  }
  return n
}

export function linkRecepcao(numero: string | undefined, mensagem: string): string | undefined {
  return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(mensagem.slice(0, 500))}` : undefined
}

/**
 * Como mostrar o WhatsApp do cliente nos avisos à equipe. Quando o WhatsApp esconde o telefone, o que temos é um
 * identificador interno de ~15 dígitos: mostrá-lo como "+2770…" só confundiria quem recebe o aviso.
 */
export function formatarWhatsapp(chat: string): string {
  return /^\d{8,13}$/.test(chat) ? `+${chat}` : '(telefone oculto pelo WhatsApp: procure a conversa pelo nome)'
}
