import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { FERRAMENTAS, registroDeFerramenta } from '../src/agent.js'
import { GoogleFalso, SEGUNDA, criarServico } from './helpers.js'

const CHAT = '553288465841' // sem o 9, como o WhatsApp às vezes guarda
const pedido = (hhmm: string, extra = {}) => ({ chat: CHAT, nomeContato: '', nomeCliente: 'Andressa Oliveira de Paula', tipo: 'avaliacao_fisica' as const, dataISO: SEGUNDA, hhmm, obs: '', jaEAluno: false, planoVip: false, ...extra })

describe('cliente que já deu nome, dia e horário: o bot fecha, não transfere', () => {
  it('pedir de novo o MESMO horário confirma outra vez, sem criar evento repetido', async () => {
    const google = new GoogleFalso()
    const { servico } = criarServico({ google })
    const a = await servico.solicitar(pedido('14:00'))
    assert.equal(a.ok && a.agendada, true)
    const b = await servico.solicitar(pedido('14:00'))
    assert.equal(b.ok && b.agendada, true, 'em vez de "já tem avaliação, chame a equipe"')
    assert.equal(google.criados.length, 1, 'um evento só')
  })

  it('pedir OUTRO horário continua mandando para a equipe (o bot não remarca sozinho)', async () => {
    const google = new GoogleFalso()
    const { servico } = criarServico({ google })
    await servico.solicitar(pedido('14:00'))
    const c = await servico.solicitar(pedido('15:00'))
    assert.equal(c.ok, false)
    assert.match(!c.ok ? c.motivo : '', /já tem uma avaliação agendada/)
    assert.equal(google.criados.length, 1)
  })

  it('horário ocupado devolve os livres (e nunca uma ordem de transferir)', async () => {
    const google = new GoogleFalso()
    google.ocupar(SEGUNDA, '14:00')
    const { servico } = criarServico({ google })
    const r = await servico.solicitar(pedido('14:00'))
    assert.equal(r.ok, false)
    const motivo = !r.ok ? r.motivo : ''
    assert.match(motivo, /já está ocupado/)
    assert.match(motivo, /Horários livres: /)
    assert.doesNotMatch(motivo, /chamar_humano|equipe/i)
  })

  it('as instruções e a ferramenta mandam ir direto ao agendamento quando já há nome, dia e horário', () => {
    const i = readFileSync('./instrucoes.md', 'utf8')
    assert.match(i, /Se a pessoa já disse o nome, o dia e o horário[^.]*vá direto para este passo: não transfira para a equipe/)
    assert.match(i, /Nunca transfira para a equipe por causa disso/)
    const d = FERRAMENTAS.find((f) => f.name === 'solicitar_avaliacao')!.description!
    assert.match(d, /JÁ disse nome, dia e horário, chame esta ferramenta direto, sem transferir/)
    assert.doesNotMatch(d, /vindo de consultar_horarios/)
  })

  it('o log mostra o MOTIVO de cada transferência (para descobrir o porquê depois)', () => {
    const linha = registroDeFerramenta(
      { type: 'tool_use', id: 't', name: 'chamar_humano', input: { motivo: 'cliente quer mudar o horário' } } as never,
      { type: 'tool_result', tool_use_id: 't', content: 'Equipe avisada.' },
    )
    assert.match(linha, /chamar_humano\(\) motivo="cliente quer mudar o horário" -> Equipe avisada/)
  })
})
