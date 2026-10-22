import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { Store } from '../src/store.js'

const DIA = 86_400_000
const T0 = Date.UTC(2026, 9, 22, 12, 0, 0)

const matricula = (chat = '5511900000001') => ({
  chat, nome: 'Ana Souza', telefone: chat, email: '', nascimento: '', plano: 'Básico 3x', pagamento: 'pix' as const, observacao: '',
})

describe('base do painel: matrículas lançadas', () => {
  it('marca e desfaz "já lancei na plataforma", guardando quem e quando', () => {
    const s = new Store(':memory:')
    const id = s.registrarMatricula(matricula(), T0)
    assert.equal(s.matriculas()[0]!.lancadaEm, null)
    assert.equal(s.matriculas()[0]!.lancadaPor, '')

    assert.equal(s.marcarMatriculaLancada(id, true, 'Recepção', T0 + 1000), true)
    assert.equal(s.matriculas()[0]!.lancadaEm, T0 + 1000)
    assert.equal(s.matriculas()[0]!.lancadaPor, 'Recepção')

    assert.equal(s.marcarMatriculaLancada(id, false, ''), true)
    assert.equal(s.matriculas()[0]!.lancadaEm, null)
    assert.equal(s.marcarMatriculaLancada(9999, true, 'x'), false)
  })

  it('conta matrículas por período (fim exclusivo)', () => {
    const s = new Store(':memory:')
    s.registrarMatricula(matricula('5511900000001'), T0)
    s.registrarMatricula(matricula('5511900000002'), T0 + DIA)
    assert.equal(s.contarMatriculas(T0, T0 + DIA), 1)
    assert.equal(s.contarMatriculas(T0, T0 + 2 * DIA), 2)
    assert.equal(s.contarMatriculas(T0 + 1), 1)
  })
})

describe('base do painel: eventos e conversas', () => {
  it('conta eventos por tipo e período, e conversas diferentes', () => {
    const s = new Store(':memory:')
    s.registrarEvento('transferencia', 'a', 'pediu humano', T0)
    s.registrarEvento('transferencia', 'a', 'de novo', T0 + 10)
    s.registrarEvento('transferencia', 'b', '', T0 + 20)
    s.registrarEvento('sem_resposta', 'a', 'tem sauna?', T0 + 30)
    assert.equal(s.contarEventos('transferencia', T0), 3)
    assert.equal(s.contarEventos('transferencia', T0, T0 + 20), 2)
    assert.equal(s.contarChatsComEvento('transferencia', T0), 2)
    assert.equal(s.contarEventos('inexistente', 0), 0)
    const r = s.eventosRecentes('transferencia', 2)
    assert.deepEqual(r.map((e) => e.detalhe), ['', 'de novo'])
    assert.equal(s.eventosRecentes('sem_resposta', 5, T0 + 31).length, 0)
  })

  it('limita o tamanho do detalhe guardado', () => {
    const s = new Store(':memory:')
    s.registrarEvento('sem_resposta', 'a', 'x'.repeat(2000), T0)
    assert.equal(s.eventosRecentes('sem_resposta')[0]!.detalhe.length, 500)
  })

  it('conversas novas: só a PRIMEIRA mensagem do cliente conta', () => {
    const s = new Store(':memory:')
    s.adicionarMensagem('a', 'user', 'oi', T0)
    s.adicionarMensagem('a', 'assistant', 'olá', T0 + 1)
    s.adicionarMensagem('a', 'user', 'preço?', T0 + DIA)
    s.adicionarMensagem('b', 'user', 'oi', T0 + DIA)
    s.adicionarMensagem('c', 'assistant', 'só o bot falou', T0 + DIA)
    assert.equal(s.conversasNovas(T0, T0 + DIA), 1)
    assert.equal(s.conversasNovas(T0 + DIA, T0 + 2 * DIA), 1)
    assert.equal(s.conversasNovas(T0), 2)
  })

  it('temConversa aceita várias formas do número', () => {
    const s = new Store(':memory:')
    s.adicionarMensagem('5511988887777', 'user', 'oi', T0)
    assert.equal(s.temConversa(['551188887777', '5511988887777']), true)
    assert.equal(s.temConversa(['5511911112222']), false)
    assert.equal(s.temConversa([]), false)
  })

  it('última mensagem de cada lado, mensagens dos clientes e primeira depois de um instante', () => {
    const s = new Store(':memory:')
    assert.equal(s.ultimaMensagem('user'), undefined)
    s.adicionarMensagem('a', 'user', 'oi', T0)
    s.adicionarMensagem('a', 'assistant', 'olá', T0 + 5)
    s.adicionarMensagem('a', 'user', 'e aí', T0 + 100)
    assert.equal(s.ultimaMensagem('user'), T0 + 100)
    assert.equal(s.ultimaMensagem('assistant'), T0 + 5)
    assert.deepEqual(s.mensagensDosClientes(T0 + 1), [T0 + 100])
    assert.equal(s.primeiraMensagemDepois('a', T0), T0 + 100)
    assert.equal(s.primeiraMensagemDepois('a', T0 + 100), undefined)
    assert.equal(s.primeiraMensagemDepois('b', 0), undefined)
  })
})

