import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type Papel = 'user' | 'assistant'

export interface MensagemSalva {
  papel: Papel
  conteudo: string
  ts: number
}

/** Ação de um professor na página /agenda, guardada para o dono ver quem fez o quê e quando. */
export interface AcaoAgenda {
  professor: string
  acao: 'marcou' | 'desmarcou' | 'remarcou'
  eventoId: string
  cliente: string
  whatsapp: string
  detalhe: string
}

export interface AcaoAgendaSalva extends AcaoAgenda {
  id: number
  ts: number
}

export interface MatriculaSalva {
  id: number
  ts: number
  chat: string
  nome: string
  telefone: string
  email: string
  nascimento: string
  plano: string
  pagamento: string
  observacao: string
  /** Quando a recepção marcou "já lancei na plataforma" (vazio = ainda pendente). */
  lancadaEm: number | null
  lancadaPor: string
}

export type StatusComparecimento = 'veio' | 'faltou' | 'matriculou'

export interface Comparecimento {
  eventoId: string
  inicio: number
  cliente: string
  whatsapp: string
  status: StatusComparecimento
  ts: number
  por: string
}

export interface TransferenciaSemResposta {
  id: number
  chat: string
  ts: number
  motivo: string
  /** Nome do perfil do WhatsApp na hora da transferência (pode ser vazio). */
  nomePerfil: string
}

export interface Acompanhamento {
  id: number
  ts: number
  chat: string
  tipo: string
  ref: number
  resultado: string
  contexto: string
}

export interface EventoRegistrado {
  id: number
  ts: number
  tipo: string
  chat: string
  detalhe: string
}

export interface UsoIa {
  modelo: string
  entrada: number
  saida: number
  cacheLeitura: number
  cacheEscrita: number
}

export interface HandoffAtivo {
  chat: string
  ate: number
  motivo: string
  ts: number
}

/**
 * Guarda tudo o que precisa sobreviver a um reinício: histórico por cliente,
 * mensagens já processadas (a Meta reenvia webhooks) e conversas passadas para humanos.
 * O arquivo precisa ficar em disco persistente na hospedagem.
 */
export class Store {
  private db: DatabaseSync

