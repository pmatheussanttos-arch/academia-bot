import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { criarClienteClaude } from './agent.js'
import { criarServicoAgenda } from './agendamento.js'
import { criarApp } from './app.js'
import { carregarConfig, exigirWhatsapp } from './config.js'
import { FilaPorChave } from './fila.js'
import { criarNotificador, limitarAvisos } from './notify.js'
import { carregarInstrucoes, instrucoesIncompletas } from './prompt.js'
import { Store } from './store.js'
import { criarClienteWhatsapp } from './whatsapp.js'

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

let whatsappCfg
try {
  whatsappCfg = exigirWhatsapp(cfg)
} catch (err) {
  falhar(err instanceof Error ? err.message : String(err))
}
if (!process.env.ANTHROPIC_API_KEY) falhar('Falta a variável ANTHROPIC_API_KEY (chave da Claude API).')

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
if (!cfg.numeroRecepcao && !cfg.permitirSemRecepcao) {
  falhar(
    'Falta a variável NUMERO_RECEPCAO (o WhatsApp da recepção, com DDD, ex.: 11999998888). Sem ela, o cliente que pedir para falar com uma pessoa ficaria sem saída. Para testes, use PERMITIR_SEM_RECEPCAO=1.',
  )
}
if (!cfg.telegram) {
  console.log('ℹ️  Sem Telegram: avisos à equipe (cliente precisa de uma pessoa, pedido de aula experimental) aparecem só neste log.')
}
if (cfg.numerosPermitidos.length > 0) {
  console.log(`⚠️  Modo de teste: o bot só responde a ${cfg.numerosPermitidos.length} número(s) (NUMEROS_PERMITIDOS).`)
}

const store = new Store(join(cfg.dataDir, 'bot.db'))
store.limpar(cfg.retencaoDias)
setInterval(() => store.limpar(cfg.retencaoDias), 6 * 3_600_000).unref()

const notificar = criarNotificador(cfg)
let agenda
try {
  agenda = criarServicoAgenda(cfg, store, notificar)
} catch (err) {
  falhar(err instanceof Error ? err.message : String(err))
}
console.log(
  agenda.modo === 'google'
    ? '📅 Agenda: modo Google. Avaliações são agendadas direto no Google Agenda.'
    : '📅 Agenda: modo manual. O cliente confirma o horário com a recepção pelo link que o bot envia.',
)

const deps = {
  cfg,
  store,
  claude: criarClienteClaude(),
  notificar,
  agenda,
  wa: criarClienteWhatsapp(whatsappCfg),
  avisarErro: limitarAvisos(notificar),
  fila: new FilaPorChave(),
  whatsappCfg,
  iniciadoEm: Date.now(),
}

const app = criarApp(deps)
const servidor = serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`✅ Bot da academia no ar na porta ${info.port} (modelo ${cfg.model}, esforço ${cfg.effort}).`)
})

process.on('unhandledRejection', (err) => console.error('[processo] promessa rejeitada sem tratamento:', err))

function encerrar(): void {
  console.log('Encerrando…')
  servidor.close(() => {
    store.fechar()
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 10_000).unref()
}
process.on('SIGTERM', encerrar)
process.on('SIGINT', encerrar)
