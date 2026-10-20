import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { criarClienteClaude } from './agent.js'
import { criarServicoAgenda } from './agendamento.js'
import { criarApp } from './app.js'
import { DriverBaileys } from './baileys.js'
import { tratarMensagem } from './atendimento.js'
import { carregarConfig, ehNumeroDaEquipe, exigirWhatsapp } from './config.js'
import { FilaPorChave } from './fila.js'
import { criarNotificador, limitarAvisos } from './notify.js'
import { carregarInstrucoes, instrucoesIncompletas } from './prompt.js'
import { Store } from './store.js'
import { criarClienteWhatsapp, type ClienteWhatsapp } from './whatsapp.js'

function falhar(mensagem: string): never {
  console.error(`\n❌ ${mensagem}\n`)
  process.exit(1)
}

try {
  process.loadEnvFile() // lê o arquivo .env, se existir; variáveis já definidas no servidor têm prioridade
} catch {
  // sem .env: tudo vem do ambiente da hospedagem
}

let cfg: ReturnType<typeof carregarConfig>
try {
  cfg = carregarConfig()
} catch (err) {
  falhar(err instanceof Error ? err.message : String(err))
}

const modoQr = cfg.modoWhatsapp === 'qr'

// No modo Cloud exigimos as credenciais da Meta; no modo QR a conexão é por QR code.
let whatsappCfg
if (!modoQr) {
  try {
    whatsappCfg = exigirWhatsapp(cfg)
  } catch (err) {
    falhar(err instanceof Error ? err.message : String(err))
  }
}
if (!process.env.ANTHROPIC_API_KEY) falhar('Falta a variável ANTHROPIC_API_KEY (chave da Claude API).')
if (modoQr && !cfg.adminToken) {
  falhar('No modo QR, defina ADMIN_TOKEN: ele protege a página onde você escaneia o QR code (quem a vê controla o WhatsApp).')
}

let instrucoes: string
try {
  instrucoes = carregarInstrucoes(cfg.instrucoesPath)
} catch {
  falhar(`Não encontrei o arquivo de instruções em ${cfg.instrucoesPath}.`)
}
if (instrucoesIncompletas(instrucoes) && !cfg.permitirInstrucoesIncompletas) {
  falhar(
    `O arquivo ${cfg.instrucoesPath} ainda tem trechos [PREENCHER]. Preencha-os (ou defina PERMITIR_INSTRUCOES_INCOMPLETAS=1 só para testes) antes de atender clientes de verdade.`,
  )
}
// No modo QR o bot está no número da própria academia: a equipe responde pelo mesmo WhatsApp, então
// o link para a recepção não se aplica e NUMERO_RECEPCAO é opcional.
if (!modoQr && !cfg.numeroRecepcao && !cfg.permitirSemRecepcao) {
  falhar(
    'Falta a variável NUMERO_RECEPCAO (o WhatsApp da recepção, com DDD, ex.: 11999998888). Sem ela, o cliente que pedir para falar com uma pessoa ficaria sem saída. Para testes, use PERMITIR_SEM_RECEPCAO=1.',
  )
}
const mascarar = (n: string) => `+${n.slice(0, 4)}…${n.slice(-4)}`
const canaisDeAviso = [
  ...(modoQr && cfg.numerosAvisos.length > 0 ? [`WhatsApp (${cfg.numerosAvisos.map(mascarar).join(', ')})`] : []),
  ...(cfg.telegram ? ['Telegram'] : []),
]
console.log(
  canaisDeAviso.length > 0
    ? `🔔 Avisos à equipe: ${canaisDeAviso.join(' e ')}.`
    : 'ℹ️  Avisos à equipe só aparecem neste log. Defina NUMEROS_AVISOS (WhatsApp da recepção) para a equipe receber de verdade.',
)
if (!modoQr && process.env.NUMEROS_AVISOS?.trim()) {
  console.log('ℹ️  NUMEROS_AVISOS só funciona no modo QR; no modo Cloud use o Telegram.')
}
if (cfg.numerosPermitidos.length > 0) {
  console.log(`⚠️  Modo de teste: o bot só responde a ${cfg.numerosPermitidos.length} número(s) (NUMEROS_PERMITIDOS).`)
}

const store = new Store(join(cfg.dataDir, 'bot.db'))
store.limpar(cfg.retencaoDias)
setInterval(() => store.limpar(cfg.retencaoDias), 6 * 3_600_000).unref()

// No QR, o driver é quem conecta ao WhatsApp, e também envia os avisos para a equipe (a partir do número da academia).
const driver = modoQr ? new DriverBaileys({ dataDir: cfg.dataDir }) : undefined
const notificar = criarNotificador(cfg, { whatsapp: driver ? (numero, texto) => driver.enviarAviso(numero, texto) : undefined })
let agenda
try {
  agenda = criarServicoAgenda(cfg, store, notificar)
} catch (err) {
  falhar(err instanceof Error ? err.message : String(err))
}
console.log(
  agenda.modo === 'google'
    ? '📅 Agenda: modo Google. Avaliações são agendadas direto no Google Agenda.'
    : '📅 Agenda: modo manual.',
)

const fila = new FilaPorChave()

// O cliente de WhatsApp depende do modo. No QR, é o driver Baileys (que também é a fonte das mensagens).
const wa: ClienteWhatsapp = driver ?? criarClienteWhatsapp(whatsappCfg!)

const deps = {
  cfg,
  store,
  claude: criarClienteClaude(),
  notificar,
  agenda,
  wa,
  avisarErro: limitarAvisos(notificar),
  fila,
  whatsappCfg,
  whatsappEstado: driver ? () => driver.estado() : undefined,
  iniciadoEm: Date.now(),
}

const app = criarApp(deps)

if (driver) {
  const silencioHoras = cfg.handoffHoras > 0 ? cfg.handoffHoras : 6
  await driver.iniciar({
    dispatch: (msg) => {
      if (!store.marcarProcessada(msg.wamid)) return // o WhatsApp reenviou algo já tratado
      void fila.executar(msg.from, () => tratarMensagem(deps, msg))
    },
    humano: (numero, texto) => {
      if (ehNumeroDaEquipe(cfg, numero)) return // conversa com quem recebe os avisos: não é um cliente
      // A equipe respondeu pelo celular, no mesmo número: o bot sai da conversa por um tempo.
      store.definirHandoff(numero, silencioHoras, 'A equipe respondeu pelo WhatsApp.')
      if (texto) store.adicionarMensagem(numero, 'assistant', texto)
    },
  })
  console.log(`📱 WhatsApp: modo QR code. Abra /conectar?token=SEU_ADMIN_TOKEN para parear o número.`)
} else {
  console.log('📱 WhatsApp: modo Cloud (API oficial da Meta).')
}

const servidor = serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`✅ Bot da academia no ar na porta ${info.port} (modelo ${cfg.model}, esforço ${cfg.effort}).`)
})

process.on('unhandledRejection', (err) => console.error('[processo] promessa rejeitada sem tratamento:', err))

function encerrar(): void {
  console.log('Encerrando…')
  void driver?.encerrar()
  servidor.close(() => {
    store.fechar()
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 10_000).unref()
}
process.on('SIGTERM', encerrar)
process.on('SIGINT', encerrar)
