import Anthropic from '@anthropic-ai/sdk'
import type { PeriodoPedido, ServicoAgenda } from './agendamento.js'
import type { Config } from './config.js'
import { avisoDeMatricula, validarMatricula } from './matricula.js'
import { carregarMensagens, renderizar } from './mensagens.js'
import { CHAVES_PLANOS, PLANOS_PAGAMENTO, textoPagamentoCartao, trechoCartaoDaMatricula, type ChavePlano } from './pagamento.js'
import { carregarInstrucoes, limparNome, montarSistema, situacaoDaConversa } from './prompt.js'
import { formatarWhatsapp, linkRecepcao } from './recepcao.js'
import type { Notificador } from './notify.js'
import type { Store, UsoIa } from './store.js'

/** Só o que usamos do SDK, para os testes poderem trocar por um falso. */
export interface ClienteClaude {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>
  }
}

export interface AgenteDeps {
  cfg: Config
  store: Store
  claude: ClienteClaude
  notificar: Notificador
  agenda: ServicoAgenda
  agora?: () => Date
  /** Recebe a linha de log de cada ferramenta usada (a página de teste mostra isso nos bastidores). */
  aoUsarFerramenta?: (linha: string) => void
  /** Onde anotar o consumo da IA de cada chamada. Padrão: o banco desta conversa (a sala de teste aponta para o banco real). */
  registrarUso?: (u: UsoIa) => void
}

export const MSG_HANDOFF_PADRAO = 'Ok, vou te transferir para um atendente. Aguarde um instante, que já vai te responder! 😊'
export const MSG_ERRO_TECNICO = 'Tive um problema técnico aqui, mas já avisei a equipe para falar com você. 😊'

/** Link que abre o WhatsApp da recepção com a mensagem já escrita (só existe se NUMERO_RECEPCAO estiver definido). */
export function linkHandoff(cfg: Config, motivo: string): string | undefined {
  return linkRecepcao(cfg.numeroRecepcao, `Oi! Vim pelo assistente virtual e preciso falar com uma pessoa. ${motivo}`)
}

/** Texto de transferência para uma pessoa: o da seção "transferencia" do mensagens.md, ou o padrão. */
export function textoTransferencia(cfg: Config): string {
  try {
    return carregarMensagens(cfg.mensagensPath).transferencia?.trim() || MSG_HANDOFF_PADRAO
  } catch {
    return MSG_HANDOFF_PADRAO // mensagens.md ilegível: o cliente não pode ficar sem resposta
  }
}

const MATRICULA_RESERVA: Record<'pix' | 'cartao', string> = {
  pix: 'Prontinho, {nome}! Seu cadastro já está registrado ✅\n\n📋 Plano: {plano}\n\nChave Pix (CNPJ): 35.950.235/0001-29 — GarageFit Academia.\nDepois me envie o comprovante por aqui que a recepção confere e finaliza o seu cadastro.',
  cartao: 'Prontinho, {nome}! Seu cadastro já está registrado ✅\n\n📋 Plano: {plano}\n💳 Pagamento no cartão\n\n{pagamento_cartao}',
}

/** Cadastro feito DEPOIS do pagamento: não repete a chave Pix nem o link, e não confirma que o dinheiro caiu. */
const MATRICULA_PAGA_RESERVA = 'Prontinho, {nome}! Seu cadastro está registrado ✅\n\n📋 Plano: {plano}\n\nA recepção vai conferir o seu comprovante e finalizar tudo. Qualquer dúvida, é só chamar! 😊'

/** Texto da matrícula: o do mensagens.md (editável pelo dono) ou o de reserva, se o arquivo falhar. */
export function textoMatricula(cfg: Config, pagamento: 'pix' | 'cartao', nome: string, plano: string, jaPagou = false): string {
  const chave = jaPagou ? 'matricula-paga' : pagamento === 'pix' ? 'matricula-pix' : 'matricula-cartao'
  let modelo = jaPagou ? MATRICULA_PAGA_RESERVA : MATRICULA_RESERVA[pagamento]
  try {
    modelo = carregarMensagens(cfg.mensagensPath)[chave]?.trim() || modelo
  } catch {
    // mensagens.md ilegível: usa a reserva, o cliente não pode ficar sem resposta
  }
  return renderizar(modelo, { nome, plano, pagamento_cartao: pagamento === 'cartao' && !jaPagou ? trechoCartaoDaMatricula(cfg, plano) : '' })
}

