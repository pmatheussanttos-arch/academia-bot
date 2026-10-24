import type { EstadoWhatsapp } from './baileys.js'
import { rotulo } from './agenda.js'
import { nascimentoBonito } from './matricula.js'
import { ESPERA_ALERTA_MIN, MUDO_APOS_MIN, type AvaliacaoInfo, type ResumoPainel } from './metricas.js'
import { descreverPausa, quando } from './pausa.js'
import type { HandoffAtivo, MatriculaSalva, StatusComparecimento } from './store.js'

/**
 * O painel do dono (/conectar): abas em páginas separadas, sem JavaScript. Cada aba é um endereço
 * (?aba=hoje, ?aba=vendas...), então o botão "voltar", o atalho da área de trabalho e os formulários
 * continuam funcionando como sempre. Tudo o que vem de cliente é escapado.
 */

export const ABAS = ['hoje', 'avaliacoes', 'vendas', 'conversas', 'bot', 'testar'] as const
export type Aba = (typeof ABAS)[number]

const ROTULO_ABA: Record<Aba, string> = { hoje: '📅 Hoje', avaliacoes: '🗓️ Avaliações', vendas: '💰 Vendas', conversas: '💬 Conversas', bot: '🤖 Bot', testar: '🧪 Testar' }

export function abaValida(v: unknown): Aba | undefined {
  return (ABAS as readonly string[]).includes(v as string) ? (v as Aba) : undefined
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export interface EstadoRotinas {
  resumo: { ligada: boolean; ultimo?: string }
  lembrete: { ligada: boolean; enviadosNaSemana: number; disponivel: boolean }
  gastoLimiteReais: number
}

export interface EstadoRetomada {
  /** Lembrete ao cliente (retomada de conversa). Desligado até o dono ligar. */
  ligada: boolean
  /** Aviso à equipe de cliente esperando. */
  avisoEquipeLigado: boolean
  /** Só funciona no modo QR. */
  disponivel: boolean
  automaticasHoje: number
  limiteDia: number
  avisosEquipeNaSemana: number
  /** Os lembretes enviados (e os que falharam), do mais novo para o mais antigo. */
  lembretes: Array<{ ts: number; chat: string; nome: string; tipo: string; resultado: string; texto: string }>
}

export interface DadosPainel {
  token: string
  aba: Aba
  /** https://meu-bot.onrender.com, para montar endereços completos. */
  origem: string
  fuso: string
  estado: EstadoWhatsapp
  imagemQr?: string
  resumo: ResumoPainel
  pausa: { ate: number | null } | undefined
  conversas: HandoffAtivo[]
  profs: { ligada: boolean; codigo?: string; professores: string[] }
  matriculas: MatriculaSalva[]
  toleranciaQuedaMin: number
  rotinas?: EstadoRotinas
  retomada?: EstadoRetomada
  /** Frase curta do resultado da última ação (ex.: "Maria veio à avaliação. Anotado!"). */
  aviso?: string
}

const reais = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`
const minutosPorExtenso = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`)

function urlPainel(token: string, aba?: Aba): string {
  return `/conectar?token=${encodeURIComponent(token)}${aba ? `&aba=${aba}` : ''}`
}

/** Formulário de um botão. Depois da ação, o navegador volta para a mesma aba do painel. */
function botaoForm(token: string, caminho: string, campos: Record<string, string>, rotuloBotao: string, classe: string, aba: Aba): string {
  const ocultos = Object.entries({ ...campos, voltar: 'conectar', aba }).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')
  return `<form method="post" action="${esc(`${caminho}?token=${encodeURIComponent(token)}`)}">${ocultos}<button class="${classe}" type="submit">${rotuloBotao}</button></form>`
}

// ---------------------------------------------------------------------------------------------------------------------
// Cartões que já existiam na página de conexão (mesmo texto e mesmos botões)
// ---------------------------------------------------------------------------------------------------------------------

function cartaoPausa(pausa: DadosPainel['pausa'], token: string, fuso: string, aba: Aba): string {
  const acao = `/admin/pausa?token=${encodeURIComponent(token)}`
  const form = (campos: string, botao: string, classe = '') =>
    `<form method="post" action="${esc(acao)}"><input type="hidden" name="voltar" value="conectar"><input type="hidden" name="aba" value="${aba}">${campos}${botao.replace('<button', `<button class="${classe}"`)}</form>`
  const pausar = (horas: number, rotuloBotao: string) =>
    form(`<input type="hidden" name="acao" value="pausar"><input type="hidden" name="horas" value="${horas}">`, `<button type="submit">${rotuloBotao}</button>`, 'pausar')
  if (!pausa) {
    return `<section class="pausa ativo"><div class="titulo">🟢 Assistente ATIVO</div>
      <p>Está respondendo os clientes. Para a equipe atender sozinha por um tempo, pause:</p>
      <div class="botoes">${pausar(1, '⏸️ Pausar 1 hora')}${pausar(4, '⏸️ Pausar 4 horas')}${pausar(0, '⏸️ Pausar até eu reativar')}</div>
      <p class="dica">Pelo celular da academia: na conversa com você mesmo, envie <b>pausar</b> (ou <b>retomar</b>). Para uma conversa só, escreva <b>transferido</b> nela (e <b>retomar</b> nela para devolver ao bot).</p></section>`
  }
  return `<section class="pausa pausado"><div class="titulo">⏸️ Assistente PAUSADO</div>
    <p>${esc(descreverPausa(pausa, fuso).replace('⏸️ ', ''))} Ele não está respondendo ninguém e as mensagens ficam não lidas no celular.</p>
    <div class="botoes">${form('<input type="hidden" name="acao" value="retomar">', '<button type="submit">▶️ Reativar agora</button>', 'reativar')}</div></section>`
}

/** +55 (11) 99999-8888 para telefone brasileiro; o resto aparece como código (telefone que o WhatsApp esconde). */
function rotuloContato(chat: string): string {
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(chat)
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `contato ${chat.length > 13 ? '(telefone oculto) ' : ''}${chat}`
}

