/**
 * Formatadores de data reaproveitados.
 *
 * Criar um `new Intl.DateTimeFormat(...)` a cada data gasta memória nativa (fora do JavaScript) que o Node quase
 * nunca devolve: o painel, que formata cada avaliação da agenda, fazia o bot passar do limite de memória da Render.
 * Aqui cada combinação (idioma + opções) é criada uma vez só e guardada.
 */
const guardados = new Map<string, Intl.DateTimeFormat>()

export function formatoData(idioma: string, opcoes: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormat {
  const chave = `${idioma}|${JSON.stringify(opcoes)}`
  let f = guardados.get(chave)
  if (!f) {
    f = new Intl.DateTimeFormat(idioma, opcoes)
    // Poucas combinações existem de verdade (um fuso só); o limite é só proteção.
    if (guardados.size >= 200) guardados.clear()
    guardados.set(chave, f)
  }
  return f
}

/** Quantos formatadores estão guardados (para os testes). */
export function formatadoresGuardados(): number {
  return guardados.size
}