describe('base do painel: comparecimento', () => {
  const base = { eventoId: 'ev1', inicio: T0, cliente: 'Ana', whatsapp: '5511900000001', por: 'Prof. João' }

  it('marcar de novo troca o status em vez de duplicar', () => {
    const s = new Store(':memory:')
    s.marcarComparecimento({ ...base, status: 'faltou' }, T0)
    s.marcarComparecimento({ ...base, status: 'matriculou', por: 'Prof. Rafa' }, T0 + 5)
    const m = s.comparecimentoDe(['ev1', 'outro'])
    assert.equal(m.size, 1)
    assert.equal(m.get('ev1')!.status, 'matriculou')
    assert.equal(m.get('ev1')!.por, 'Prof. Rafa')
    assert.equal(s.comparecimentos(0).length, 1)
  })

  it('desfazer apaga; desfazer de novo diz que não havia nada', () => {
    const s = new Store(':memory:')
    s.marcarComparecimento({ ...base, status: 'veio' })
    assert.equal(s.desfazerComparecimento('ev1'), true)
    assert.equal(s.desfazerComparecimento('ev1'), false)
    assert.equal(s.comparecimentoDe(['ev1']).size, 0)
  })

  it('só aceita os três status', () => {
    const s = new Store(':memory:')
    assert.throws(() => s.marcarComparecimento({ ...base, status: 'talvez' as never }))
  })

  it('lista por data da avaliação, em ordem', () => {
    const s = new Store(':memory:')
    s.marcarComparecimento({ ...base, eventoId: 'b', inicio: T0 + DIA, status: 'veio' })
    s.marcarComparecimento({ ...base, eventoId: 'a', inicio: T0, status: 'faltou' })
    assert.deepEqual(s.comparecimentos(0).map((c) => c.eventoId), ['a', 'b'])
    assert.deepEqual(s.comparecimentos(T0 + 1).map((c) => c.eventoId), ['b'])
    assert.deepEqual(s.comparecimentos(0, T0 + 1).map((c) => c.eventoId), ['a'])
  })
})