function cartaoConversas(conversas: HandoffAtivo[], token: string, fuso: string, aba: Aba): string {
  if (conversas.length === 0) {
    return `<section class="conversas"><div class="titulo">💬 Conversas com a equipe</div><p>Nenhuma. O bot está respondendo todas as conversas.</p></section>`
  }
  const linhas = conversas
    .slice(0, 30)
    .map(
      (h) => `<li><div><b>${esc(rotuloContato(h.chat))}</b><br><span>${esc(h.motivo.replace(/[.\s]+$/, ''))}. O bot volta ${esc(quando(h.ate, fuso))}.</span></div>
        ${botaoForm(token, '/admin/liberar', { numero: h.chat }, 'Devolver ao bot', 'devolver', aba)}</li>`,
    )
    .join('')
  return `<section class="conversas"><div class="titulo">💬 Conversas com a equipe (${conversas.length})</div>
    <p>O bot está calado nestas conversas. Ele volta sozinho 1 hora depois da última mensagem da equipe, ou antes, se você devolver:</p>
    <ul>${linhas}</ul>${conversas.length > 30 ? '<p class="dica">Mostrando as 30 mais recentes.</p>' : ''}</section>`
}

function cartaoAgendaProfessores(estado: DadosPainel['profs'], token: string, origem: string, aba: Aba): string {
  const botao = (valor: string, rotuloBotao: string, classe: string) => botaoForm(token, '/admin/agenda', { acao: valor }, rotuloBotao, classe, aba)
  if (estado.professores.length === 0) {
    return `<section class="profs"><div class="titulo">👩‍🏫 Agenda dos professores</div>
      <p>Para usar, cadastre na Render a variável <b>AGENDA_PROFESSORES</b> com os nomes da equipe, separados por vírgula (ex.: <i>Ana, Bia, Carlos</i>). Depois volte aqui.</p></section>`
  }
  if (!estado.ligada) {
    return `<section class="profs"><div class="titulo">👩‍🏫 Agenda dos professores</div>
      <p>Página onde a equipe marca, desmarca e remarca avaliações. Hoje está <b>desligada</b>.</p>
      <p class="dica">Professores na lista: ${esc(estado.professores.join(', '))}</p>
      <div class="botoes">${botao('ligar', '🔗 Gerar o link da agenda', 'ligar')}</div></section>`
  }
  const link = `${origem}/agenda/${estado.codigo}`
  return `<section class="profs ligada"><div class="titulo">👩‍🏫 Agenda dos professores: LIGADA</div>
    <p>Mande este endereço no grupo privado da equipe (toque para selecionar e copiar):</p>
    <input class="link" type="text" readonly value="${esc(link)}" onclick="this.select()">
    <div class="botoes"><a class="abrir" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Abrir a agenda</a>
      ${botao('novo_link', '♻️ Gerar outro link', 'leve')}${botao('desligar', 'Desligar', 'perigo')}</div>
    <p class="dica">Quem tiver o link entra sem senha: mande só para a equipe. "Gerar outro link" derruba o endereço antigo na hora.</p></section>`
}

function cartaoMonitor(origem: string, toleranciaMin: number): string {
  const url = `${origem}/status/whatsapp`
  return `<section class="monitor"><div class="titulo">🔔 Aviso se o WhatsApp cair</div>
    <p>Hoje ninguém é avisado quando a conexão cai. Cadastre este endereço num monitor gratuito (UptimeRobot, por exemplo) para receber um e-mail:</p>
    <input class="link" type="text" readonly value="${esc(url)}" onclick="this.select()">
    <p class="dica">Ele responde "tudo certo" enquanto o WhatsApp está conectado e acusa erro quando está fora do ar há mais de ${toleranciaMin} minutos (quedas curtas e reinícios não alarmam). Passo a passo no arquivo AVISO-QUEDA.md.</p></section>`
}

function cartaoTeste(token: string): string {
  return `<section class="teste"><div class="titulo">🧪 Testar o bot sem WhatsApp</div>
    <p>Converse com o GFIT aqui no navegador, como se fosse um cliente. Nada vai para o WhatsApp, para a agenda nem para a lista de matrículas de verdade.</p>
    <div class="botoes"><a class="abrir" href="/teste?token=${encodeURIComponent(token)}" target="_blank" rel="noopener noreferrer">Abrir em tela cheia</a></div></section>
    <iframe class="moldura" src="/teste?token=${encodeURIComponent(token)}" title="Testar o GFIT" loading="lazy"></iframe>`
}

// ---------------------------------------------------------------------------------------------------------------------
// Peças novas
// ---------------------------------------------------------------------------------------------------------------------

function numeros(itens: Array<{ valor: string | number; legenda: string; destaque?: boolean }>): string {
  return `<div class="numeros">${itens.map((i) => `<div class="num${i.destaque ? ' destaque' : ''}"><b>${esc(String(i.valor))}</b><span>${esc(i.legenda)}</span></div>`).join('')}</div>`
}

function barras(itens: Array<{ rotulo: string; valor: number }>, sufixo = ''): string {
  if (itens.length === 0) return '<p class="dica">Ainda sem dados.</p>'
  const max = Math.max(...itens.map((i) => i.valor), 1)
  return `<div class="barras">${itens
    .map((i) => `<div class="barra"><span class="r">${esc(i.rotulo)}</span><span class="b"><i style="width:${Math.max(3, Math.round((i.valor / max) * 100))}%"></i></span><span class="v">${i.valor}${sufixo}</span></div>`)
    .join('')}</div>`
}

const CHIP_COMPARECIMENTO: Record<StatusComparecimento, string> = { veio: '✅ Veio', faltou: '❌ Faltou', matriculou: '🏋️ Veio e matriculou' }

function itemAvaliacao(a: AvaliacaoInfo, d: DadosPainel, opcoes: { comDia?: boolean } = {}): string {
  const r = rotulo(a.inicio, d.fuso)
  const jaComecou = a.inicio <= d.resumo.geradoEm
  const quem = [a.origem === 'professores' && a.marcadoPor ? `marcou: ${esc(a.marcadoPor)}` : '', a.whatsapp ? `<a href="https://wa.me/${esc(a.whatsapp)}" target="_blank" rel="noopener noreferrer">+${esc(a.whatsapp)}</a>` : ''].filter(Boolean).join(' · ')
  let acoes = ''
  if (a.comparecimento) {
    acoes = `<span class="status ${a.comparecimento}">${CHIP_COMPARECIMENTO[a.comparecimento]}</span>${botaoForm(d.token, '/admin/comparecimento', { eventoId: a.id, status: 'limpar' }, 'Desfazer', 'minusculo', d.aba)}`
  } else if (jaComecou) {
    const b = (status: StatusComparecimento, texto: string, classe: string) => botaoForm(d.token, '/admin/comparecimento', { eventoId: a.id, status }, texto, classe, d.aba)
    acoes = `<div class="presenca"><span class="pergunta">Veio?</span>${b('veio', '✅ Veio', 'sim')}${b('faltou', '❌ Faltou', 'nao')}${b('matriculou', '🏋️ Matriculou', 'mat')}</div>`
  }
  return `<li class="aval"><div class="hora">${esc(opcoes.comDia ? `${r.diaSemana.slice(0, 3)} ${r.data}` : r.hora)}${opcoes.comDia ? `<small>${esc(r.hora)}</small>` : ''}</div>
    <div class="info"><b>${esc(a.cliente)}</b> <span class="chip">${esc(origemRotulo(a))}</span>${quem ? `<br><span>${quem}</span>` : ''}</div>${acoes ? `<div class="acoes">${acoes}</div>` : ''}</li>`
}

