/**
 * Uso de memória do bot. A Render reinicia o serviço quando ele passa do limite do plano (512 MB no Starter);
 * estas leituras vão para o /health e para o log, para descobrir o que causou um pico.
 */

export interface LeituraMemoria {
  /** Memória total do processo (o que a Render compara com o limite), em MB. */
  rssMB: number
  /** Parte usada pelos objetos do JavaScript, em MB. */
  heapMB: number
  /** Maior uso total desde que o bot ligou, em MB. */
  picoMB: number
}

const MB = 1024 * 1024

export function lerMemoria(uso: NodeJS.MemoryUsage = process.memoryUsage(), picoKB = process.resourceUsage().maxRSS): LeituraMemoria {
  return { rssMB: Math.round(uso.rss / MB), heapMB: Math.round(uso.heapUsed / MB), picoMB: Math.round(picoKB / 1024) }
}

/** Linha de log: sempre que a memória mudar bastante, ou ficar alta (perto do limite). */
export class MonitorMemoria {
  private ultimoLogado = 0

  constructor(
    private readonly alertaMB = 400,
    private readonly variacaoMB = 40,
  ) {}

  /** Devolve a linha a registrar no log, ou undefined se nada mudou o bastante. */
  verificar(l: LeituraMemoria): string | undefined {
    const alta = l.rssMB >= this.alertaMB
    if (!alta && Math.abs(l.rssMB - this.ultimoLogado) < this.variacaoMB) return undefined
    this.ultimoLogado = l.rssMB
    return `[memória] ${alta ? '⚠️ ALTA ' : ''}uso ${l.rssMB} MB (objetos ${l.heapMB} MB, pico ${l.picoMB} MB)`
  }
}
