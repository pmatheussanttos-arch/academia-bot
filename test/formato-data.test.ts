import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { epochLocal } from '../src/agenda.js'
import { formatadoresGuardados, formatoData } from '../src/formato-data.js'
import { Metricas } from '../src/metricas.js'
import { AGORA, GoogleFalso, criarConfigDeTeste, criarServico } from './helpers.js'

describe('formatadores de data reaproveitados (memória)', () => {
  it('a mesma combinação devolve o mesmo formatador', () => {
    const a = formatoData('en-CA', { timeZone: 'America/Sao_Paulo' })
    assert.equal(formatoData('en-CA', { timeZone: 'America/Sao_Paulo' }), a)
    assert.notEqual(formatoData('pt-BR', { timeZone: 'America/Sao_Paulo' }), a)
    assert.equal(a.format(new Date('2026-11-19T12:00:00Z')), '2026-11-19')
  })

  it('nenhum arquivo do bot cria formatador novo a cada data', () => {
    for (const nome of readdirSync(new URL('../src/', import.meta.url))) {
      if (nome === 'formato-data.ts') continue
      const s = readFileSync(new URL(`../src/${nome}`, import.meta.url), 'utf8')
      assert.doesNotMatch(s, /new Intl\.DateTimeFormat\(/, nome)
    }
  })

  it('recarregar o painel muitas vezes, com a agenda cheia, não cria formatadores novos', async () => {
    const google = new GoogleFalso()
    for (let d = 1; d <= 28; d++) {
      for (const hh of ['07:00', '08:00', '09:00', '14:00', '15:00', '16:00', '17:00', '18:00']) {
        const inicio = epochLocal(`2026-10-${String(d).padStart(2, '0')}`, hh, 'America/Sao_Paulo')
        google.eventos.push({ id: `e${d}-${hh}`, titulo: `Avaliação — Cliente ${d}`, ocupa: true, inicio, fim: inicio + 1_800_000 })
      }
    }
    const { servico, store } = criarServico({ google })
    const metricas = new Metricas({ store, cfg: criarConfigDeTeste(), servico, estado: () => ({ status: 'conectado', desde: AGORA.getTime() }), cacheMs: 0 })
    await metricas.resumo()
    const depoisDoPrimeiro = formatadoresGuardados()
    for (let i = 0; i < 30; i++) await metricas.resumo()
    assert.equal(formatadoresGuardados(), depoisDoPrimeiro)
    assert.ok(depoisDoPrimeiro < 30, `${depoisDoPrimeiro} formatadores`)
  })
})