const ORIGENS: Record<AvaliacaoInfo['origem'], string> = {
  bot: 'Assistente (WhatsApp)',
  recepcao: 'Recepção (lista)',
  professores: 'Página dos professores',
  agenda: 'Direto na agenda do Google',
}
const origemRotulo = (a: AvaliacaoInfo) => ORIGENS[a.origem]

function avisoAgenda(r: ResumoPainel): string {
  if (!r.agenda.ligada) return `<p class="alerta">A agenda do Google não está ligada neste bot, então os números de avaliações ficam zerados.</p>`
  if (r.agenda.erro) return `<p class="alerta">Não consegui ler a agenda do Google agora (${esc(r.agenda.erro)}). Os números de avaliações podem estar incompletos.</p>`
  return ''
}

/** O que precisa de atenção agora, no alto da primeira aba. */
function alertas(d: DadosPainel): string {
  const r = d.resumo
  const itens: Array<{ texto: string; aba: Aba; grave?: boolean }> = []
  if (!r.saude.whatsapp.ok) itens.push({ texto: `🔴 ${r.saude.whatsapp.mensagem}`, aba: 'bot', grave: true })
  if (r.saude.mudo) itens.push({ texto: `🔇 O WhatsApp está conectado, mas ${r.saude.clientesSemResposta} cliente(s) esperam resposta há mais de ${MUDO_APOS_MIN} min. O bot pode estar mudo.`, aba: 'conversas', grave: true })
  const esperando = r.espera.filter((e) => e.alerta)
  if (esperando.length) itens.push({ texto: `⏳ ${esperando.length} cliente(s) esperando a equipe há mais de ${ESPERA_ALERTA_MIN} min.`, aba: 'conversas', grave: true })
  if (r.pendentes.length) itens.push({ texto: `📝 ${r.pendentes.length} matrícula(s) para lançar na plataforma.`, aba: 'vendas' })
  if (r.comparecimento.semMarcar.length) itens.push({ texto: `🗒️ ${r.comparecimento.semMarcar.length} avaliação(ões) passaram e ninguém anotou se o cliente veio.`, aba: 'avaliacoes' })
  if (r.custo.percentualDoLimite !== undefined && r.custo.percentualDoLimite >= 80) itens.push({ texto: `💸 Gasto da IA em ${r.custo.percentualDoLimite}% do limite do mês (${reais(r.custo.mes.reais)} de ${reais(r.custo.limiteReais)}).`, aba: 'bot', grave: r.custo.percentualDoLimite >= 100 })
  if (itens.length === 0) return `<section class="tudo-certo">✅ Tudo em ordem. Nada precisa de você agora.</section>`
  return `<section class="avisos"><div class="titulo">Precisa de atenção</div><ul>${itens
    .map((i) => `<li class="${i.grave ? 'grave' : ''}"><a href="${esc(urlPainel(d.token, i.aba))}">${esc(i.texto)}</a></li>`)
    .join('')}</ul></section>`
}

// ---------------------------------------------------------------------------------------------------------------------
// Abas
// ---------------------------------------------------------------------------------------------------------------------

function abaHoje(d: DadosPainel): string {
  const r = d.resumo
  const lista = r.hoje.length
    ? `<ul class="lista">${r.hoje.map((a) => itemAvaliacao(a, d)).join('')}</ul>`
    : '<p>Nenhuma avaliação marcada para hoje.</p>'
  return `${alertas(d)}
    <section class="cartao"><div class="titulo">📅 Avaliações de hoje (${r.hoje.length})</div>${avisoAgenda(r)}${lista}</section>
    <section class="cartao"><div class="titulo">Em números</div>${numeros([
      { valor: r.hoje.length, legenda: 'hoje' },
      { valor: r.semana.total, legenda: `nesta semana (${r.semana.aVir} ainda por vir)` },
      { valor: r.mes.total, legenda: `em ${r.mesRotulo}`, destaque: true },
    ])}</section>
    ${cartaoPausa(d.pausa, d.token, d.fuso, d.aba)}`
}

