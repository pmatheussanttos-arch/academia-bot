import { existsSync, readFileSync } from 'node:fs'
import { hojeISO } from './agenda.js'

/**
 * Campanha com data (ex.: Black GarageFit). O texto fica no campanha.md e entra no prompt SOZINHO entre as datas do arquivo,
 * e sai sozinho depois: não precisa de novo deploy para ligar nem para desligar. Se o arquivo não existir ou estiver torto,
 * o bot funciona sem campanha (um erro aqui nunca pode deixar o cliente sem resposta).
 */

export type FaseCampanha = 'ativa' | 'semana_final' | 'ultimo_dia' | 'encerrada'

export interface Campanha {
  inicio: string
  semanaFinal: string
  fim: string
  encerradaAte: string
  texto: string
  textoEncerrada: string
}

export interface CampanhaDoDia {
  fase: FaseCampanha
  /** O que entra no prompt (bloco estável, igual durante todo o período). */
  texto: string
  /** Frase curta sobre o dia de hoje, no bloco que muda a cada mensagem. */
  aviso: string
}

const DATA = /^\d{4}-\d{2}-\d{2}$/

/** Lê o campanha.md. Devolve undefined (e avisa no log) se não existir ou estiver inválido. */
export function carregarCampanha(caminho: string): Campanha | undefined {
  if (!existsSync(caminho)) return undefined
  try {
    const bruto = readFileSync(caminho, 'utf8')
    const partes = bruto.split(/^## (.+)$/m)
    const cabecalho = partes[0] ?? ''
    const secoes: Record<string, string> = {}
    for (let i = 1; i < partes.length; i += 2) secoes[partes[i]!.trim()] = (partes[i + 1] ?? '').trim()
    const data = (chave: string): string => {
      const m = new RegExp(`^${chave}:\\s*(\\S+)\\s*$`, 'm').exec(cabecalho)
      if (!m || !DATA.test(m[1]!)) throw new Error(`falta "${chave}: AAAA-MM-DD" no começo do arquivo`)
      return m[1]!
    }
    const c: Campanha = {
      inicio: data('inicio'),
      semanaFinal: data('semana-final'),
      fim: data('fim'),
      encerradaAte: data('encerrada-ate'),
      texto: secoes.campanha ?? '',
      textoEncerrada: secoes.encerrada ?? '',
    }
    if (!c.texto) throw new Error('falta a seção "## campanha"')
    if (!(c.inicio <= c.semanaFinal && c.semanaFinal <= c.fim && c.fim <= c.encerradaAte)) throw new Error('as datas precisam estar em ordem: inicio, semana-final, fim, encerrada-ate')
    return c
  } catch (err) {
    console.error(`[campanha] ${caminho} ignorado: ${err instanceof Error ? err.message : err}`)
    return undefined
  }
}

/** O que a campanha pede para hoje (no fuso da academia), ou undefined se hoje está fora de qualquer fase. */
export function campanhaDoDia(c: Campanha | undefined, agora: Date, fuso: string): CampanhaDoDia | undefined {
  if (!c) return undefined
  const hoje = hojeISO(agora, fuso)
  const dia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
  if (hoje >= c.inicio && hoje <= c.fim) {
    if (hoje === c.fim) return { fase: 'ultimo_dia', texto: c.texto, aviso: `CAMPANHA: hoje, ${dia(hoje)}, é o ÚLTIMO DIA da campanha: use a mensagem 8 quando fizer sentido.` }
    if (hoje >= c.semanaFinal) return { fase: 'semana_final', texto: c.texto, aviso: `CAMPANHA: hoje, ${dia(hoje)}, é a SEMANA FINAL da campanha (termina em ${dia(c.fim)}): use a mensagem 7 quando fizer sentido.` }
    return { fase: 'ativa', texto: c.texto, aviso: `CAMPANHA: hoje, ${dia(hoje)}, a campanha está valendo (até ${dia(c.fim)}).` }
  }
  if (hoje > c.fim && hoje <= c.encerradaAte && c.textoEncerrada) {
    return { fase: 'encerrada', texto: c.textoEncerrada, aviso: `CAMPANHA: terminou em ${dia(c.fim)}. Não ofereça mais as condições dela.` }
  }
  return undefined
}