describe('base do painel: lembretes e uso da IA', () => {
  it('um lembrete por avaliação: o segundo registro não sobrescreve', () => {
    const s = new Store(':memory:')
    assert.equal(s.lembreteRegistrado('ev1'), false)
    s.registrarLembrete('ev1', 'enviado', T0)
    s.registrarLembrete('ev1', 'falhou: x', T0 + 5)
    assert.equal(s.lembreteRegistrado('ev1'), true)
    assert.equal(s.contarLembretes(0), 1)
    assert.equal(s.contarLembretes(0, 'enviado'), 1)
    assert.equal(s.contarLembretes(0, 'falhou'), 0)
  })

  it('soma o uso da IA no período', () => {
    const s = new Store(':memory:')
    s.registrarUsoIa({ modelo: 'm', entrada: 100, saida: 10, cacheLeitura: 1000, cacheEscrita: 50 }, T0)
    s.registrarUsoIa({ modelo: 'm', entrada: 200, saida: 20, cacheLeitura: 2000, cacheEscrita: 0 }, T0 + DIA)
    assert.deepEqual(s.somaUsoIa(T0, T0 + DIA), { modelo: '', chamadas: 1, entrada: 100, saida: 10, cacheLeitura: 1000, cacheEscrita: 50 })
    assert.equal(s.somaUsoIa(0).chamadas, 2)
    assert.equal(s.somaUsoIa(0).entrada, 300)
    assert.equal(s.somaUsoIa(T0 + 10 * DIA).chamadas, 0)
    assert.equal(s.somaUsoIa(T0 + 10 * DIA).saida, 0)
  })
})

describe('base do painel: guarda de números e migração', () => {
  it('números de gestão ficam 400 dias, conversas só o prazo de retenção', () => {
    const s = new Store(':memory:')
    s.registrarEvento('x', 'a', '', T0 - 100 * DIA)
    s.registrarEvento('x', 'a', '', T0 - 401 * DIA)
    s.registrarUsoIa({ modelo: 'm', entrada: 1, saida: 1, cacheLeitura: 0, cacheEscrita: 0 }, T0 - 401 * DIA)
    s.registrarLembrete('velho', 'enviado', T0 - 401 * DIA)
    s.marcarComparecimento({ eventoId: 'velho', inicio: T0 - 401 * DIA, cliente: '', whatsapp: '', status: 'veio', por: 'p' })
    s.marcarComparecimento({ eventoId: 'novo', inicio: T0 - 100 * DIA, cliente: '', whatsapp: '', status: 'veio', por: 'p' })
    s.adicionarMensagem('a', 'user', 'oi', T0 - 100 * DIA)
    s.limpar(30, T0)
    assert.equal(s.contarEventos('x', 0), 1)
    assert.equal(s.somaUsoIa(0).chamadas, 0)
    assert.equal(s.lembreteRegistrado('velho'), false)
    assert.deepEqual(s.comparecimentos(0).map((c) => c.eventoId), ['novo'])
    assert.equal(s.historico('a', 10).length, 0)
  })

  it('banco antigo (sem as colunas novas) é atualizado sem perder matrículas', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'gf-'))
    const arquivo = join(pasta, 'velho.db')
    try {
      const velho = new DatabaseSync(arquivo)
      velho.exec(`CREATE TABLE matriculas (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, chat TEXT NOT NULL, nome TEXT NOT NULL, telefone TEXT NOT NULL, email TEXT NOT NULL, nascimento TEXT NOT NULL, plano TEXT NOT NULL, pagamento TEXT NOT NULL, observacao TEXT NOT NULL)`)
      velho.prepare("INSERT INTO matriculas (ts, chat, nome, telefone, email, nascimento, plano, pagamento, observacao) VALUES (?, 'c', 'Bia Lima', '5511911112222', '', '', 'VIP', 'pix', '')").run(T0)
      velho.close()

      const s = new Store(arquivo)
      const [m] = s.matriculas()
      assert.equal(m!.nome, 'Bia Lima')
      assert.equal(m!.lancadaEm, null)
      assert.equal(m!.lancadaPor, '')
      assert.equal(s.marcarMatriculaLancada(m!.id, true, 'Recepção'), true)
      s.fechar()

      // abrir de novo (já migrado) não quebra nem apaga nada
      const s2 = new Store(arquivo)
      assert.equal(s2.matriculas()[0]!.lancadaPor, 'Recepção')
      s2.fechar()
    } finally {
      rmSync(pasta, { recursive: true, force: true })
    }
  })
})