function abaAvaliacoes(d: DadosPainel): string {
  const r = d.resumo
  const origem = barras(r.porOrigem.map((o) => ({ rotulo: o.rotulo, valor: o.total })))
  const prox = r.proximas.length ? `<ul class="lista">${r.proximas.map((a) => itemAvaliacao(a, d, { comDia: true })).join('')}</ul>` : '<p>Nenhuma avaliação marcada para os próximos dias.</p>'
  const c = r.comparecimento
  const semMarcar = c.semMarcar.length
    ? `<p>Estas já passaram. Toque para anotar o que aconteceu:</p><ul class="lista">${c.semMarcar.map((a) => itemAvaliacao(a, d, { comDia: true })).join('')}</ul>`
    : '<p class="dica">Nenhuma avaliação passada esperando anotação.</p>'
  const taxa = (v: number | undefined, txt: string) => (v === undefined ? { valor: '—', legenda: txt } : { valor: `${v}%`, legenda: txt })
  return `${avisoAgenda(r)}
    <section class="cartao"><div class="titulo">🗓️ Avaliações em ${esc(r.mesRotulo)}</div>${numeros([
      { valor: r.mes.total, legenda: 'no mês', destaque: true },
      { valor: r.mes.feitas, legenda: 'já passaram' },
      { valor: r.mes.aVir, legenda: 'ainda por vir' },
      { valor: r.semana.total, legenda: 'nesta semana' },
    ])}
      <p class="dica">Conta TODAS as avaliações da agenda do Google, não só as que o assistente marcou.</p></section>
    <section class="cartao"><div class="titulo">Quem marcou</div>${origem}</section>
    <section class="cartao"><div class="titulo">Dias e horários mais usados no mês</div>
      <h3>Por dia da semana</h3>${barras(r.porDiaSemana.map((x) => ({ rotulo: x.rotulo, valor: x.total })))}
      <h3>Por horário</h3>${barras(r.porHorario.map((x) => ({ rotulo: x.hhmm, valor: x.total })))}</section>
    <section class="cartao"><div class="titulo">Agenda cheia?</div>
      <p>Nos próximos ${r.ocupacao.dias} dias, <b>${r.ocupacao.ocupados}</b> de <b>${r.ocupacao.total}</b> horários estão ocupados (<b>${r.ocupacao.percentual}%</b>). Sobram <b>${r.ocupacao.livres}</b> livres.</p>
      <div class="barra"><span class="b" style="flex:1"><i style="width:${Math.max(r.ocupacao.percentual, r.ocupacao.ocupados > 0 ? 2 : 0)}%"></i></span></div></section>
    <section class="cartao"><div class="titulo">Próximas avaliações (${r.proximas.length})</div>${prox}</section>
    <section class="cartao"><div class="titulo">✅ Quem veio e quem faltou</div>${numeros([
      { valor: c.veio + c.matriculou, legenda: 'vieram' },
      { valor: c.faltou, legenda: 'faltaram' },
      { valor: c.matriculou, legenda: 'fecharam matrícula' },
      taxa(c.taxaFalta, 'de faltas'),
      taxa(c.taxaConversao, 'de quem veio matriculou'),
    ])}
      <p class="dica">Vale para as avaliações do mês que alguém anotou (aqui ou na agenda dos professores).</p>${semMarcar}</section>
    ${cartaoAgendaProfessores(d.profs, d.token, d.origem, d.aba)}`
}

function cartaoMatriculas(d: DadosPainel): string {
  const lista = d.matriculas
  if (lista.length === 0) {
    return `<section class="matriculas"><div class="titulo">📝 Matrículas pelo WhatsApp</div><p>Nenhuma por enquanto. Quando um cliente fechar um plano pela conversa, os dados aparecem aqui.</p></section>`
  }
  const item = (m: MatriculaSalva, pendente: boolean) => {
    const q = rotulo(m.ts, d.fuso)
    const dados = [
      `WhatsApp: <a href="https://wa.me/${esc(m.telefone)}" target="_blank" rel="noopener noreferrer">+${esc(m.telefone)}</a>`,
      m.email ? `E-mail: ${esc(m.email)}` : '',
      m.nascimento ? `Nascimento: ${esc(nascimentoBonito(m.nascimento))}` : '',
      m.observacao ? `Obs.: ${esc(m.observacao)}` : '',
    ].filter(Boolean).join(' · ')
    const acao = pendente
      ? botaoForm(d.token, '/admin/matricula-lancada', { id: String(m.id), lancada: '1' }, '✅ Já lancei na plataforma', 'lancei', d.aba)
      : `<span class="status veio">✅ Lançada${m.lancadaEm ? ` (${esc(rotulo(m.lancadaEm, d.fuso).data)})` : ''}</span>${botaoForm(d.token, '/admin/matricula-lancada', { id: String(m.id), lancada: '0' }, 'Desfazer', 'minusculo', d.aba)}`
    return `<li><div><b>${esc(m.nome)}</b> — ${esc(m.plano)} <span class="forma">${m.pagamento === 'pix' ? 'Pix' : 'cartão'}</span><br><span>${dados}</span><br><span>${esc(q.dia)} às ${esc(q.hora)}</span></div><div class="acoes">${acao}</div></li>`
  }
  const pendentes = lista.filter((m) => m.lancadaEm === null)
  const lancadas = lista.filter((m) => m.lancadaEm !== null)
  return `<section class="matriculas"><div class="titulo">📝 Matrículas pelo WhatsApp (${lista.length})</div>
    <p>Lance estes cadastros na plataforma da academia e toque em <b>Já lancei</b>. No Pix, confira o comprovante antes.</p>
    ${pendentes.length ? `<h3>Para lançar (${pendentes.length})</h3><ul>${pendentes.slice(0, 30).map((m) => item(m, true)).join('')}</ul>` : '<p class="dica">✅ Tudo lançado. Nada pendente.</p>'}
    ${lancadas.length ? `<details><summary>Já lançadas (${lancadas.length})</summary><ul>${lancadas.slice(0, 30).map((m) => item(m, false)).join('')}</ul></details>` : ''}
    ${lista.length > 50 ? '<p class="dica">Mostrando as mais recentes.</p>' : ''}</section>`
}

function abaVendas(d: DadosPainel): string {
  const r = d.resumo
  const f = r.funil
  const passo = (valor: number, legenda: string) => `<div class="passo"><b>${valor}</b><span>${esc(legenda)}</span></div>`
  return `${avisoAgenda(r)}
    <section class="cartao"><div class="titulo">🔻 Funil de ${esc(r.mesRotulo)}</div>
      <div class="funil">${passo(f.conversas, 'conversas novas no WhatsApp')}<span class="seta">→</span>${passo(f.avaliacoes, 'avaliações na agenda (todas as origens)')}<span class="seta">→</span>${passo(f.matriculasPeloBot, 'matrículas fechadas pelo WhatsApp')}</div>
      <p>${f.avaliacoesPeloBot} das avaliações foram marcadas pelo assistente. ${f.avaliacoesQueMatricularam} avaliação(ões) do mês têm o mesmo telefone de uma matrícula feita pelo WhatsApp.</p>
      <p class="dica">Atenção: só entram aqui as matrículas que o cliente fechou pela conversa. Quem fecha na recepção, depois da avaliação, não aparece neste funil. Para isso existe o botão "🏋️ Matriculou" nas avaliações.</p></section>
    ${cartaoMatriculas(d)}`
}

function cartaoEspera(d: DadosPainel): string {
  const e = d.resumo.espera
  if (e.length === 0) return ''
  return `<section class="cartao espera"><div class="titulo">⏳ Esperando a equipe (${e.length})</div>
    <p>O bot passou estes clientes para vocês e ninguém respondeu ainda:</p>
    <ul class="lista">${e
      .map((x) => `<li class="${x.alerta ? 'grave' : ''}"><div><b>${esc(rotuloContato(x.chat))}</b><br><span>${esc(x.motivo.replace(/[.\s]+$/, ''))}</span></div><div class="acoes"><span class="status ${x.alerta ? 'faltou' : 'veio'}">${esc(minutosPorExtenso(x.minutos))}</span><a class="abrir" href="https://wa.me/${esc(x.chat)}" target="_blank" rel="noopener noreferrer">Abrir conversa</a></div></li>`)
      .join('')}</ul></section>`
}