/** Mensagem de planos e preços (3 mensagens curtas, separadas por [[nova mensagem]]). Reserva, caso o mensagens.md falhe. */
export const VALORES_RESERVA = `Temos opções que se encaixam no seu momento:

💪 3x por semana — R$ 89,90
💪 Acesso todos os dias — R$ 99,90
[[nova mensagem]]
Mas quem realmente quer resultado escolhe nossos planos VIP, que saem muito mais em conta:

🔥 Trimestral VIP — R$ 89,90/mês
🔥 Semestral VIP — R$ 79,90/mês
🔥 Anual VIP — R$ 69,90/mês
[[nova mensagem]]
✅ Todos com acesso livre
✅ Avaliação gratuita (nos 3 planos VIP)
✅ Convidado grátis (15 dias no Trimestral | 1 meses no Anual)

Qual desses encaixa melhor no seu objetivo? 💪🏼`

/** Texto dos valores: o da seção "valores" do mensagens.md (editável pelo dono), ou o de reserva. */
export function textoValores(cfg: Config): string {
  try {
    return carregarMensagens(cfg.mensagensPath).valores?.trim() || VALORES_RESERVA
  } catch {
    return VALORES_RESERVA // mensagens.md ilegível: o cliente não pode ficar sem os valores
  }
}

/** Mensagem fixa para o cliente quando a conversa precisa de uma pessoa. */
export function msgHandoff(cfg: Config, motivo: string): string {
  const link = linkHandoff(cfg, motivo)
  return link ? `Para falar com a nossa equipe agora, toque no link e envie a mensagem que já está pronta 👇\n${link}` : textoTransferencia(cfg)
}

export function msgErroTecnico(cfg: Config): string {
  const link = linkRecepcao(cfg.numeroRecepcao, 'Oi! Tive um problema com o assistente virtual e preciso de ajuda.')
  return link
    ? `Tive um problema técnico aqui 😕 Para falar com a nossa equipe agora, toque no link e envie a mensagem que já está pronta 👇\n${link}`
    : MSG_ERRO_TECNICO
}

const MAX_VOLTAS = 6
const MAX_TOKENS = 4096 // o pensamento do modelo também conta nesse limite

export function criarClienteClaude(): ClienteClaude {
  const client = new Anthropic({ timeout: 60_000 })
  return { messages: { create: (params) => client.messages.create(params) } }
}

const TIPO_VISITA = {
  type: 'string',
  enum: ['aula_experimental', 'avaliacao_fisica'],
  description: 'aula_experimental (gratuita) ou avaliacao_fisica (paga, exceto nos planos VIP).',
} as const

