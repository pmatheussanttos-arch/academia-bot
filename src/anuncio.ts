/**
 * Quem chegou pelo anúncio (Facebook/Instagram, "clique para o WhatsApp").
 * Dois sinais: o cartão do anúncio que o WhatsApp manda junto (lido em baileys-parse) e o texto pronto que o botão
 * do anúncio escreve pela pessoa ("Olá! Posso ter mais informações sobre isso?").
 */

export const EVENTO_ANUNCIO = 'veio_do_anuncio'

/** Textos prontos que o Facebook/Instagram colocam no botão do anúncio (em português). */
const TEXTOS_PRONTOS = [
  /posso ter mais informa[cç][oõ]es sobre isso/i,
  /tenho interesse e (gostaria|queria) (de )?(saber )?mais informa[cç][oõ]es/i,
  /quero saber mais sobre (isso|o an[uú]ncio)/i,
]

export function ehTextoDeAnuncio(texto: string | undefined): boolean {
  if (!texto) return false
  const t = texto.trim()
  return t.length <= 160 && TEXTOS_PRONTOS.some((r) => r.test(t))
}

/** Aviso para a IA: a pessoa clicou no anúncio e já quer saber da oferta. */
export const DICA_ANUNCIO =
  'Esta pessoa chegou clicando num ANÚNCIO da academia (a primeira mensagem dela é o texto pronto do botão do anúncio, como "Posso ter mais informações sobre isso?"). Ela já quer saber da oferta: NÃO pergunte se ela quer conhecer a promoção. Se houver campanha em andamento, siga a mensagem para quem veio do anúncio. Peça o NOME primeiro, sozinho (só depois o objetivo).'