const TIPO_LEMBRETE: Record<string, string> = {
  lembrete_transferida: 'Transferido e a equipe não respondeu',
  lembrete_parou: 'Parou no meio da venda',
}

function cartaoRetomada(d: DadosPainel): string {
  const r = d.retomada
  if (!r) return ''
  const interruptor = (nome: 'retomada' | 'alerta_espera', ligada: boolean) =>
    r.disponivel ? botaoForm(d.token, '/admin/rotinas', { rotina: nome, ligar: ligada ? '0' : '1' }, ligada ? 'Desligar' : 'Ligar', ligada ? 'desligar' : '', d.aba) : ''
  const rotuloResultado = (x: string) => (x === 'enviado' ? '✅ enviado' : x === 'enviando' ? '⏳ enviando' : `❌ ${esc(x.replace(/^falhou:\s*/, 'falhou: '))}`)
  const lista = r.lembretes.length
    ? `<ul class="lista">${r.lembretes
        .map(
          (l) => `<li><div><b>${esc(l.nome || rotuloContato(l.chat))}</b>${l.nome ? ` <span>${esc(rotuloContato(l.chat))}</span>` : ''}<br><span>${esc(TIPO_LEMBRETE[l.tipo] ?? l.tipo)} · ${esc(rotulo(l.ts, d.fuso).dia)} às ${esc(rotulo(l.ts, d.fuso).hora)}</span>${l.texto ? `<br><span>“${esc(l.texto)}”</span>` : ''}</div><div class="acoes"><span class="status ${l.resultado === 'enviado' ? 'veio' : 'faltou'}">${rotuloResultado(l.resultado)}</span></div></li>`,
        )
        .join('')}</ul>`
    : '<p class="dica">Nenhum lembrete enviado ainda.</p>'
  return `<section class="cartao rotinas"><div class="titulo">🔔 Retomada de conversas</div>
    <div class="linha"><div><b>Lembrete ao cliente</b> <span class="status ${r.ligada ? 'veio' : 'faltou'}">${r.ligada ? 'LIGADO' : 'DESLIGADO'}</span>
      <p class="dica">Uma mensagem curta, no máximo uma por conversa: para o cliente transferido que a equipe não respondeu em 2 horas (o bot volta a atender depois) e para quem parou no meio de uma venda há 3 horas. Só para quem escreveu nas últimas 24h, com a academia funcionando, entre 8h e 20h, com intervalo de 1 a 5 minutos entre mensagens e no máximo ${r.limiteDia} automáticas por dia. Nunca para quem disse "pare" ou "não quero", nem para a equipe. <b>Atenção:</b> mensagem automática aumenta o risco de o WhatsApp bloquear o número; por isso começa desligado.${r.disponivel ? '' : ' Só funciona no modo QR.'}</p></div>${interruptor('retomada', r.ligada)}</div>
    <div class="linha"><div><b>Aviso à equipe</b> <span class="status ${r.avisoEquipeLigado ? 'veio' : 'faltou'}">${r.avisoEquipeLigado ? 'LIGADO' : 'DESLIGADO'}</span>
      <p class="dica">Cliente transferido que a equipe não respondeu em 30 minutos: o bot avisa os números de aviso (uma vez de novo se passar 2 horas), só com a academia funcionando. Avisos enviados nos últimos 7 dias: ${r.avisosEquipeNaSemana}.</p></div>${interruptor('alerta_espera', r.avisoEquipeLigado)}</div>
    <h3>Quem recebeu lembrete (hoje: ${r.automaticasHoje} de ${r.limiteDia} mensagens automáticas)</h3>${lista}</section>`
}

function abaConversas(d: DadosPainel): string {
  const b = d.resumo.bot
  const perguntas = new Map<string, { n: number; ts: number; texto: string }>()
  for (const e of b.semResposta) {
    const chave = e.detalhe.trim().toLowerCase()
    if (!chave) continue
    const atual = perguntas.get(chave)
    perguntas.set(chave, { n: (atual?.n ?? 0) + 1, ts: Math.max(atual?.ts ?? 0, e.ts), texto: atual && atual.ts > e.ts ? atual.texto : e.detalhe.trim() })
  }
  const semResposta = perguntas.size
    ? `<ul class="lista simples">${[...perguntas].sort((x, y) => y[1].n - x[1].n || y[1].ts - x[1].ts).slice(0, 15).map(([, v]) => `<li><div>“${esc(v.texto)}”</div><div class="acoes"><span class="status veio">${v.n}×</span></div></li>`).join('')}</ul>
       <p class="dica">Perguntas em que o bot disse “essa informação eu não tenho”. Para ele passar a saber, escreva a resposta no arquivo instrucoes.md.</p>`
    : '<p class="dica">Nenhuma nos últimos 30 dias.</p>'
  const horas = b.mensagensPorHora.map((valor, h) => ({ rotulo: `${String(h).padStart(2, '0')}h`, valor })).filter((x) => x.valor > 0)
  return `${cartaoEspera(d)}${cartaoConversas(d.conversas, d.token, d.fuso, d.aba)}${cartaoRetomada(d)}
    <section class="cartao"><div class="titulo">🤖 O bot dá conta sozinho?</div>${numeros([
      { valor: b.conversasNoMes, legenda: `conversas novas em ${d.resumo.mesRotulo}` },
      { valor: b.conversasQueChamaramEquipe, legenda: 'pediram a equipe' },
      { valor: b.resolvidasPct === undefined ? '—' : `${b.resolvidasPct}%`, legenda: 'resolvidas só pelo bot', destaque: true },
    ])}</section>
    <section class="cartao"><div class="titulo">❓ O que o bot não soube responder (30 dias)</div>${semResposta}</section>
    <section class="cartao"><div class="titulo">🕒 Quando os clientes escrevem (30 dias)</div>${barras(horas)}</section>`
}

