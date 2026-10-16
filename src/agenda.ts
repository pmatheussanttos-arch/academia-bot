import { readFileSync } from 'node:fs'

export type DiaSemana = 'dom' | 'seg' | 'ter' | 'qua' | 'qui' | 'sex' | 'sab'
const DIAS: DiaSemana[] = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']
const NOMES_DIAS: Record<DiaSemana, string> = {
  dom: 'domingo',
  seg: 'segunda-feira',
  ter: 'terça-feira',
  qua: 'quarta-feira',
  qui: 'quinta-feira',
  sex: 'sexta-feira',
  sab: 'sábado',
}

/** Regras de horário das visitas (aula experimental e avaliação). Ficam no arquivo agenda.json. */
export interface Agenda {
  fusoHorario: string
  /** Intervalo entre um horário e o seguinte, e duração reservada para cada visita. */
  duracaoMin: number
  /** Quantas visitas podem acontecer ao mesmo tempo. */
  capacidade: number
  /** Antecedência mínima, para a equipe ter tempo de se preparar. */
  antecedenciaMin: number
  diasMaximoFuturo: number
  /** Por dia da semana, pares [primeiro horário, último horário] (ambos incluídos). */
  janelas: Record<DiaSemana, Array<[string, string]>>
  /** Datas (AAAA-MM-DD) sem visitas, como feriados. */
  diasFechados: string[]
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const DATA = /^\d{4}-\d{2}-\d{2}$/

export function carregarAgenda(caminho: string): Agenda {
  let bruto: unknown
  try {
    bruto = JSON.parse(readFileSync(caminho, 'utf8'))
  } catch (err) {
    throw new Error(`Não consegui ler ${caminho}: ${err instanceof Error ? err.message : err}`)
  }
  const a = bruto as Partial<Agenda>
  const erro = (msg: string): never => {
    throw new Error(`agenda.json inválido: ${msg}`)
  }
  if (typeof a.fusoHorario !== 'string') erro('falta "fusoHorario"')
  const inteiro = (v: unknown, nome: string, min: number): number => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min) erro(`"${nome}" precisa ser um número inteiro maior ou igual a ${min}`)
    return v as number
  }
  const janelas = {} as Record<DiaSemana, Array<[string, string]>>
  for (const dia of DIAS) {
    const lista = a.janelas?.[dia] ?? []
    if (!Array.isArray(lista)) erro(`"janelas.${dia}" precisa ser uma lista`)
    janelas[dia] = lista.map((par) => {
      if (!Array.isArray(par) || par.length !== 2 || !HHMM.test(par[0]) || !HHMM.test(par[1]) || minutos(par[0]) > minutos(par[1])) {
        return erro(`"janelas.${dia}" tem um intervalo inválido (use ["07:00","10:30"])`)
      }
      return [par[0], par[1]] as [string, string]
    })
  }
  const diasFechados = a.diasFechados ?? []
  if (!Array.isArray(diasFechados) || diasFechados.some((d) => typeof d !== 'string' || !dataExiste(d))) {
    erro('"diasFechados" precisa ser uma lista de datas reais no formato AAAA-MM-DD')
  }
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: a.fusoHorario })
  } catch {
    erro(`fuso horário desconhecido: ${a.fusoHorario}`)
  }
  return {
    fusoHorario: a.fusoHorario as string,
    duracaoMin: inteiro(a.duracaoMin, 'duracaoMin', 5),
    capacidade: inteiro(a.capacidade, 'capacidade', 1),
    antecedenciaMin: inteiro(a.antecedenciaMin ?? 0, 'antecedenciaMin', 0),
    diasMaximoFuturo: inteiro(a.diasMaximoFuturo, 'diasMaximoFuturo', 1),
    janelas,
    diasFechados: diasFechados as string[],
  }
}

function minutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

function formatarHora(totalMin: number): string {
  return `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`
}

export function dataExiste(dataISO: string): boolean {
  if (!DATA.test(dataISO)) return false
  const [y, m, d] = dataISO.split('-').map(Number) as [number, number, number]
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

export function somarDias(dataISO: string, dias: number): string {
  const [y, m, d] = dataISO.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10)
}

export function diaDaSemana(dataISO: string): DiaSemana {
  const [y, m, d] = dataISO.split('-').map(Number) as [number, number, number]
  return DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!
}

/** Todos os horários de início possíveis no dia, sem olhar o que já foi reservado. */
export function horariosDoDia(agenda: Agenda, dataISO: string): string[] {
  const saida: string[] = []
  for (const [inicio, ultimo] of agenda.janelas[diaDaSemana(dataISO)]) {
    for (let m = minutos(inicio); m <= minutos(ultimo); m += agenda.duracaoMin) saida.push(formatarHora(m))
  }
  return saida
}

