import { ehNumeroDaEquipe, remetentePermitido } from './config.js'
import { encaminharParaHumano, msgErroTecnico, responder, type AgenteDeps } from './agent.js'
import { linkRecepcao } from './recepcao.js'
import type { ClienteWhatsapp, MensagemRecebida } from './whatsapp.js'

export interface AtendimentoDeps extends AgenteDeps {
  wa: ClienteWhatsapp
  /** Alerta técnico com limite de repetição (ex.: token do WhatsApp expirado). */
  avisarErro: (chave: string, texto: string) => Promise<void>
}

export const MSG_LIMITE = 'Você enviou muitas mensagens em pouco tempo 😅 Aguarde um pouco e tente de novo, ou fale com a recepção da academia.'
export const MSG_AUDIO = 'Oi! Recebi sua mensagem, mas por aqui eu só consigo ler texto 😊 Pode me escrever sua dúvida? Se preferir, chamo alguém da equipe.'
export const MSG_ARQUIVO = 'Recebi seu arquivo! Vou avisar a equipe para dar uma olhada e te responder em breve. 😊'

/** Textos fixos que dependem de existir (ou não) um número de recepção para o cliente falar com uma pessoa. */
function msgAudio(cfg: AgenteDeps['cfg']): string {
  const link = linkRecepcao(cfg.numeroRecepcao, 'Oi! Vim pelo assistente virtual e preciso falar com uma pessoa.')
  return link ? `Oi! Recebi sua mensagem, mas por aqui eu só consigo ler texto 😊 Pode me escrever sua dúvida? Se preferir falar com uma pessoa, toque aqui 👇\n${link}` : MSG_AUDIO
}

function msgArquivo(cfg: AgenteDeps['cfg']): string {
  const link = linkRecepcao(cfg.numeroRecepcao, 'Oi! Vim pelo assistente virtual e vou enviar um arquivo (comprovante) para a equipe.')
  return link ? `Recebi seu arquivo, mas por aqui eu não consigo abrir imagens nem documentos 😊 Para a equipe ver, envie direto para a nossa recepção 👇\n${link}` : MSG_ARQUIVO
}

const IGNORAR = new Set(['reaction', 'sticker', 'unsupported', 'unknown', 'system', 'request_welcome'])
const ARQUIVOS: Record<string, string> = { image: 'uma imagem', document: 'um documento', video: 'um vídeo' }
const NOMES_TIPO: Record<string, string> = {
  audio: 'áudio',
  voice: 'áudio',
  image: 'imagem',
  document: 'documento',
  video: 'vídeo',
  location: 'localização',
  contacts: 'contato',
}

const MAX_ENTRADA = 2000

function avaliarLimite(deps: AgenteDeps, chat: string): 'ok' | 'avisar' | 'silenciar' {
  const { cfg, store } = deps
  const agora = (deps.agora ?? (() => new Date()))().getTime()
  const n = store.contarMensagensDoCliente(chat, agora - 3_600_000)
  if (n > cfg.limiteMsgsPorHora + 1) return 'silenciar'
  if (n === cfg.limiteMsgsPorHora + 1) return 'avisar'
  return 'ok'
}

async function enviar(deps: AtendimentoDeps, msg: MensagemRecebida, texto: string): Promise<void> {
  try {
    await deps.wa.enviarTexto(msg.from, texto)
    deps.store.adicionarMensagem(msg.from, 'assistant', texto)
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err)
    console.error(`[atendimento] falha ao enviar para ${msg.from}: ${detalhe}`)
    await deps.avisarErro('envio', `⚠️ O bot não conseguiu enviar uma mensagem no WhatsApp.\n${detalhe}\nSe aparecer "190" ou "token", o token de acesso da Meta pode ter expirado.`)
  }
}

/** Trata uma mensagem de cliente do começo ao fim. Nunca lança erro: o servidor não pode cair por causa de um cliente. */
export async function tratarMensagem(deps: AtendimentoDeps, msg: MensagemRecebida): Promise<void> {
  const { cfg, store, wa } = deps
  try {
    if (!remetentePermitido(cfg, msg.from, msg.lid)) {
      // Modo de teste: diz quem foi ignorado, para a pessoa saber o que colocar em NUMEROS_PERMITIDOS.
      console.log(`[atendimento] ignorei +${msg.from}${msg.lid ? ` (código interno ${msg.lid})` : ''}: não está em NUMEROS_PERMITIDOS`)
      return
    }
    if (ehNumeroDaEquipe(cfg, msg.from, msg.lid)) return // quem recebe os avisos é equipe, não cliente
    if (IGNORAR.has(msg.tipo)) return

    const ehTexto = msg.tipo === 'text'
    if (ehTexto && !msg.texto?.trim()) return

    wa.marcarLida(msg.wamid).catch(() => undefined)

    const registro = ehTexto ? msg.texto!.trim().slice(0, MAX_ENTRADA) : `[${NOMES_TIPO[msg.tipo] ?? msg.tipo} enviado${msg.texto ? `: ${msg.texto.slice(0, 200)}` : ''}]`
    store.adicionarMensagem(msg.from, 'user', registro)

    if (store.emHandoff(msg.from, (deps.agora ?? (() => new Date()))().getTime())) return // a equipe está cuidando

    const limite = avaliarLimite(deps, msg.from)
    if (limite === 'silenciar') return
    if (limite === 'avisar') return await enviar(deps, msg, MSG_LIMITE)

    if (!ehTexto) {
      if (ARQUIVOS[msg.tipo]) {
        await encaminharParaHumano(deps, msg.from, msg.nome, `Enviou ${ARQUIVOS[msg.tipo]}${msg.texto ? ` com a legenda "${msg.texto.slice(0, 200)}"` : ''}. Pode ser um comprovante.`)
        return await enviar(deps, msg, msgArquivo(cfg))
      }
      return await enviar(deps, msg, msgAudio(cfg))
    }

    let resposta: string
    try {
      resposta = await responder(deps, msg.from, msg.nome)
    } catch (err) {
      console.error(`[atendimento] erro ao gerar resposta para ${msg.from}:`, err instanceof Error ? err.message : err)
      await encaminharParaHumano(deps, msg.from, msg.nome, 'Erro técnico do assistente: o cliente ficou sem resposta automática.')
      resposta = msgErroTecnico(cfg)
    }
    await enviar(deps, msg, resposta)
  } catch (err) {
    console.error('[atendimento] erro inesperado:', err)
  }
}
