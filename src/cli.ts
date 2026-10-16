import { join } from 'node:path'
import readline from 'node:readline/promises'
import { criarClienteClaude, responder } from './agent.js'
import { criarServicoAgenda } from './agendamento.js'
import { carregarConfig } from './config.js'
import { criarNotificador } from './notify.js'
import { carregarInstrucoes, instrucoesIncompletas } from './prompt.js'
import { Store } from './store.js'

/** Conversa com o bot no terminal, sem WhatsApp. Serve para testar as instruções antes de ligar de verdade. */
try {
  process.loadEnvFile()
} catch {
  // sem .env
}

let cfg: ReturnType<typeof carregarConfig>
try {
  cfg = carregarConfig()
} catch (err) {
  console.error(`\n❌ ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
}
const CHAT = '5500000000000'

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('\n❌ Falta a variável ANTHROPIC_API_KEY (chave da Claude API). Coloque no arquivo .env.\n')
  process.exit(1)
}

let instrucoes: string
try {
  instrucoes = carregarInstrucoes(cfg.instrucoesPath)
} catch {
  console.error(`\n❌ Não encontrei o arquivo de instruções em ${cfg.instrucoesPath}.\n`)
  process.exit(1)
}
if (instrucoesIncompletas(instrucoes)) console.log('⚠️  O instrucoes.md ainda tem trechos [PREENCHER].\n')

const store = new Store(join(cfg.dataDir, 'cli.db'))
const notificar = criarNotificador(cfg)
let agenda
try {
  agenda = criarServicoAgenda(cfg, store, notificar)
} catch (err) {
  console.error(`\n❌ ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
}
const deps = { cfg, store, claude: criarClienteClaude(), notificar, agenda }
if (agenda.modo === 'google') {
  console.log('⚠️  ATENÇÃO: o Google Agenda configurado será usado DE VERDADE neste teste: avaliações marcadas aqui criam eventos reais.')
  console.log('   Use uma agenda de teste (GOOGLE_CALENDAR_ID) e apague os eventos depois.\n')
}

console.log(`Teste do bot (modelo ${cfg.model}). Comandos: /novo reinicia a conversa, /sair encerra.`)
console.log('As alterações no instrucoes.md valem na próxima mensagem, sem reiniciar.\n')

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
for (;;) {
  const linha = (await rl.question('Você: ').catch(() => '/sair')).trim()
  if (!linha) continue
  if (linha === '/sair') break
  if (linha === '/novo') {
    store.apagarConversa(CHAT)
    store.liberarHandoff(CHAT)
    console.log('(conversa reiniciada)\n')
    continue
  }
  store.adicionarMensagem(CHAT, 'user', linha)
  if (store.emHandoff(CHAT)) {
    console.log('(o bot ficaria em silêncio: a conversa foi passada para a equipe. Use /novo para recomeçar)\n')
    continue
  }
  try {
    const resposta = await responder(deps, CHAT, 'Cliente de Teste')
    store.adicionarMensagem(CHAT, 'assistant', resposta)
    console.log(`\nBot: ${resposta}\n`)
  } catch (err) {
    console.error(`\n❌ Erro: ${err instanceof Error ? err.message : err}\n`)
  }
}
rl.close()
store.fechar()