  constructor(caminho: string) {
    if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true })
    this.db = new DatabaseSync(caminho)
    this.criarTabelas()
    this.migrar()
  }

  /** Bancos antigos (já na Render) ganham as colunas novas sem perder nada. */
  private migrar(): void {
    const colunas = (this.db.prepare('PRAGMA table_info(matriculas)').all() as unknown as Array<{ name: string }>).map((c) => c.name)
    if (!colunas.includes('lancada_em')) this.db.exec('ALTER TABLE matriculas ADD COLUMN lancada_em INTEGER')
    if (!colunas.includes('lancada_por')) this.db.exec("ALTER TABLE matriculas ADD COLUMN lancada_por TEXT NOT NULL DEFAULT ''")
    const colunasEventos = (this.db.prepare('PRAGMA table_info(eventos)').all() as unknown as Array<{ name: string }>).map((c) => c.name)
    if (!colunasEventos.includes('extra')) this.db.exec("ALTER TABLE eventos ADD COLUMN extra TEXT NOT NULL DEFAULT ''")
  }

  private criarTabelas(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS mensagens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat TEXT NOT NULL,
        papel TEXT NOT NULL CHECK (papel IN ('user','assistant')),
        conteudo TEXT NOT NULL,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mensagens_chat ON mensagens (chat, id);
      CREATE TABLE IF NOT EXISTS processadas (
        wamid TEXT PRIMARY KEY,
        ts INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS handoff (
        chat TEXT PRIMARY KEY,
        ate INTEGER NOT NULL,
        motivo TEXT NOT NULL,
        ts INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agendamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat TEXT NOT NULL,
        evento_id TEXT NOT NULL,
        inicio INTEGER NOT NULL,
        nome TEXT NOT NULL,
        status TEXT NOT NULL,
        criada INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agendamentos_chat ON agendamentos (chat, inicio);
      CREATE TABLE IF NOT EXISTS registro_agenda (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        professor TEXT NOT NULL,
        acao TEXT NOT NULL,
        evento_id TEXT NOT NULL,
        cliente TEXT NOT NULL,
        whatsapp TEXT NOT NULL,
        detalhe TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_registro_agenda_ts ON registro_agenda (ts);
      CREATE TABLE IF NOT EXISTS matriculas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        chat TEXT NOT NULL,
        nome TEXT NOT NULL,
        telefone TEXT NOT NULL,
        email TEXT NOT NULL,
        nascimento TEXT NOT NULL,
        plano TEXT NOT NULL,
        pagamento TEXT NOT NULL,
        observacao TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_matriculas_ts ON matriculas (ts);
      CREATE TABLE IF NOT EXISTS eventos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        tipo TEXT NOT NULL,
        chat TEXT NOT NULL,
        detalhe TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_eventos_tipo_ts ON eventos (tipo, ts);
      CREATE TABLE IF NOT EXISTS comparecimento (
        evento_id TEXT PRIMARY KEY,
        inicio INTEGER NOT NULL,
        cliente TEXT NOT NULL,
        whatsapp TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('veio','faltou','matriculou')),
        ts INTEGER NOT NULL,
        por TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_comparecimento_inicio ON comparecimento (inicio);
      CREATE TABLE IF NOT EXISTS lembretes (
        evento_id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        resultado TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS uso_ia (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        modelo TEXT NOT NULL,
        entrada INTEGER NOT NULL,
        saida INTEGER NOT NULL,
        cache_leitura INTEGER NOT NULL,
        cache_escrita INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_uso_ia_ts ON uso_ia (ts);
      CREATE TABLE IF NOT EXISTS acompanhamento (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        chat TEXT NOT NULL,
        tipo TEXT NOT NULL,
        ref INTEGER NOT NULL,
        resultado TEXT NOT NULL,
        contexto TEXT NOT NULL DEFAULT '',
        UNIQUE (chat, tipo, ref)
      );
      CREATE INDEX IF NOT EXISTS idx_acompanhamento_ts ON acompanhamento (ts);
      CREATE TABLE IF NOT EXISTS ajustes (
        chave TEXT PRIMARY KEY,
        valor TEXT NOT NULL
      );
    `)
  }

  // --- Matrículas feitas pela conversa (a equipe lança na plataforma) ---

  registrarMatricula(m: Omit<MatriculaSalva, 'id' | 'ts' | 'lancadaEm' | 'lancadaPor'>, ts = Date.now()): number {
    const r = this.db
      .prepare('INSERT INTO matriculas (ts, chat, nome, telefone, email, nascimento, plano, pagamento, observacao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ts, m.chat, m.nome, m.telefone, m.email, m.nascimento, m.plano, m.pagamento, m.observacao)
    return Number(r.lastInsertRowid)
  }

  /** As matrículas mais recentes, da mais nova para a mais antiga. */
  matriculas(limite = 100): MatriculaSalva[] {
    return this.db
      .prepare('SELECT id, ts, chat, nome, telefone, email, nascimento, plano, pagamento, observacao, lancada_em AS lancadaEm, lancada_por AS lancadaPor FROM matriculas ORDER BY id DESC LIMIT ?')
      .all(limite) as unknown as MatriculaSalva[]
  }

  /** A recepção lançou na plataforma da academia (ou desfez, com `lancada = false`). */
  marcarMatriculaLancada(id: number, lancada: boolean, por: string, ts = Date.now()): boolean {
    const r = lancada
      ? this.db.prepare('UPDATE matriculas SET lancada_em = ?, lancada_por = ? WHERE id = ?').run(ts, por, id)
      : this.db.prepare("UPDATE matriculas SET lancada_em = NULL, lancada_por = '' WHERE id = ?").run(id)
    return Number(r.changes) > 0
  }

  contarMatriculas(desde: number, ate = Number.MAX_SAFE_INTEGER): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM matriculas WHERE ts >= ? AND ts < ?').get(desde, ate) as unknown as { n: number }).n
  }

  // --- Registro de acontecimentos (para os números do painel) ---

  registrarEvento(tipo: string, chat: string, detalhe = '', ts = Date.now(), extra = ''): void {
    this.db.prepare('INSERT INTO eventos (ts, tipo, chat, detalhe, extra) VALUES (?, ?, ?, ?, ?)').run(ts, tipo, chat, detalhe.slice(0, 500), extra.slice(0, 200))
  }

  contarEventos(tipo: string, desde: number, ate = Number.MAX_SAFE_INTEGER): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM eventos WHERE tipo = ? AND ts >= ? AND ts < ?').get(tipo, desde, ate) as unknown as { n: number }).n
  }

  /** Quantas conversas diferentes tiveram esse tipo de evento no período. */
  contarChatsComEvento(tipo: string, desde: number, ate = Number.MAX_SAFE_INTEGER): number {
    return (this.db.prepare('SELECT COUNT(DISTINCT chat) AS n FROM eventos WHERE tipo = ? AND ts >= ? AND ts < ?').get(tipo, desde, ate) as unknown as { n: number }).n
  }

  eventosRecentes(tipo: string, limite = 50, desde = 0): EventoRegistrado[] {
    return this.db
      .prepare('SELECT id, ts, tipo, chat, detalhe FROM eventos WHERE tipo = ? AND ts >= ? ORDER BY id DESC LIMIT ?')
      .all(tipo, desde, limite) as unknown as EventoRegistrado[]
  }

  /** Conversas cuja PRIMEIRA mensagem do cliente caiu no período (só dá para olhar o que o histórico ainda guarda). */
  conversasNovas(desde: number, ate = Number.MAX_SAFE_INTEGER): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM (SELECT chat, MIN(ts) AS m FROM mensagens WHERE papel = 'user' GROUP BY chat) WHERE m >= ? AND m < ?")
        .get(desde, ate) as unknown as { n: number }
    ).n
  }

  /** O cliente já conversou com o bot? Aceita várias formas do número (com e sem o 9 extra). */
  temConversa(numeros: string[]): boolean {
    if (numeros.length === 0) return false
    const marcas = numeros.map(() => '?').join(',')
    return this.db.prepare(`SELECT 1 FROM mensagens WHERE chat IN (${marcas}) LIMIT 1`).get(...numeros) !== undefined
  }

  /** Qual destas formas do número já tem conversa com o bot (a mesma que o WhatsApp usa para ele). */
  chatComConversa(numeros: string[]): string | undefined {
    if (numeros.length === 0) return undefined
    const marcas = numeros.map(() => '?').join(',')
    const r = this.db.prepare(`SELECT chat FROM mensagens WHERE chat IN (${marcas}) ORDER BY ts DESC LIMIT 1`).get(...numeros) as unknown as { chat: string } | undefined
    return r?.chat
  }

  /** Quando foi a última mensagem do cliente (papel user) ou do bot (papel assistant). */
  ultimaMensagem(papel: Papel): number | undefined {
    const r = this.db.prepare('SELECT MAX(ts) AS m FROM mensagens WHERE papel = ?').get(papel) as unknown as { m: number | null }
    return r.m ?? undefined
  }

  /** Quando o cliente escreveu (para achar os horários de pico). */
  mensagensDosClientes(desde: number): number[] {
    return (this.db.prepare("SELECT ts FROM mensagens WHERE papel = 'user' AND ts >= ?").all(desde) as unknown as Array<{ ts: number }>).map((l) => l.ts)
  }

  /** Primeira mensagem do cliente depois de `depois`, ou undefined se ele não escreveu mais. */
  primeiraMensagemDepois(chat: string, depois: number): number | undefined {
    const r = this.db.prepare("SELECT MIN(ts) AS m FROM mensagens WHERE chat = ? AND papel = 'user' AND ts > ?").get(chat, depois) as unknown as { m: number | null }
    return r.m ?? undefined
  }

  /**
   * Clientes cuja última mensagem (entre `desde` e `antes`) ficou sem resposta do bot, fora das conversas
   * que estão com a equipe de propósito. Se isso aparece com o WhatsApp conectado, o bot pode estar mudo.
   */
  clientesSemResposta(desde: number, antes: number, agora = Date.now()): Array<{ chat: string; ts: number }> {
    return this.db
      .prepare(
        `SELECT chat, MAX(CASE WHEN papel = 'user' THEN ts END) AS ts, MAX(CASE WHEN papel = 'assistant' THEN ts END) AS resposta
         FROM mensagens GROUP BY chat
         HAVING ts >= ? AND ts <= ? AND (resposta IS NULL OR resposta < ts) AND chat NOT IN (SELECT chat FROM handoff WHERE ate > ?)`,
      )
      .all(desde, antes, agora) as unknown as Array<{ chat: string; ts: number }>
  }

  /** Conversas com o bot calado, com o motivo e quando a equipe (ou o bot) assumiu. */
  handoffsParaAcompanhar(agora = Date.now()): HandoffAtivo[] {
    return this.handoffsAtivos(agora)
  }

  // --- Acompanhamento de conversas paradas (avisos à equipe e lembretes ao cliente) ---

  /**
   * Transferências para a equipe que ninguém respondeu ainda: a última de cada conversa, feita depois de `desde`, sem
   * nenhuma resposta da equipe (evento "equipe_respondeu") ou devolução ao bot depois dela.
   */
  transferenciasSemResposta(desde: number): TransferenciaSemResposta[] {
    return this.db
      .prepare(
        `SELECT e.id AS id, e.chat AS chat, e.ts AS ts, e.detalhe AS motivo, e.extra AS nomePerfil FROM eventos e
         WHERE e.tipo = 'transferencia' AND e.ts >= ?
           AND e.id = (SELECT MAX(x.id) FROM eventos x WHERE x.tipo = 'transferencia' AND x.chat = e.chat)
           AND NOT EXISTS (SELECT 1 FROM eventos r WHERE r.tipo = 'equipe_respondeu' AND r.chat = e.chat AND r.ts >= e.ts)
         ORDER BY e.ts`,
      )
      .all(desde) as unknown as TransferenciaSemResposta[]
  }

  /** Aconteceu algum destes eventos nesta conversa depois de `desde`? (ex.: avaliação marcada ou matrícula feita) */
  teveEvento(chat: string, tipos: string[], desde: number): boolean {
    const marcas = tipos.map(() => '?').join(',')
    return this.db.prepare(`SELECT 1 FROM eventos WHERE chat = ? AND ts >= ? AND tipo IN (${marcas}) LIMIT 1`).get(chat, desde, ...tipos) !== undefined
  }

  /** A equipe falou com o cliente (ou devolveu a conversa ao bot) depois de `desde`? */
  equipeRespondeuDesde(chat: string, desde: number): boolean {
    return this.db.prepare("SELECT 1 FROM eventos WHERE tipo = 'equipe_respondeu' AND chat = ? AND ts >= ? LIMIT 1").get(chat, desde) !== undefined
  }

  /**
   * Conversas em que o bot falou por último: o cliente escreveu depois de `clienteDesde` e o bot respondeu por último
   * antes de `botAntes` (ou seja, o cliente ficou parado). Fora as que estão com a equipe.
   */
  conversasParadas(clienteDesde: number, botAntes: number, agora = Date.now()): Array<{ chat: string; cliente: number; bot: number }> {
    return this.db
      .prepare(
        `SELECT chat, MAX(CASE WHEN papel = 'user' THEN ts END) AS cliente, MAX(CASE WHEN papel = 'assistant' THEN ts END) AS bot
         FROM mensagens GROUP BY chat
         HAVING cliente >= ? AND bot > cliente AND bot <= ? AND chat NOT IN (SELECT chat FROM handoff WHERE ate > ?)
         ORDER BY cliente`,
      )
      .all(clienteDesde, botAntes, agora) as unknown as Array<{ chat: string; cliente: number; bot: number }>
  }

  /** Registra um aviso/lembrete. Devolve false se este (conversa, tipo, referência) já existia. */
  registrarAcompanhamento(chat: string, tipo: string, ref: number, resultado: string, ts = Date.now(), contexto = ''): boolean {
    const r = this.db.prepare('INSERT OR IGNORE INTO acompanhamento (ts, chat, tipo, ref, resultado, contexto) VALUES (?, ?, ?, ?, ?, ?)').run(ts, chat, tipo, ref, resultado.slice(0, 200), contexto.slice(0, 300))
    return Number(r.changes) > 0
  }

  atualizarAcompanhamento(chat: string, tipo: string, ref: number, resultado: string): void {
    this.db.prepare('UPDATE acompanhamento SET resultado = ? WHERE chat = ? AND tipo = ? AND ref = ?').run(resultado.slice(0, 200), chat, tipo, ref)
  }

  acompanhamentoFeito(chat: string, tipo: string, ref: number): Acompanhamento | undefined {
    return this.db.prepare('SELECT id, ts, chat, tipo, ref, resultado, contexto FROM acompanhamento WHERE chat = ? AND tipo = ? AND ref = ?').get(chat, tipo, ref) as unknown as Acompanhamento | undefined
  }

  /** Esta conversa já recebeu algum lembrete automático (de qualquer tipo)? É no máximo um por conversa. */
  jaRecebeuLembrete(chat: string): boolean {
    return this.db.prepare("SELECT 1 FROM acompanhamento WHERE chat = ? AND tipo LIKE 'lembrete_%' LIMIT 1").get(chat) !== undefined
  }

  acompanhamentos(desde: number, prefixo: string, limite = 50): Acompanhamento[] {
    return this.db
      .prepare('SELECT id, ts, chat, tipo, ref, resultado, contexto FROM acompanhamento WHERE ts >= ? AND tipo LIKE ? ORDER BY id DESC LIMIT ?')
      .all(desde, `${prefixo}%`, limite) as unknown as Acompanhamento[]
  }

  contarAcompanhamentos(desde: number, prefixo: string, resultado?: string): number {
    return resultado
      ? (this.db.prepare('SELECT COUNT(*) AS n FROM acompanhamento WHERE ts >= ? AND tipo LIKE ? AND resultado = ?').get(desde, `${prefixo}%`, resultado) as unknown as { n: number }).n
      : (this.db.prepare('SELECT COUNT(*) AS n FROM acompanhamento WHERE ts >= ? AND tipo LIKE ?').get(desde, `${prefixo}%`) as unknown as { n: number }).n
  }

  // --- Comparecimento às avaliações ---

  marcarComparecimento(c: Omit<Comparecimento, 'ts'>, ts = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO comparecimento (evento_id, inicio, cliente, whatsapp, status, ts, por) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(evento_id) DO UPDATE SET status = excluded.status, ts = excluded.ts, por = excluded.por`,
      )
      .run(c.eventoId, c.inicio, c.cliente, c.whatsapp, c.status, ts, c.por)
  }

  desfazerComparecimento(eventoId: string): boolean {
    return Number(this.db.prepare('DELETE FROM comparecimento WHERE evento_id = ?').run(eventoId).changes) > 0
  }

  comparecimentoDe(eventoIds: string[]): Map<string, Comparecimento> {
    const mapa = new Map<string, Comparecimento>()
    if (eventoIds.length === 0) return mapa
    const marcas = eventoIds.map(() => '?').join(',')
    const linhas = this.db
      .prepare(`SELECT evento_id AS eventoId, inicio, cliente, whatsapp, status, ts, por FROM comparecimento WHERE evento_id IN (${marcas})`)
      .all(...eventoIds) as unknown as Comparecimento[]
    for (const l of linhas) mapa.set(l.eventoId, l)
    return mapa
  }

  comparecimentos(desde: number, ate = Number.MAX_SAFE_INTEGER): Comparecimento[] {
    return this.db
      .prepare('SELECT evento_id AS eventoId, inicio, cliente, whatsapp, status, ts, por FROM comparecimento WHERE inicio >= ? AND inicio < ? ORDER BY inicio')
      .all(desde, ate) as unknown as Comparecimento[]
  }

  // --- Lembretes enviados aos clientes ---

  lembreteRegistrado(eventoId: string): boolean {
    return this.db.prepare('SELECT 1 FROM lembretes WHERE evento_id = ?').get(eventoId) !== undefined
  }

  registrarLembrete(eventoId: string, resultado: string, ts = Date.now()): void {
    this.db.prepare('INSERT OR IGNORE INTO lembretes (evento_id, ts, resultado) VALUES (?, ?, ?)').run(eventoId, ts, resultado.slice(0, 200))
  }

  atualizarLembrete(eventoId: string, resultado: string): void {
    this.db.prepare('UPDATE lembretes SET resultado = ? WHERE evento_id = ?').run(resultado.slice(0, 200), eventoId)
  }

  contarLembretes(desde: number, prefixo?: string): number {
    return prefixo
      ? (this.db.prepare('SELECT COUNT(*) AS n FROM lembretes WHERE ts >= ? AND resultado LIKE ?').get(desde, `${prefixo}%`) as unknown as { n: number }).n
      : (this.db.prepare('SELECT COUNT(*) AS n FROM lembretes WHERE ts >= ?').get(desde) as unknown as { n: number }).n
  }

  // --- Uso da inteligência artificial (para estimar o gasto) ---

  registrarUsoIa(u: UsoIa, ts = Date.now()): void {
    this.db
      .prepare('INSERT INTO uso_ia (ts, modelo, entrada, saida, cache_leitura, cache_escrita) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ts, u.modelo, u.entrada, u.saida, u.cacheLeitura, u.cacheEscrita)
  }

  somaUsoIa(desde: number, ate = Number.MAX_SAFE_INTEGER): UsoIa & { chamadas: number } {
    const r = this.db
      .prepare(
        'SELECT COUNT(*) AS chamadas, COALESCE(SUM(entrada),0) AS entrada, COALESCE(SUM(saida),0) AS saida, COALESCE(SUM(cache_leitura),0) AS cacheLeitura, COALESCE(SUM(cache_escrita),0) AS cacheEscrita FROM uso_ia WHERE ts >= ? AND ts < ?',
      )
      .get(desde, ate) as unknown as { chamadas: number; entrada: number; saida: number; cacheLeitura: number; cacheEscrita: number }
    return { modelo: '', ...r }
  }

  // --- Ajustes guardados no banco (sobrevivem a deploys) ---

  lerAjuste(chave: string): string | undefined {
    const r = this.db.prepare('SELECT valor FROM ajustes WHERE chave = ?').get(chave) as unknown as { valor: string } | undefined
    return r?.valor
  }

  definirAjuste(chave: string, valor: string): void {
    this.db.prepare('INSERT INTO ajustes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(chave, valor)
  }

  /** Devolve true se existia algo para apagar. */
  apagarAjuste(chave: string): boolean {
    return Number(this.db.prepare('DELETE FROM ajustes WHERE chave = ?').run(chave).changes) > 0
  }

  // --- Pausa geral do assistente (botão no painel). Fica no banco para sobreviver a reinícios e deploys. ---

  /** Pausa o assistente. `ate`: instante em que volta sozinho; `null` = só volta quando alguém reativar. */
  pausar(ate: number | null): void {
    this.db
      .prepare("INSERT INTO ajustes (chave, valor) VALUES ('pausa', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor")
      .run(ate === null ? 'sempre' : String(ate))
  }

  /** Reativa o assistente. Retorna true se ele estava pausado. */
  retomar(): boolean {
    return Number(this.db.prepare("DELETE FROM ajustes WHERE chave = 'pausa'").run().changes) > 0
  }

  /** A pausa em vigor, ou undefined se o assistente está ativo (inclusive quando a pausa já venceu). */
  pausa(agora = Date.now()): { ate: number | null } | undefined {
    const r = this.db.prepare("SELECT valor FROM ajustes WHERE chave = 'pausa'").get() as unknown as { valor: string } | undefined
    if (!r) return undefined
    if (r.valor === 'sempre') return { ate: null }
    const ate = Number(r.valor)
    return Number.isFinite(ate) && ate > agora ? { ate } : undefined
  }

  // --- Avaliações agendadas pelo bot no Google Agenda ---

  registrarAgendamento(a: { chat: string; eventoId: string; inicio: number; nome: string }, agora = Date.now()): number {
    const r = this.db
      .prepare("INSERT INTO agendamentos (chat, evento_id, inicio, nome, status, criada) VALUES (?, ?, ?, ?, 'agendada', ?)")
      .run(a.chat, a.eventoId, a.inicio, a.nome, agora)
    return Number(r.lastInsertRowid)
  }

  /** Avaliação futura que o bot agendou para este cliente e que ainda não foi cancelada. */
  agendamentoAtivo(chat: string, agora = Date.now()): { id: number; eventoId: string; inicio: number } | undefined {
    const l = this.db
      .prepare("SELECT id, evento_id, inicio FROM agendamentos WHERE chat = ? AND status = 'agendada' AND inicio > ? ORDER BY inicio LIMIT 1")
      .get(chat, agora) as unknown as { id: number; evento_id: string; inicio: number } | undefined
    return l ? { id: l.id, eventoId: l.evento_id, inicio: l.inicio } : undefined
  }

  cancelarAgendamento(id: number): void {
    this.db.prepare("UPDATE agendamentos SET status = 'cancelada' WHERE id = ?").run(id)
  }

  /** O painel dos professores desmarcou: o cliente volta a poder marcar outra avaliação pelo bot. */
  cancelarAgendamentoDoEvento(eventoId: string): void {
    this.db.prepare("UPDATE agendamentos SET status = 'cancelada' WHERE evento_id = ? AND status = 'agendada'").run(eventoId)
  }

  /** O painel remarcou: o bot passa a falar o novo horário se o cliente perguntar. */
  atualizarInicioDoAgendamento(eventoId: string, inicio: number): void {
    this.db.prepare("UPDATE agendamentos SET inicio = ? WHERE evento_id = ? AND status = 'agendada'").run(inicio, eventoId)
  }

  registrarAcaoAgenda(a: AcaoAgenda, ts = Date.now()): void {
    this.db
      .prepare('INSERT INTO registro_agenda (ts, professor, acao, evento_id, cliente, whatsapp, detalhe) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(ts, a.professor, a.acao, a.eventoId, a.cliente, a.whatsapp, a.detalhe)
  }

  /** As ações mais recentes dos professores, da mais nova para a mais antiga. */
  acoesAgenda(limite = 200): AcaoAgendaSalva[] {
    const linhas = this.db
      .prepare('SELECT id, ts, professor, acao, evento_id, cliente, whatsapp, detalhe FROM registro_agenda ORDER BY id DESC LIMIT ?')
      .all(limite) as unknown as Array<Omit<AcaoAgendaSalva, 'eventoId'> & { evento_id: string }>
    return linhas.map(({ evento_id, ...resto }) => ({ ...resto, eventoId: evento_id }))
  }

  adicionarMensagem(chat: string, papel: Papel, conteudo: string, ts = Date.now()): void {
    this.db
      .prepare('INSERT INTO mensagens (chat, papel, conteudo, ts) VALUES (?, ?, ?, ?)')
      .run(chat, papel, conteudo, ts)
  }

  /** Últimas `limite` mensagens do cliente, da mais antiga para a mais nova. */
  historico(chat: string, limite: number): MensagemSalva[] {
    const linhas = this.db
      .prepare('SELECT papel, conteudo, ts FROM mensagens WHERE chat = ? ORDER BY id DESC LIMIT ?')
      .all(chat, limite) as unknown as MensagemSalva[]
    return linhas.reverse()
  }

  contarMensagensDoCliente(chat: string, desde: number): number {
    const r = this.db
      .prepare("SELECT COUNT(*) AS n FROM mensagens WHERE chat = ? AND papel = 'user' AND ts > ?")
      .get(chat, desde) as unknown as { n: number }
    return r.n
  }

  apagarConversa(chat: string): void {
    this.db.prepare('DELETE FROM mensagens WHERE chat = ?').run(chat)
  }

  /** Retorna true na primeira vez que vê o wamid e false se já foi processado. */
  marcarProcessada(wamid: string, ts = Date.now()): boolean {
    const r = this.db.prepare('INSERT OR IGNORE INTO processadas (wamid, ts) VALUES (?, ?)').run(wamid, ts)
    return Number(r.changes) > 0
  }

  definirHandoff(chat: string, horas: number, motivo: string, agora = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO handoff (chat, ate, motivo, ts) VALUES (?, ?, ?, ?)
         ON CONFLICT(chat) DO UPDATE SET ate = excluded.ate, motivo = excluded.motivo, ts = excluded.ts`,
      )
      .run(chat, agora + horas * 3_600_000, motivo, agora)
  }

  emHandoff(chat: string, agora = Date.now()): boolean {
    const r = this.db.prepare('SELECT ate FROM handoff WHERE chat = ?').get(chat) as unknown as
      | { ate: number }
      | undefined
    return r !== undefined && r.ate > agora
  }

  liberarHandoff(chat: string): boolean {
    const r = this.db.prepare('DELETE FROM handoff WHERE chat = ?').run(chat)
    return Number(r.changes) > 0
  }

  handoffsAtivos(agora = Date.now()): HandoffAtivo[] {
    return this.db
      .prepare('SELECT chat, ate, motivo, ts FROM handoff WHERE ate > ? ORDER BY ts DESC')
      .all(agora) as unknown as HandoffAtivo[]
  }

  /** Apaga conversas antigas (LGPD) e limpa registros técnicos que não servem mais. */
  limpar(retencaoDias: number, agora = Date.now()): void {
    const corte = agora - retencaoDias * 86_400_000
    this.db.prepare('DELETE FROM mensagens WHERE ts < ?').run(corte)
    this.db.prepare('DELETE FROM processadas WHERE ts < ?').run(agora - 7 * 86_400_000)
    this.db.prepare('DELETE FROM handoff WHERE ate < ?').run(agora)
    this.db.prepare('DELETE FROM agendamentos WHERE inicio < ?').run(corte)
    this.db.prepare('DELETE FROM registro_agenda WHERE ts < ?').run(corte)
    this.db.prepare('DELETE FROM matriculas WHERE ts < ?').run(corte)
    // Números de gestão guardam menos dados pessoais e valem a pena por mais tempo (13 meses).
    const longo = agora - 400 * 86_400_000
    this.db.prepare('DELETE FROM eventos WHERE ts < ?').run(longo)
    this.db.prepare('DELETE FROM uso_ia WHERE ts < ?').run(longo)
    this.db.prepare('DELETE FROM comparecimento WHERE inicio < ?').run(longo)
    this.db.prepare('DELETE FROM lembretes WHERE ts < ?').run(longo)
    this.db.prepare('DELETE FROM acompanhamento WHERE ts < ?').run(longo)
  }

  fechar(): void {
    this.db.close()
  }
}