export const FERRAMENTAS: Anthropic.Tool[] = [
  {
    name: 'chamar_humano',
    description:
      'Passa a conversa para uma pessoa da equipe da academia e avisa a equipe. Use quando o cliente pedir uma pessoa, em reclamações, cancelamento ou trancamento (depois da regra de retenção das instruções), descontos, saúde ou lesão, pagamento por cartão, mudança ou cancelamento de uma visita já marcada, e quando o cliente aceitar que a equipe responda uma dúvida que você não sabe. Depois de usar, siga o que a ferramenta mandar dizer ao cliente. Para PEDIR uma visita nova, use solicitar_avaliacao, não esta.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        motivo: { type: 'string', description: 'Resumo curto para a equipe: o que o cliente quer e o que já foi dito.' },
      },
      required: ['motivo'],
      additionalProperties: false,
    },
  },
  {
    name: 'enviar_valores',
    description:
      'Devolve a mensagem oficial com os planos e os valores (planos básicos e VIP), já dividida em 3 mensagens curtas. Use quando a pessoa quiser saber dos planos, dos valores, da mensalidade ou do preço, ou depois de ela dizer que quer ver os planos. Não precisa perguntar antes se ela quer treinar 3x por semana ou todos os dias. Nunca monte a lista de valores por conta própria: envie o que esta ferramenta devolver.',
    strict: true,
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'enviar_link_pagamento',
    description:
      'Devolve a mensagem com o link seguro de pagamento no cartão (InfinitePay) do plano escolhido. Use quando a pessoa disser que quer pagar no cartão ou pedir o link de pagamento, e já souber qual é o plano; se ainda não souber, pergunte qual plano. Não confirma pagamento: depois que a pessoa pagar, peça o comprovante e chame a equipe. Nunca peça dados do cartão pelo WhatsApp.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        plano: { type: 'string', enum: [...CHAVES_PLANOS], description: 'O plano que a pessoa quer pagar: 3x_por_semana, acesso_livre, trimestral_vip, semestral_vip ou anual_vip.' },
      },
      required: ['plano'],
      additionalProperties: false,
    },
  },
  {
    name: 'consultar_horarios',
    description:
      'Lista os horários de aula experimental ou de avaliação em uma data e período do dia. Para avaliação, consulta o Google Agenda e mostra só os horários livres. Use antes de OFERECER horários: nunca invente horários. Se o cliente já escolheu dia e horário, vá direto para solicitar_avaliacao. Informe a data como AAAA-MM-DD; para "segunda", "amanhã" etc., calcule a partir da data de hoje informada no início da conversa. Não registra nada.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        tipo: TIPO_VISITA,
        data: { type: 'string', description: 'Data no formato AAAA-MM-DD, por exemplo 2026-10-19.' },
        periodo: {
          type: 'string',
          enum: ['manha', 'tarde', 'noite', 'qualquer'],
          description:
            'Período do dia que a pessoa prefere. Se ela ainda não disse (nem deu um horário), pergunte antes: "Prefere de manhã, à tarde ou à noite?". Use "qualquer" só se ela disser que tanto faz.',
        },
      },
      required: ['tipo', 'data', 'periodo'],
      additionalProperties: false,
    },
  },
  {
    name: 'solicitar_avaliacao',
    description:
      'Marca a avaliação física (agenda de verdade, quando a ferramenta devolver a mensagem de "agendada") ou registra o pedido de aula experimental (a equipe confirma). Use assim que tiver tipo, nome, data e horário escolhidos pelo cliente. Se o cliente JÁ disse nome, dia e horário, chame esta ferramenta direto, sem transferir para a equipe e sem pedir de novo o que ele já disse: a própria ferramenta confere o horário e, se estiver ocupado, devolve os horários livres. A ferramenta devolve a mensagem final que você deve enviar ao cliente. Não silencia o bot: a conversa continua normal.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        tipo: TIPO_VISITA,
        nome: { type: 'string', description: 'Nome que o cliente escreveu nesta conversa. Nunca invente nem use o nome do perfil do WhatsApp: se ainda não souber, pergunte antes.' },
        data: { type: 'string', description: 'Data no formato AAAA-MM-DD.' },
        horario: { type: 'string', description: 'Horário de início no formato HH:MM (por exemplo, "14h" vira "14:00"), dentro da grade de 30 em 30 minutos.' },
        observacao: { type: 'string', description: 'Algo que a equipe precise saber (plano de interesse, por exemplo). Use "" se não houver.' },
        ja_e_aluno: { type: 'boolean', description: 'true se o cliente disse que já é aluno da academia.' },
        plano_vip: { type: 'boolean', description: 'true se o cliente disse que é de um plano VIP (ou vai contratar um).' },
      },
      required: ['tipo', 'nome', 'data', 'horario', 'observacao', 'ja_e_aluno', 'plano_vip'],
      additionalProperties: false,
    },
  },
  {
    name: 'registrar_matricula',
    description:
      'Registra a matrícula do cliente e avisa a equipe, que depois lança na plataforma da academia. Use quando o cliente decidir fechar um plano E você já tiver o nome completo, o plano escolhido e a forma de pagamento (o telefone é o do próprio WhatsApp; e-mail e nascimento são opcionais). Se o cliente JÁ PAGOU (Pix ou link) e mandou o comprovante, use ja_pagou = true. A ferramenta devolve a mensagem final que você deve enviar ao cliente, com a chave Pix ou o link quando for o caso. Não confirma pagamento: quem confere é a recepção.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Nome e sobrenome que o cliente escreveu nesta conversa.' },
        telefone: { type: 'string', description: 'Telefone com DDD, se o cliente informou. Use "" se não: o sistema usa o número do WhatsApp desta conversa.' },
        email: { type: 'string', description: 'E-mail do cliente. Use "" se ele não quiser informar.' },
        nascimento: { type: 'string', description: 'Data de nascimento no formato DD/MM/AAAA. Use "" se ele não quiser informar.' },
        plano: { type: 'string', description: 'Plano escolhido, como o cliente vai reconhecer. Ex.: "Anual VIP (12x de R$ 69,90)".' },
        pagamento: { type: 'string', enum: ['pix', 'cartao'], description: 'Como o cliente vai pagar.' },
        observacao: { type: 'string', description: 'Algo que a equipe precise saber. Use "" se não houver.' },
        ja_pagou: { type: 'boolean', description: 'true se o cliente já pagou (Pix ou link do cartão) e enviou o comprovante; a equipe então só confere o comprovante. false se ainda vai pagar.' },
      },
      required: ['nome', 'telefone', 'email', 'nascimento', 'plano', 'pagamento', 'observacao', 'ja_pagou'],
      additionalProperties: false,
    },
  },
]