function cartaoCusto(d: DadosPainel): string {
  const c = d.resumo.custo
  const limite =
    c.percentualDoLimite === undefined
      ? '<p class="dica">Aviso de gasto desligado (GASTO_LIMITE_MENSAL=0).</p>'
      : `<p>Limite do mês: <b>${reais(c.limiteReais)}</b> (você está em <b>${c.percentualDoLimite}%</b>). A equipe é avisada no WhatsApp ao chegar em 80% e em 100%.</p>
         <div class="barra"><span class="b ${c.percentualDoLimite >= 100 ? 'estourou' : c.percentualDoLimite >= 80 ? 'alto' : ''}" style="flex:1"><i style="width:${Math.min(100, Math.max(c.percentualDoLimite, 2))}%"></i></span></div>`
  return `<section class="cartao"><div class="titulo">💸 Gasto estimado com a IA</div>${numeros([
    { valor: reais(c.hoje.reais), legenda: 'hoje' },
    { valor: reais(c.mes.reais), legenda: `em ${d.resumo.mesRotulo}`, destaque: true },
    { valor: reais(c.projecaoMesReais), legenda: 'previsão para o mês' },
    ...(c.porConversaReais !== undefined ? [{ valor: reais(c.porConversaReais), legenda: 'por conversa nova' }] : []),
  ])}${limite}
    <p class="dica">${c.mes.chamadas} ${c.mes.chamadas === 1 ? 'chamada' : 'chamadas'} à IA no mês. É uma estimativa feita pelo uso que o bot anotou (dólar a ${d.resumo.custo.mes.usd > 0 ? (d.resumo.custo.mes.reais / d.resumo.custo.mes.usd).toFixed(2).replace('.', ',') : '—'}); o valor real está em console.anthropic.com.${c.precoEstimado ? ' O preço deste modelo não está na tabela do bot: o cálculo foi feito por cima, para não subestimar.' : ''}</p></section>`
}

function cartaoSaude(d: DadosPainel): string {
  const s = d.resumo.saude
  const quandoFoi = (ms?: number) => (ms === undefined ? 'nunca' : `${rotulo(ms, d.fuso).dia} às ${rotulo(ms, d.fuso).hora}`)
  const estado = !s.whatsapp.ok ? '🔴' : s.mudo ? '🟠' : '🟢'
  const linha = s.mudo
    ? `Conectado, mas ${s.clientesSemResposta} cliente(s) sem resposta há mais de ${MUDO_APOS_MIN} min. O bot pode estar mudo: veja a aba Conversas.`
    : s.whatsapp.mensagem
  return `<section class="cartao"><div class="titulo">${estado} Saúde do bot</div><p>${esc(linha)}</p>
    <p class="dica">Última mensagem de cliente: ${esc(quandoFoi(s.ultimaMensagemCliente))}<br>Última resposta do bot: ${esc(quandoFoi(s.ultimaRespostaBot))}</p></section>`
}

function conexao(d: DadosPainel): string {
  const e = d.estado
  if (e.status === 'conectado') {
    return `<div class="ok">✅ Conectado${e.numero ? ` como <b>+${esc(e.numero)}</b>` : ''}</div><p>O assistente está no ar e respondendo no WhatsApp.</p>`
  }
  if (e.status === 'aguardando_qr' && d.imagemQr) {
    return `<p>No celular do número do bot, abra <b>WhatsApp &gt; Aparelhos conectados &gt; Conectar um aparelho</b> e aponte para o código:</p>
      <img src="${d.imagemQr}" alt="QR code" width="300" height="300" />
      <p class="dica">O código muda sozinho. Se expirar, esta página recarrega e mostra um novo.</p>`
  }
  return `<div class="aguarde">⏳ ${esc(e.detalhe ?? 'Preparando a conexão…')}</div>`
}

function cartaoRotinas(d: DadosPainel): string {
  const r = d.rotinas
  if (!r) return ''
  const linha = (nome: 'resumo' | 'lembrete', titulo: string, texto: string, ligada: boolean, disponivel = true) => `<div class="linha"><div><b>${titulo}</b> <span class="status ${ligada ? 'veio' : 'faltou'}">${ligada ? 'LIGADO' : 'DESLIGADO'}</span><p class="dica">${texto}</p></div>${
    disponivel ? botaoForm(d.token, '/admin/rotinas', { rotina: nome, ligar: ligada ? '0' : '1' }, ligada ? 'Desligar' : 'Ligar', ligada ? 'desligar' : '', d.aba) : ''
  }</div>`
  return `<section class="cartao rotinas"><div class="titulo">⏰ Rotinas automáticas</div>
    ${linha('resumo', 'Resumo da semana para a equipe', `Toda segunda, depois das 8h, o balanço da semana que passou vai no WhatsApp dos números de aviso (NUMEROS_AVISOS).${r.resumo.ultimo ? ` Último envio: ${esc(r.resumo.ultimo)}.` : ''}`, r.resumo.ligada)}
    ${linha('lembrete', 'Lembrete ao cliente, 1 dia antes da avaliação', `Entre 17h e 20h do dia anterior, o bot lembra o cliente da avaliação. Só para quem já conversou com o bot, no máximo 30 por dia e com pausa entre eles. <b>Atenção:</b> mensagem automática aumenta um pouco o risco de o WhatsApp bloquear o número; por isso começa desligado.${r.lembrete.disponivel ? ` Enviados nos últimos 7 dias: ${r.lembrete.enviadosNaSemana}. O texto fica em mensagens.md (seção lembrete-avaliacao).` : ' Só funciona no modo QR.'}`, r.lembrete.ligada, r.lembrete.disponivel)}
    <div class="linha"><div><b>Aviso de gasto da IA</b> <span class="status ${r.gastoLimiteReais > 0 ? 'veio' : 'faltou'}">${r.gastoLimiteReais > 0 ? 'LIGADO' : 'DESLIGADO'}</span><p class="dica">${r.gastoLimiteReais > 0 ? `Avisa a equipe no WhatsApp quando o gasto chegar a 80% e a 100% de ${reais(r.gastoLimiteReais)} no mês. Para mudar o limite: variável GASTO_LIMITE_MENSAL na Render.` : 'Defina GASTO_LIMITE_MENSAL na Render (em reais) para ser avisado.'}</p></div></div></section>`
}

function abaBot(d: DadosPainel): string {
  return `<section class="cartao centro">${conexao(d)}</section>
    ${cartaoPausa(d.pausa, d.token, d.fuso, d.aba)}
    ${cartaoSaude(d)}
    ${cartaoCusto(d)}
    ${cartaoRotinas(d)}
    ${cartaoMonitor(d.origem, d.toleranciaQuedaMin)}`
}

function abaTestar(d: DadosPainel): string {
  return cartaoTeste(d.token)
}

