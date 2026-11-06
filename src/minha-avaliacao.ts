import { rotulo } from './agenda.js'
import type { ServicoAgenda } from './agendamento.js'
import type { EventoAgenda } from './google.js'
import type { Notificador } from './notify.js'
import { ErroPainel, PainelAgenda, ehAvaliacao, lerMarcaDoTitulo, nomeDoCliente, whatsappDoEvento } from './painel-agenda.js'
import { limparNome } from './prompt.js'
import { formatarWhatsapp } from './recepcao.js'
import { variantesDoNumero } from './rotinas.js'
import type { Store } from './store.js'

/**
 * O cliente pede, pelo WhatsApp, para corrigir o nome da avaliação ou trocar o dia/horário: o bot resolve sozinho,
 * em vez de transferir. Só mexe na avaliação DESTE cliente (achada pelo número do WhatsApp) e nunca cancela.
 * Usa as mesmas regras e a mesma trava da agenda dos professores, e avisa a equipe do que mudou.
 */

const QUEM = 'Assistente (WhatsApp)'
const DIAS_PROCURA = 180

export interface PedidoAlteracao {
  novoNome: string
  /** AAAA-MM-DD, ou vazio para manter o dia. */
  data: string
  /** HH:MM, ou vazio para manter o horário. */
  hhmm: string
}

export type ResultadoAlteracao = { ok: true; mensagem: string } | { ok: false; motivo: string }

interface Deps {
  servico: ServicoAgenda
  store: Store
  notificar: Notificador
}

/** A próxima avaliação marcada para este WhatsApp (com ou sem o 9), ou undefined. */
export async function encontrarAvaliacaoDoCliente(servico: ServicoAgenda, store: Store, chat: string): Promise<EventoAgenda | undefined> {
  const g = servico.googleAgenda
  if (!g) return undefined
  const agora = servico.agora().getTime()
  const numeros = new Set(variantesDoNumero(chat))
  const doBot = store.agendamentoAtivo(chat, agora)?.eventoId
  const eventos = await g.api.listarEventos(g.agendaId, agora, agora + DIAS_PROCURA * 86_400_000)
  return eventos
    .filter((e) => e.ocupa && !e.diaInteiro && e.inicio !== undefined && e.inicio > agora && ehAvaliacao(e.titulo))
    .filter((e) => e.id === doBot || [...variantesDoNumero(whatsappDoEvento(e) ?? '')].some((n) => numeros.has(n)))
    .sort((a, b) => a.inicio! - b.inicio!)[0]
}

const quando = (inicio: number, fuso: string) => {
  const r = rotulo(inicio, fuso)
  return `${r.dia} às ${r.hora}`
}