export async function encaminharParaHumano(
  deps: Pick<AgenteDeps, 'cfg' | 'store' | 'notificar'>,
  chat: string,
  nome: string | undefined,
  motivo: string,
): Promise<void> {
  const { cfg, store, notificar } = deps
  if (cfg.handoffHoras > 0) store.definirHandoff(chat, cfg.handoffHoras, motivo)
  anotar(() => store.registrarEvento('transferencia', chat, motivo, Date.now(), nome?.trim() ?? ''))
  await notificar(
    [
      '🔔 Cliente precisa de atendimento humano',
      `Nome: ${nome?.trim() || '(sem nome no perfil)'}`,
      `WhatsApp: ${formatarWhatsapp(chat)}`,
      `Motivo: ${motivo}`,
      cfg.handoffHoras > 0
        ? `O bot fica em silêncio com este cliente por ${cfg.handoffHoras}h.`
        : cfg.numeroRecepcao
          ? 'O cliente recebeu o link para falar com a recepção; o bot continua atendendo.'
          : 'O bot continua atendendo.',
      ...(cfg.modoWhatsapp === 'qr' ? ['Responda pelo WhatsApp da academia.'] : []),
    ].join('\n'),
  )
}

function historicoParaMensagens(historico: ReturnType<Store['historico']>): Anthropic.MessageParam[] {
  const msgs: Anthropic.MessageParam[] = historico.map((m) => ({ role: m.papel, content: m.conteudo }))
  while (msgs.length > 0 && msgs[0]?.role !== 'user') msgs.shift() // a conversa tem que começar pelo cliente
  return msgs
}

/** Números do painel nunca podem atrapalhar o atendimento: qualquer falha ao anotar é ignorada. */
export function anotar(fn: () => void): void {
  try {
    fn()
  } catch (err) {
    console.error('[painel] não consegui anotar:', err instanceof Error ? err.message : err)
  }
}

const campo = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const tipoDe = (v: unknown) => (v === 'aula_experimental' || v === 'avaliacao_fisica' ? v : null)

/** Linha de log de cada ferramenta que o modelo usou (sem nome do cliente): mostra se a agenda foi consultada e o que devolveu. */
export function registroDeFerramenta(bloco: Anthropic.ToolUseBlock, r: Anthropic.ToolResultBlockParam): string {
  const entrada = (bloco.input ?? {}) as Record<string, unknown>
  const dados = [entrada.tipo, entrada.data, entrada.periodo, entrada.horario].filter((v) => typeof v === 'string' && v).join(', ')
  const saida = (typeof r.content === 'string' ? r.content : '').replace(/\s+/g, ' ').slice(0, 110)
  const motivo = bloco.name === 'chamar_humano' && typeof entrada.motivo === 'string' ? ` motivo="${entrada.motivo.replace(/\s+/g, ' ').slice(0, 160)}"` : ''
  return `[agente] ${bloco.name}(${dados})${motivo} -> ${r.is_error ? 'erro: ' : ''}${saida}`
}

function resultado(bloco: Anthropic.ToolUseBlock, texto: string, erro = false): Anthropic.ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id: bloco.id, content: texto, ...(erro ? { is_error: true } : {}) }
}