// ---------------------------------------------------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------------------------------------------------

const ESTILO = `
  :root{--texto:#1b1f24;--suave:#5b6572;--borda:#dde3ec;--fundo:#f4f6f9;--cartao:#fff;--marca:#c2680a;--azul:#2459b8;--verde:#0a7a2f;--vermelho:#c0392b}
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;background:var(--fundo);color:var(--texto);font-size:16px;line-height:1.45}
  main{max-width:780px;margin:0 auto;padding:0 14px 40px}
  header{background:var(--cartao);border-bottom:1px solid var(--borda)}
  header .topo{max-width:780px;margin:0 auto;padding:12px 14px 8px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
  h1{font-size:1.15rem;margin:0}
  .pilula{font-size:.85rem;font-weight:700;border-radius:999px;padding:4px 12px;background:#eaf7ee;color:#0a7a2f;border:1px solid #b7e2c3}
  .pilula.ruim{background:#fdecea;color:#a12a1b;border-color:#e6a39b}
  .pilula.meio{background:#fff4e0;color:#8a5a00;border-color:#f0c987}
  nav{max-width:780px;margin:0 auto;display:flex;gap:2px;overflow-x:auto;padding:0 8px;-webkit-overflow-scrolling:touch}
  nav a{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 12px;text-decoration:none;color:var(--suave);font-weight:600;font-size:.95rem;border-bottom:3px solid transparent;white-space:nowrap}
  nav a.atual{color:var(--marca);border-bottom-color:var(--marca)}
  nav .conta{background:var(--vermelho);color:#fff;border-radius:999px;font-size:.72rem;padding:1px 7px}
  .cartao,.avisos,.tudo-certo{margin-top:14px;padding:16px;border-radius:14px;background:var(--cartao);border:1px solid var(--borda);text-align:left}
  .cartao.centro{text-align:center}
  .titulo{font-weight:700;font-size:1.05rem;margin-bottom:6px}
  h3{font-size:.9rem;margin:14px 0 4px;color:var(--suave)}
  p{margin:8px 0}
  .dica{color:var(--suave);font-size:.85rem}
  .ok{font-size:1.3rem;color:#0a7a2f;margin:12px 0}
  .aguarde{font-size:1.1rem;color:#8a5a00;margin:20px 0}
  img{border:1px solid #ddd;border-radius:12px;padding:8px;background:#fff;max-width:100%;height:auto}
  .banner{margin-top:14px;padding:12px 14px;border-radius:12px;background:#e8f1ff;border:1px solid #b6cdf5;color:#17407f;font-weight:600}
  .alerta{background:#fff4e0;border:1px solid #f0c987;border-radius:10px;padding:10px 12px;color:#5c3d00}
  .tudo-certo{background:#eaf7ee;border-color:#b7e2c3;color:#0a5a22;font-weight:600}
  .avisos{background:#fff8e8;border-color:#f0d9a8}
  .avisos ul{list-style:none;margin:6px 0 0;padding:0}
  .avisos li{padding:8px 0;border-top:1px solid #f0d9a8}
  .avisos li.grave a{color:#a12a1b;font-weight:700}
  .avisos a{color:var(--texto);text-decoration:none}
  .numeros{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:8px 0}
  .num{background:#f4f6f9;border-radius:12px;padding:10px 12px}
  .num b{display:block;font-size:1.5rem;line-height:1.2}
  .num span{color:var(--suave);font-size:.82rem}
  .num.destaque{background:#fff3e2}
  .barras{display:flex;flex-direction:column;gap:6px}
  .barra{display:flex;align-items:center;gap:8px;font-size:.88rem}
  .barra .r{flex:0 0 150px;color:var(--suave)}
  .barra .b{flex:1;background:#eef1f6;border-radius:999px;height:12px;overflow:hidden}
  .barra .b i{display:block;height:100%;background:var(--marca);border-radius:999px}
  .barra .b.alto i{background:#d98a00}
  .barra .b.estourou i{background:var(--vermelho)}
  .barra .v{flex:0 0 40px;text-align:right;font-weight:700}
  .lista,.cartao ul,.matriculas ul,.conversas ul{list-style:none;margin:6px 0 0;padding:0}
  .lista li,.matriculas li,.conversas li{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--borda);flex-wrap:wrap}
  .lista li.grave{background:#fdf1ef}
  .lista li span,.matriculas li span,.conversas li span{color:var(--suave);font-size:.85rem}
  .aval .hora{flex:0 0 58px;font-weight:700;font-size:1.05rem}
  .aval .hora small{display:block;font-weight:500;color:var(--suave);font-size:.8rem}
  .aval .info{flex:1 1 180px;min-width:0}
  .acoes{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .chip{display:inline-block;font-size:.72rem;font-weight:700;color:#5b3fa8;border:1px solid #cfc3ee;border-radius:999px;padding:1px 8px}
  .status{display:inline-block;font-size:.8rem;font-weight:700;border-radius:999px;padding:3px 10px;background:#eaf7ee;color:#0a7a2f}
  .status.faltou{background:#fdecea;color:#a12a1b}
  .status.matriculou{background:#f3f0fb;color:#5b3fa8}
  .presenca{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  .presenca .pergunta{font-size:.8rem;color:var(--suave)}
  .presenca form,.acoes form{margin:0}
  .presenca button,.acoes button{font:inherit;font-weight:600;font-size:.85rem;min-height:44px;padding:0 12px;border-radius:8px;border:1px solid var(--borda);background:#fff;color:var(--texto);cursor:pointer}
  .presenca button.sim{border-color:#8fd0a3;color:#0a5a22}
  .presenca button.nao{border-color:#e6a39b;color:#a12a1b}
  .presenca button.mat{border-color:#cfc3ee;color:#5b3fa8}
  .acoes button.lancei{background:var(--verde);color:#fff;border:0}
  .acoes button.minusculo{min-height:36px;font-size:.78rem;color:var(--suave)}
  .acoes .abrir,.botoes .abrir{display:inline-flex;align-items:center;font-weight:600;padding:0 14px;min-height:44px;border-radius:8px;background:var(--verde);color:#fff;text-decoration:none}
  .funil{display:flex;align-items:stretch;gap:6px;flex-wrap:wrap;margin:8px 0}
  .funil .passo{flex:1 1 120px;background:#f4f6f9;border-radius:12px;padding:10px 12px}
  .funil .passo b{display:block;font-size:1.6rem}
  .funil .passo span{font-size:.8rem;color:var(--suave)}
  .funil .seta{align-self:center;color:var(--suave);font-size:1.3rem}
  details{margin-top:10px}
  summary{cursor:pointer;font-weight:600;min-height:44px;display:flex;align-items:center}
  .pausa{margin-top:14px;padding:16px;border-radius:14px;text-align:left}
  .pausa.ativo{background:#eaf7ee;border:1px solid #b7e2c3}
  .pausa.pausado{background:#fff4e0;border:1px solid #f0c987}
  .pausa .titulo{font-weight:700;font-size:1.1rem}
  .pausa p{margin:8px 0;color:#333}
  .pausa .dica{color:#666;font-size:.85rem}
  .botoes{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
  .botoes form{margin:0}
  .botoes button{font:inherit;font-weight:600;padding:12px 14px;min-height:44px;border:0;border-radius:8px;color:#fff;cursor:pointer}
  .botoes button.leve{background:#fff;color:#222;border:1px solid #bcc5d2}
  .botoes button.perigo{background:#c0392b}
  .botoes button.pausar{background:#c2680a}
  .botoes button.reativar{background:#0a7a2f;font-size:1.05rem;padding:12px 18px}
  .conversas{margin-top:14px;padding:16px;border-radius:14px;text-align:left;background:#f1f4f9;border:1px solid #d5dce8}
  .conversas .titulo{font-weight:700;font-size:1.05rem}
  .conversas p{margin:8px 0;color:#333}
  .conversas button.devolver{font:inherit;font-weight:600;padding:8px 12px;min-height:44px;border:0;border-radius:8px;color:#fff;background:#2459b8;cursor:pointer;white-space:nowrap}
  .profs{margin-top:14px;padding:16px;border-radius:14px;text-align:left;background:#eef3ff;border:1px solid #c3d2f5}
  .profs.ligada{background:#eaf7ee;border-color:#b7e2c3}
  .profs .titulo{font-weight:700;font-size:1.05rem}
  .profs p{margin:8px 0;color:#333}
  .profs .dica{color:#666;font-size:.85rem}
  .profs .link,.monitor .link{width:100%;font:inherit;font-size:.9rem;padding:10px;border:1px solid #c3d2f5;border-radius:8px;background:#fff;color:#222}
  .profs .botoes button.ligar{background:#2459b8}
  .matriculas{margin-top:14px;padding:16px;border-radius:14px;text-align:left;background:#f3f0fb;border:1px solid #d4c9ee}
  .matriculas .titulo{font-weight:700;font-size:1.05rem}
  .matriculas p{margin:8px 0;color:#333}
  .matriculas .dica{color:#666;font-size:.85rem}
  .matriculas .forma{display:inline-block;font-size:.75rem;font-weight:700;color:#5b3fa8;border:1px solid #5b3fa8;border-radius:999px;padding:1px 8px}
  .teste{margin-top:14px;padding:16px;border-radius:14px;text-align:left;background:#eefaf5;border:1px solid #b5e3d0}
  .teste .titulo{font-weight:700;font-size:1.05rem}
  .teste p{margin:8px 0;color:#333}
  .moldura{display:block;width:100%;height:78vh;min-height:520px;margin-top:14px;border:1px solid var(--borda);border-radius:14px;background:#fff}
  .monitor{margin-top:14px;padding:16px;border-radius:14px;text-align:left;background:#fff8e8;border:1px solid #f0d9a8}
  .monitor .titulo{font-weight:700;font-size:1.05rem}
  .monitor p{margin:8px 0;color:#333}
  .monitor .dica{color:#666;font-size:.85rem}
  .monitor .link{border-color:#f0d9a8}
  .rotinas .linha{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--borda);flex-wrap:wrap}
  .rotinas .linha:first-of-type{border-top:0}
  .rotinas button{font:inherit;font-weight:600;min-height:44px;padding:0 14px;border-radius:8px;border:0;color:#fff;background:var(--azul);cursor:pointer}
  .rotinas button.desligar{background:#fff;color:#222;border:1px solid #bcc5d2}
  @media (max-width:520px){.barra .r{flex-basis:96px}.funil .seta{display:none}nav{flex-wrap:wrap;overflow-x:visible;padding:0 4px}nav a{flex:1 1 33%;justify-content:center;padding:0 4px;border-bottom-width:3px}}
`