function offsetMs(fuso: string, instante: number): number {
  const nome = new Intl.DateTimeFormat('en-US', { timeZone: fuso, timeZoneName: 'longOffset' })
    .formatToParts(new Date(instante))
    .find((p) => p.type === 'timeZoneName')?.value
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(nome ?? '')
  if (!m) return 0
  const sinal = m[1] === '-' ? -1 : 1
  return sinal * ((Number(m[2]) * 60 + Number(m[3] ?? 0)) * 60_000)
}

/** Instante (ms desde 1970, UTC) em que o relógio do fuso marca esta data e hora. */
export function epochLocal(dataISO: string, hhmm: string, fuso: string): number {
  const [y, mo, d] = dataISO.split('-').map(Number) as [number, number, number]
  const [h, mi] = hhmm.split(':').map(Number) as [number, number]
  const chute = Date.UTC(y, mo - 1, d, h, mi)
  let t = chute - offsetMs(fuso, chute)
  const corrigido = chute - offsetMs(fuso, t)
  if (corrigido !== t) t = corrigido
  return t
}

export function hojeISO(agora: Date, fuso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora)
}

export function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export interface Rotulo {
  diaSemana: string
  data: string
  hora: string
  /** Ex.: "Segunda-feira, 20/10" */
  dia: string
}

export function rotulo(epoch: number, fuso: string): Rotulo {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epoch))
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? ''
  const diaSemana = get('weekday')
  const data = `${get('day')}/${get('month')}`
  return { diaSemana, data, hora: `${get('hour')}:${get('minute')}`, dia: `${capitalizar(diaSemana)}, ${data}` }
}

export function diasComVisita(agenda: Agenda): string {
  const dias = DIAS.filter((d) => agenda.janelas[d].length > 0).map((d) => NOMES_DIAS[d])
  return dias.length === 0 ? 'nenhum dia' : dias.join(', ')
}

export interface Slot {
  hhmm: string
  inicio: number
}
export type Grade = { ok: true; dataISO: string; rotuloDia: string; slots: Slot[] } | { ok: false; motivo: string }

/**
 * Os horários que a grade permite para uma data, já descontados os que passaram ou não têm antecedência.
 * Não olha o que já está reservado: isso é com a agenda do Google.
 */
export function gradeDoDia(agenda: Agenda, dataISO: string, agora: Date): Grade {
  if (!dataExiste(dataISO)) return { ok: false, motivo: 'Data inválida. Use o formato AAAA-MM-DD.' }
  const hoje = hojeISO(agora, agenda.fusoHorario)
  const [, m, d] = dataISO.split('-')
  const rotuloDia = `${capitalizar(NOMES_DIAS[diaDaSemana(dataISO)])}, ${d}/${m}`
  if (dataISO < hoje) return { ok: false, motivo: `${rotuloDia} já passou.` }
  if (dataISO > somarDias(hoje, agenda.diasMaximoFuturo)) {
    return { ok: false, motivo: `Só marcamos com até ${agenda.diasMaximoFuturo} dias de antecedência.` }
  }
  if (agenda.diasFechados.includes(dataISO)) {
    return { ok: false, motivo: `Não há visitas em ${rotuloDia}.` }
  }
  const todos = horariosDoDia(agenda, dataISO)
  if (todos.length === 0) {
    return {
      ok: false,
      motivo: `Não há avaliações nem aulas experimentais ${diaDaSemana(dataISO) === 'sab' ? 'aos sábados' : 'neste dia da semana'}. Os dias com visita são: ${diasComVisita(agenda)}.`,
    }
  }
  const minimo = agora.getTime() + agenda.antecedenciaMin * 60_000
  const slots = todos
    .map((hhmm) => ({ hhmm, inicio: epochLocal(dataISO, hhmm, agenda.fusoHorario) }))
    .filter((s) => s.inicio >= minimo)
  if (slots.length === 0) {
    return { ok: false, motivo: `Não há mais horários em ${rotuloDia} (precisamos de pelo menos ${agenda.antecedenciaMin} minutos de antecedência).` }
  }
  return { ok: true, dataISO, rotuloDia, slots }
}

/** Início e fim (em ms) do dia no fuso da academia. */
export function limitesDoDia(agenda: Agenda, dataISO: string): { de: number; ate: number } {
  return {
    de: epochLocal(dataISO, '00:00', agenda.fusoHorario),
    ate: epochLocal(somarDias(dataISO, 1), '00:00', agenda.fusoHorario),
  }
}