async function executarFerramenta(
  deps: AgenteDeps,
  chat: string,
  nome: string | undefined,
  bloco: Anthropic.ToolUseBlock,
): Promise<Anthropic.ToolResultBlockParam> {
  const entrada = (bloco.input ?? {}) as Record<string, unknown>

  if (bloco.name === 'chamar_humano') {
    const motivo = campo(entrada.motivo, 500) || 'sem motivo informado'
    await encaminharParaHumano(deps, chat, nome, motivo)
    const link = linkHandoff(deps.cfg, motivo)
    return resultado(
      bloco,
      link
        ? `Equipe avisada. Diga ao cliente, em uma frase curta, que para falar com a recepção agora ele deve tocar no link abaixo (a mensagem já vai pronta). Envie o link exatamente como está, sem alterar. Não faça mais perguntas nem chamada para ação.\n${link}`
        : `Equipe avisada. Envie ao cliente EXATAMENTE a mensagem entre as linhas "---", sem mudar nada e sem acrescentar texto antes ou depois. Não faça perguntas nem chamada para ação, e não cite telefone nenhum.\n---\n${textoTransferencia(deps.cfg)}\n---`,
    )
  }

  if (bloco.name === 'enviar_valores') {
    return resultado(
      bloco,
      `Envie ao cliente EXATAMENTE a mensagem entre as linhas "---", sem mudar nenhuma palavra, sem acrescentar texto antes ou depois, e mantendo as linhas [[nova mensagem]] exatamente onde estão (elas dividem a resposta em 3 mensagens curtas). Já termina com a pergunta; não faça outra.\n---\n${textoValores(deps.cfg)}\n---`,
    )
  }

  if (bloco.name === 'enviar_link_pagamento') {
    const plano = CHAVES_PLANOS.includes(entrada.plano as ChavePlano) ? (entrada.plano as ChavePlano) : undefined
    if (!plano) return resultado(bloco, `Plano inválido. Use um destes: ${CHAVES_PLANOS.join(', ')}.`, true)
    const mensagem = textoPagamentoCartao(deps.cfg, plano)
    if (!mensagem) {
      return resultado(bloco, `Não há link de pagamento para ${PLANOS_PAGAMENTO[plano]}. Diga que o cartão é passado na recepção da academia (ou ofereça o Pix) e siga a conversa.`)
    }
    return resultado(
      bloco,
      `Envie ao cliente EXATAMENTE a mensagem entre as linhas "---", sem mudar o link nem nenhuma palavra e sem acrescentar texto antes ou depois. Não diga que o pagamento foi recebido. Quando a pessoa disser que pagou, peça o comprovante e use chamar_humano.\n---\n${mensagem}\n---`,
    )
  }

  if (bloco.name === 'consultar_horarios') {
    const tipo = tipoDe(entrada.tipo)
    if (!tipo) return resultado(bloco, 'Tipo inválido. Use aula_experimental ou avaliacao_fisica.', true)
    const periodo: PeriodoPedido = entrada.periodo === 'manha' || entrada.periodo === 'tarde' || entrada.periodo === 'noite' ? entrada.periodo : 'qualquer'
    return resultado(bloco, await deps.agenda.consultar(tipo, campo(entrada.data, 10), periodo))
  }

  if (bloco.name === 'solicitar_avaliacao') {
    const tipo = tipoDe(entrada.tipo)
    if (!tipo) return resultado(bloco, 'Tipo inválido. Use aula_experimental ou avaliacao_fisica.', true)
    const r = await deps.agenda.solicitar({
      chat,
      nomeContato: limparNome(nome),
      nomeCliente: campo(entrada.nome, 60),
      tipo,
      dataISO: campo(entrada.data, 10),
      hhmm: campo(entrada.horario, 5),
      obs: campo(entrada.observacao, 300),
      jaEAluno: entrada.ja_e_aluno === true,
      planoVip: entrada.plano_vip === true,
    })
    if (!r.ok) return resultado(bloco, r.motivo, true)
    anotar(() => deps.store.registrarEvento('avaliacao_bot', chat, `${tipo} ${campo(entrada.data, 10)} ${campo(entrada.horario, 5)}${r.agendada ? '' : ' (sem agenda)'}`))
    const situacao = r.agendada
      ? 'AGENDADO: a avaliação já está na agenda da academia.'
      : 'REGISTRADO, mas ainda NÃO está agendado: a equipe vai confirmar o horário. Não diga que está agendado nem confirmado.'
    return resultado(
      bloco,
      `${situacao} Envie ao cliente EXATAMENTE a mensagem entre as linhas "---", sem mudar nada e sem acrescentar texto antes ou depois.\n---\n${r.mensagem}\n---`,
    )
  }

  if (bloco.name === 'registrar_matricula') {
    const agora = (deps.agora ?? (() => new Date()))()
    const v = validarMatricula(
      {
        nome: campo(entrada.nome, 80),
        telefone: campo(entrada.telefone, 30) || (/^55\d{10,11}$/.test(chat) ? chat : ''),
        email: campo(entrada.email, 120),
        nascimento: campo(entrada.nascimento, 20),
        plano: campo(entrada.plano, 80),
        pagamento: campo(entrada.pagamento, 10),
        observacao: campo(entrada.observacao, 300),
      },
      agora,
    )
    if (!v.ok) return resultado(bloco, v.motivo, true)

    deps.store.registrarMatricula({ chat, ...v.dados }, agora.getTime())
    anotar(() => deps.store.registrarEvento('matricula', chat, v.dados.plano, agora.getTime()))
    const jaPagou = entrada.ja_pagou === true
    await deps.notificar(avisoDeMatricula(v.dados, chat, jaPagou))
    console.log(`[matrícula] ${v.dados.nome} | ${v.dados.plano} | ${v.dados.pagamento}`)

    const primeiroNome = v.dados.nome.split(' ')[0]!
    return resultado(
      bloco,
      `Matrícula registrada e equipe avisada. Envie ao cliente EXATAMENTE a mensagem entre as linhas "---", sem mudar nada e sem acrescentar texto antes ou depois. Não diga que o pagamento foi recebido.\n---\n${textoMatricula(deps.cfg, v.dados.pagamento, primeiroNome, v.dados.plano, jaPagou)}\n---`,
    )
  }

  return resultado(bloco, `Ferramenta desconhecida: ${bloco.name}`, true)
}