export function paginaPainel(d: DadosPainel): string {
  const r = d.resumo
  const conectado = d.estado.status === 'conectado'
  const pilula = conectado
    ? `<span class="pilula">🟢 WhatsApp conectado${d.estado.numero ? ` (+${esc(d.estado.numero)})` : ''}</span>`
    : `<span class="pilula ${d.estado.status === 'aguardando_qr' ? 'ruim' : 'meio'}">${d.estado.status === 'aguardando_qr' ? '🔴 WhatsApp desconectado' : '⏳ WhatsApp conectando'}</span>`

  const contadores: Partial<Record<Aba, number>> = {
    hoje: r.espera.filter((e) => e.alerta).length + (r.saude.mudo ? 1 : 0) + (!r.saude.whatsapp.ok ? 1 : 0),
    vendas: r.pendentes.length,
    conversas: r.espera.length,
  }
  const nav = ABAS.map((a) => {
    const n = contadores[a]
    return `<a class="${a === d.aba ? 'atual' : ''}" href="${esc(urlPainel(d.token, a))}"${a === d.aba ? ' aria-current="page"' : ''}>${ROTULO_ABA[a]}${n ? `<span class="conta">${n}</span>` : ''}</a>`
  }).join('')

  // Recarrega sozinha só quando falta conectar e a pessoa está olhando o QR; conectado, a página fica parada.
  const refresh = !conectado && d.aba === 'bot' ? `<meta http-equiv="refresh" content="5;url=${esc(urlPainel(d.token, 'bot'))}">` : ''
  const corpo = { hoje: abaHoje, avaliacoes: abaAvaliacoes, vendas: abaVendas, conversas: abaConversas, bot: abaBot, testar: abaTestar }[d.aba](d)

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex, nofollow">${refresh}
    <title>Painel da GarageFit</title><style>${ESTILO}</style></head><body>
    <header><div class="topo"><h1>Assistente da GarageFit</h1>${pilula}</div><nav>${nav}</nav></header>
    <main>${d.aviso ? `<div class="banner" role="status">${esc(d.aviso)}</div>` : ''}${corpo}</main></body></html>`
}
