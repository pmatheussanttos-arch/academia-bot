import { ehNumeroDaEquipe, remetentePermitido } from './config.js'
import { anotar, encaminharParaHumano, msgErroTecnico, responder, type AgenteDeps } from './agent.js'
import { carregarMensagens, renderizar } from './mensagens.js'
import { formatarWhatsapp, linkRecepcao } from './recepcao.js'
import { MOTIVO_DA_EQUIPE, type Store } from './store.js'
import type { ClienteWhatsapp, MensagemRecebida } from './whatsapp.js'

export interface AtendimentoDeps extends AgenteDeps {
  wa: ClienteWhatsapp
  /** Alerta técnico com limite de repetição (ex.: token do WhatsApp expirado). */
  avisarErro: (chave: string, texto: string) => Promise<void>
  /** Espera entre duas mensagens seguidas do assistente (os testes usam 0). */
  pausaEntreMensagensMs?: number
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

const NOME_ARQUIVO: Record<string, string> = { image: 'a imagem', document: 'o documento', video: 'o vídeo' }
export const ARQUIVO_RECEBIDO_PADRAO = 'Recebi {arquivo}! 😊 A equipe vai dar uma olhada e já te retorna.'

/** Resposta automática ao arquivo (comprovante) no modo QR: só confirma o recebimento, sem perguntas e sem confirmar pagamento. */
export function textoArquivoRecebido(cfg: AgenteDeps['cfg'], tipo: string): string {
  let modelo = ARQUIVO_RECEBIDO_PADRAO
  try {
    modelo = carregarMensagens(cfg.mensagensPath)['arquivo-recebido']?.trim() || modelo
  } catch {
    // mensagens.md ilegível: usa o texto padrão
  }
  return renderizar(modelo, { arquivo: NOME_ARQUIVO[tipo] ?? 'o arquivo' })
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

/** Marca que o assistente escreve para mandar duas mensagens seguidas, em vez de um texto só. */
export const MARCA_NOVA_MENSAGEM = '[[nova mensagem]]'
const MAX_PARTES = 3

/**
 * Quebra a resposta do assistente nas marcas `[[nova mensagem]]`, para o cliente receber mensagens
 * curtas em sequência, como uma pessoa escreveria. Marcas soltas no meio do texto são apagadas,
 * para nunca aparecerem para o cliente.
 */
export function dividirEmMensagens(texto: string): string[] {
  const partes = texto
    .split(/^[ \t]*\[\[nova mensagem\]\][ \t]*$/gim)
    .map((p) =>
      p
        .replace(/\[\[nova mensagem\]\]/gi, ' ') // marca solta no meio da frase: some sem deixar rastro
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
    )
    .filter((p) => p !== '')
  if (partes.length <= MAX_PARTES) return partes
  // Mais do que isso seria o assistente picotando demais: junta o excesso na última mensagem.
  return [...partes.slice(0, MAX_PARTES - 1), partes.slice(MAX_PARTES - 1).join('\n\n')]
}

function avaliarLimite(deps: AgenteDeps, chat: string): 'ok' | 'avisar' | 'silenciar' {
  const { cfg, store } = deps
  const agora = (deps.agora ?? (() => new Date()))().getTime()
  const n = store.contarMensagensDoCliente(chat, agora - 3_600_000)
  if (n > cfg.limiteMsgsPorHora + 1) return 'silenciar'
  if (n === cfg.limiteMsgsPorHora + 1) return 'avisar'
  return 'ok'
}

const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const normalizarFrase = (t: string) => semAcento(t).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/** As perguntas (frases que terminam em "?") de um texto. */
function perguntasDe(texto: string): string[] {
  return (texto.match(/[^.!?\n]+\?/g) ?? []).map((p) => normalizarFrase(p)).filter((p) => p.length > 8)
}

/**
 * Trava contra o assistente repetir a mesma pergunta no fim de várias respostas (ex.: "Qual é o seu objetivo hoje?
 * Assim consigo te indicar o melhor plano."). Se a última pergunta da resposta é idêntica a uma que ele já fez antes,
 * ela (com o complemento curto que vem logo depois) é tirada, e o resto da resposta segue. Só mexe quando sobra texto
 * de verdade: nunca deixa a resposta vazia.
 */
export function tirarPerguntaRepetida(resposta: string, anteriores: string[]): string {
  const texto = resposta.trimEnd()
  const fim = texto.lastIndexOf('?')
  if (fim < 0) return resposta
  const complemento = texto.slice(fim + 1)
  // Complemento longo ou com números (preço, horário) é informação nova, não parte da pergunta: não mexe.
  if (complemento.length > 70 || /\d/.test(complemento)) return resposta

  const jaFeitas = new Set(anteriores.flatMap(perguntasDe))
  if (jaFeitas.size === 0) return resposta

  const corpo = texto.slice(0, fim)
  // O emoji também fecha a frase: "...isso 😊 Qual é o seu objetivo hoje?"
  const ultimoEmoji = [...corpo.matchAll(/\p{Extended_Pictographic}\uFE0F?/gu)].at(-1)
  const aposEmoji = ultimoEmoji ? ultimoEmoji.index! + ultimoEmoji[0].length : 0
  const inicio = Math.max(corpo.lastIndexOf('.') + 1, corpo.lastIndexOf('!') + 1, corpo.lastIndexOf('?') + 1, corpo.lastIndexOf('\n') + 1, aposEmoji)
  const pergunta = normalizarFrase(texto.slice(inicio, fim + 1))
  if (pergunta.length <= 8 || !jaFeitas.has(pergunta)) return resposta

  const resto = texto.slice(0, inicio).replace(/\s*\[\[nova mensagem\]\]\s*$/i, '').trimEnd()
  return normalizarFrase(resto).length >= 15 ? resto : resposta
}

/**
 * Cliente transferido para a equipe (pelo próprio bot) que escreve 2 vezes sem ninguém responder: é sinal de que quer falar algo
 * a mais, e o bot volta a atender. Se uma PESSOA da equipe já assumiu a conversa, nunca volta por este caminho.
 */
function clienteInsistiu(store: Store, chat: string, agora: number): boolean {
  const h = store.handoffsAtivos(agora).find((x) => x.chat === chat)
  if (!h || MOTIVO_DA_EQUIPE.test(h.motivo)) return false
  if (store.contarMensagensDoCliente(chat, h.ts) < 2) return false
  store.liberarHandoff(chat)
  anotar(() => store.registrarEvento('retomado_pelo_cliente', chat, 'escreveu 2 vezes depois da transferência'))
  console.log(`[atendimento] +${chat} escreveu 2 vezes sem resposta da equipe: o bot volta a atender`)
  return true
}

/** A resposta é a frase de "essa informação eu não tenho": entra na lista de dúvidas que a equipe pode ensinar ao bot. */
export function ehSemResposta(resposta: string): boolean {
  return /essa informa[cç][aã]o eu n[aã]o tenho/i.test(resposta)
}

async function enviar(deps: AtendimentoDeps, msg: MensagemRecebida, texto: string): Promise<void> {
  const partes = dividirEmMensagens(texto)
  if (partes.length === 0) return
  try {
    for (const [i, parte] of partes.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, deps.pausaEntreMensagensMs ?? 1200)) // parece conversa, não robô
      await deps.wa.enviarTexto(msg.from, parte)
    }
    deps.store.adicionarMensagem(msg.from, 'assistant', partes.join('\n\n'))
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
    if (ehNumeroDaEquipe(cfg, msg.from, msg.lid)) {
      console.log(`[atendimento] ignorei +${msg.from}: é número de aviso da equipe (NUMEROS_AVISOS), não cliente`)
      return
    }
    if (IGNORAR.has(msg.tipo)) return

    const ehTexto = msg.tipo === 'text'
    if (ehTexto && !msg.texto?.trim()) return

    const registro = ehTexto ? msg.texto!.trim().slice(0, MAX_ENTRADA) : `[${NOMES_TIPO[msg.tipo] ?? msg.tipo} enviado${msg.texto ? `: ${msg.texto.slice(0, 200)}` : ''}]`
    store.adicionarMensagem(msg.from, 'user', registro)

    // Pausa geral ou conversa com a equipe: o bot não responde. Também NÃO marca como lida, para a equipe ver a
    // mensagem ainda não lida no celular (e o cliente não ver "lido" sem que ninguém tenha lido).
    const agora = (deps.agora ?? (() => new Date()))().getTime()
    if (store.pausa(agora)) {
      console.log(`[pausa] mensagem de +${msg.from} guardada sem resposta: o assistente está pausado`)
      return
    }
    if (store.emHandoff(msg.from, agora) && !clienteInsistiu(store, msg.from, agora)) {
      console.log(`[atendimento] sem resposta a +${msg.from}: a equipe está na conversa (o bot volta após 1h sem mensagem humana)`)
      return // a equipe está cuidando
    }

    wa.marcarLida(msg.wamid).catch(() => undefined)

    const limite = avaliarLimite(deps, msg.from)
    if (limite === 'silenciar') return
    if (limite === 'avisar') return await enviar(deps, msg, MSG_LIMITE)

    if (!ehTexto) {
      if (ARQUIVOS[msg.tipo]) {
        const descricao = `${ARQUIVOS[msg.tipo]}${msg.texto ? ` com a legenda "${msg.texto.slice(0, 200)}"` : ''}`
        if (cfg.modoWhatsapp !== 'qr') {
          await encaminharParaHumano(deps, msg.from, msg.nome, `Enviou ${descricao}. Pode ser um comprovante.`)
          return await enviar(deps, msg, msgArquivo(cfg))
        }
        // No modo QR o arquivo chega no próprio celular da academia: a equipe só precisa ser avisada. O bot NÃO se cala nem
        // puxa conversa (não pede nome nem dados): só diz que recebeu e que a equipe vai olhar, sem dizer que conferiu nada.
        await deps.notificar(
          [`📎 Cliente enviou ${descricao}`, `Nome: ${msg.nome?.trim() || '(sem nome no perfil)'}`, `WhatsApp: ${formatarWhatsapp(msg.from)}`, 'Pode ser o comprovante de pagamento: confira no WhatsApp da academia. O bot continua atendendo a conversa.'].join('\n'),
        )
        return await enviar(deps, msg, textoArquivoRecebido(cfg, msg.tipo))
      } else {
        return await enviar(deps, msg, msgAudio(cfg))
      }
    }

    let resposta: string
    try {
      resposta = await responder(deps, msg.from, msg.nome)
    } catch (err) {
      console.error(`[atendimento] erro ao gerar resposta para ${msg.from}:`, err instanceof Error ? err.message : err)
      await encaminharParaHumano(deps, msg.from, msg.nome, 'Erro técnico do assistente: o cliente ficou sem resposta automática.')
      resposta = msgErroTecnico(cfg)
    }
    const anteriores = store.historico(msg.from, 12).filter((m) => m.papel === 'assistant').map((m) => m.conteudo)
    if (ehSemResposta(resposta)) anotar(() => store.registrarEvento('sem_resposta', msg.from, msg.texto?.trim() ?? ''))
    const semRepetir = tirarPerguntaRepetida(resposta, anteriores)
    if (semRepetir !== resposta) console.log(`[atendimento] tirei uma pergunta repetida do fim da resposta para +${msg.from}`)
    await enviar(deps, msg, semRepetir)
  } catch (err) {
    console.error('[atendimento] erro inesperado:', err)
  }
}
