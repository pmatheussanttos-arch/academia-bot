import type { EstadoWhatsapp } from './baileys.js'

/**
 * Página de status para um monitor externo (UptimeRobot e parecidos) avisar o dono por e-mail
 * quando o WhatsApp cair. Não dá para avisar pelo próprio WhatsApp: é justamente ele que caiu.
 *
 * Fica separada do /health de propósito: a Render usa o /health para decidir se reinicia o serviço.
 * Se o /health falhasse por causa do WhatsApp, a Render reiniciaria o bot sem parar, e o QR nunca
 * chegaria a ser escaneado.
 */

/** Quanto tempo o WhatsApp pode ficar fora do ar antes de virar alarme (reinícios e quedas curtas são normais). */
export const TOLERANCIA_PADRAO_MIN = 5

export interface Status {
  /** false = o monitor externo deve alarmar (resposta 503). */
  ok: boolean
  estado: EstadoWhatsapp['status'] | 'cloud'
  /** Há quantos minutos está fora do ar (0 quando está conectado). */
  minutosForaDoAr: number
  /** Frase curta, que aparece no e-mail do monitor. */
  mensagem: string
  /** O que fazer, quando há o que fazer. */
  acao?: string
}

const minutos = (ms: number) => Math.floor(ms / 60_000)

/**
 * Decide se o WhatsApp está em ordem.
 * @param estado estado da conexão, ou undefined no modo oficial da Meta (não usa QR)
 */
export function calcularStatus(estado: EstadoWhatsapp | undefined, agora: number, toleranciaMin = TOLERANCIA_PADRAO_MIN): Status {
  if (!estado) {
    return { ok: true, estado: 'cloud', minutosForaDoAr: 0, mensagem: 'Modo oficial da Meta: esta verificação não se aplica.' }
  }
  if (estado.status === 'conectado') {
    return { ok: true, estado: 'conectado', minutosForaDoAr: 0, mensagem: `WhatsApp conectado${estado.numero ? ` (+${estado.numero})` : ''}.` }
  }

  const fora = minutos(Math.max(0, agora - (estado.foraDoArDesde ?? agora)))
  const dentroDaTolerancia = fora < toleranciaMin

  if (estado.status === 'aguardando_qr') {
    // Este é o caso grave: alguém precisa ir até a página e escanear o QR, senão o bot fica mudo para sempre.
    return {
      ok: dentroDaTolerancia,
      estado: estado.status,
      minutosForaDoAr: fora,
      mensagem: dentroDaTolerancia
        ? `Aguardando a leitura do QR code há ${fora} min.`
        : `WhatsApp DESCONECTADO há ${fora} min: precisa escanear o QR code de novo.`,
      acao: 'Abra a página de conexão do bot e escaneie o QR code com o celular da academia.',
    }
  }

  return {
    ok: dentroDaTolerancia,
    estado: estado.status,
    minutosForaDoAr: fora,
    mensagem: dentroDaTolerancia
      ? `Reconectando ao WhatsApp (${fora} min).`
      : `WhatsApp fora do ar há ${fora} min (${estado.detalhe ?? estado.status}).`,
    acao: dentroDaTolerancia ? undefined : 'Veja os Logs do serviço. Se continuar, abra a página de conexão para ver se pede um QR code novo.',
  }
}