export async function alterarAvaliacao(d: Deps, chat: string, p: PedidoAlteracao): Promise<ResultadoAlteracao> {
  const { servico, store, notificar } = d
  const g = servico.googleAgenda
  if (!g) return { ok: false, motivo: 'A agenda automática não está ligada, então não dá para mudar a avaliação por aqui. Use chamar_humano.' }

  const novoNome = limparNome(p.novoNome)
  const data = p.data.trim()
  const hhmm = p.hhmm.trim()
  if (!novoNome && !data && !hhmm) return { ok: false, motivo: 'Diga o que mudar: o novo nome, ou o novo dia e horário.' }

  let ev: EventoAgenda | undefined
  try {
    ev = await encontrarAvaliacaoDoCliente(servico, store, chat)
  } catch (err) {
    console.error('[avaliação] não consegui ler o Google Agenda:', err instanceof Error ? err.message : err)
    return { ok: false, motivo: 'Não consegui consultar a agenda agora; nada foi alterado. Use chamar_humano.' }
  }
  if (!ev) {
    return { ok: false, motivo: 'Não encontrei nenhuma avaliação futura marcada para este WhatsApp. Pergunte em nome de quem e para quando ela foi marcada; se a pessoa confirmar que marcou e mesmo assim não achar, use chamar_humano.' }
  }

  const fuso = servico.regras.fusoHorario
  const nomeAntigo = nomeDoCliente(ev.titulo) || 'Cliente'
  const antes = quando(ev.inicio!, fuso)
  const mudancas: string[] = []
  let inicioFinal = ev.inicio!

  if (data || hhmm) {
    const dataAtual = new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(new Date(ev.inicio!))
    const alvoData = data || dataAtual
    const alvoHora = hhmm || rotulo(ev.inicio!, fuso).hora
    try {
      await new PainelAgenda(servico, store).remarcar({ eventoId: ev.id, data: alvoData, hhmm: alvoHora, professor: QUEM })
    } catch (err) {
      if (err instanceof ErroPainel) {
        if (err.codigo === 'ocupado') {
          // A mensagem do painel traz o nome de quem ocupa o horário: para o cliente, nunca. Mostra os horários livres.
          return { ok: false, motivo: `${alvoHora} já está ocupado nesse dia. ${await servico.consultar('avaliacao_fisica', alvoData, 'qualquer')}` }
        }
        if (err.codigo === 'mesmo_horario') return { ok: false, motivo: 'A avaliação já está nesse dia e horário: não precisa mudar.' }
        if (err.codigo === 'google') return { ok: false, motivo: 'Não consegui falar com a agenda agora; nada foi alterado. Use chamar_humano.' }
        return { ok: false, motivo: `${err.message} Ofereça outro dia ou horário (use consultar_horarios).` }
      }
      throw err
    }
    const atualizado = await g.api.obterEvento(g.agendaId, ev.id)
    inicioFinal = atualizado?.inicio ?? inicioFinal
    mudancas.push(`Horário: de ${antes} para ${quando(inicioFinal, fuso)}`)
  }

  if (novoNome && novoNome !== nomeAntigo) {
    try {
      await servico.exclusivo(async () => {
        const marca = lerMarcaDoTitulo(ev!.titulo).status
        const emoji = marca === 'veio' ? ' ✅' : marca === 'faltou' ? ' ❌' : marca === 'matriculou' ? ' 🏋️' : ''
        await g.api.renomearEvento(g.agendaId, ev!.id, `Avaliação — ${novoNome}${emoji}`)
      })
    } catch (err) {
      console.error('[avaliação] não consegui trocar o nome:', err instanceof Error ? err.message : err)
      return { ok: false, motivo: `${mudancas.length ? 'O horário foi alterado, mas não' : 'Não'} consegui trocar o nome agora. Use chamar_humano para a equipe corrigir o nome.` }
    }
    store.registrarAcaoAgenda({ professor: QUEM, acao: 'renomeou', eventoId: ev.id, cliente: novoNome, whatsapp: chat, detalhe: `de "${nomeAntigo}" para "${novoNome}"` }, servico.agora().getTime())
    mudancas.push(`Nome: de "${nomeAntigo}" para "${novoNome}"`)
  }

  if (mudancas.length === 0) return { ok: false, motivo: 'Nada mudou: o nome já é esse.' }

  await notificar(['🔁 Avaliação alterada pelo próprio cliente no WhatsApp', `Cliente: ${novoNome || nomeAntigo}`, `WhatsApp: ${formatarWhatsapp(chat)}`, ...mudancas].join('\n'))
  console.log(`[avaliação] cliente alterou a própria avaliação: ${mudancas.join('; ')}`)

  const r = rotulo(inicioFinal, fuso)
  const partes = [data || hhmm ? `sua avaliação ficou para ${r.dia} às ${r.hora}` : '', novoNome && novoNome !== nomeAntigo ? `o nome na avaliação agora é ${novoNome}` : ''].filter(Boolean)
  const frase = partes.join(', e ')
  return { ok: true, mensagem: `Prontinho! ${frase.charAt(0).toUpperCase()}${frase.slice(1)} ✅` }
}
