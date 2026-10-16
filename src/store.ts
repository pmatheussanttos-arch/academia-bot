import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type Papel = 'user' | 'assistant'

export interface MensagemSalva {
  papel: Papel
  conteudo: string
  ts: number
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
    `)
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
  }

  fechar(): void {
    this.db.close()
  }
}