function textoDe(resposta: Anthropic.Message): string {
  return resposta.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

/**
 * Gera a resposta para a última mensagem do cliente (que já deve estar salva no histórico).
 * Pode chamar a equipe no meio do caminho. Lança erro se a API do Claude falhar; quem chama decide o que fazer.
 */
export async function responder(deps: AgenteDeps, chat: string, nome: string | undefined): Promise<string> {
  const { cfg, store, claude } = deps
  const agora = (deps.agora ?? (() => new Date()))()
  const historico = store.historico(chat, cfg.historicoMax)
  const situacao = situacaoDaConversa(store.historico(chat, 200).filter((m) => m.papel === 'assistant').map((m) => m.conteudo))
  const system = montarSistema(carregarInstrucoes(cfg.instrucoesPath), agora, nome, deps.agenda.fuso, situacao)
  const mensagens = historicoParaMensagens(historico)

  let ultimoTexto = ''
  let encaminhou = false

  for (let volta = 0; volta < MAX_VOLTAS; volta++) {
    const resposta = await claude.messages.create({
      model: cfg.model,
      max_tokens: MAX_TOKENS,
      system,
      tools: FERRAMENTAS,
      messages: mensagens,
      output_config: { effort: cfg.effort },
    })

    anotar(() => {
      const u = resposta.usage
      const uso: UsoIa = { modelo: cfg.model, entrada: u.input_tokens ?? 0, saida: u.output_tokens ?? 0, cacheLeitura: u.cache_read_input_tokens ?? 0, cacheEscrita: u.cache_creation_input_tokens ?? 0 }
      if (deps.registrarUso) deps.registrarUso(uso)
      else store.registrarUsoIa(uso, agora.getTime())
    })

    if (resposta.stop_reason === 'refusal') {
      await encaminharParaHumano(deps, chat, nome, 'O assistente não conseguiu responder esta mensagem (bloqueio de segurança).')
      return msgHandoff(cfg, 'Preciso de ajuda.')
    }

    const texto = textoDe(resposta)
    if (texto) ultimoTexto = texto

    if (resposta.stop_reason === 'tool_use') {
      // Devolvemos o conteúdo do modelo inteiro e sem alterações (inclui o raciocínio), como a API exige.
      mensagens.push({ role: 'assistant', content: resposta.content })
      const resultados: Anthropic.ToolResultBlockParam[] = []
      for (const bloco of resposta.content) {
        if (bloco.type !== 'tool_use') continue
        if (bloco.name === 'chamar_humano') encaminhou = true
        const r = await executarFerramenta(deps, chat, nome, bloco)
        const linha = registroDeFerramenta(bloco, r)
        console.log(linha)
        deps.aoUsarFerramenta?.(linha)
        resultados.push(r)
      }
      mensagens.push({ role: 'user', content: resultados })
      continue
    }

    if (resposta.stop_reason === 'max_tokens') {
      throw new Error('resposta cortada por max_tokens')
    }

    if (ultimoTexto) return ultimoTexto
    if (encaminhou) return msgHandoff(cfg, 'Preciso de ajuda.')
    throw new Error('o modelo terminou sem texto')
  }

  if (encaminhou) return ultimoTexto || msgHandoff(cfg, 'Preciso de ajuda.')
  throw new Error('o modelo não terminou depois de várias chamadas de ferramenta')
}
