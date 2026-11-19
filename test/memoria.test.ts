import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { MonitorMemoria, lerMemoria } from '../src/memoria.js'

const MB = 1024 * 1024
const uso = (rss: number, heap = 50): NodeJS.MemoryUsage => ({ rss: rss * MB, heapUsed: heap * MB, heapTotal: 0, external: 0, arrayBuffers: 0 })

describe('memória do bot', () => {
  it('lê o uso em MB', () => {
    assert.deepEqual(lerMemoria(uso(250, 120), 300 * 1024), { rssMB: 250, heapMB: 120, picoMB: 300 })
    const real = lerMemoria()
    assert.ok(real.rssMB > 0 && real.picoMB >= real.rssMB - 1)
  })

  it('registra no log só quando muda bastante, e sempre quando está alta', () => {
    const m = new MonitorMemoria(400, 40)
    assert.match(m.verificar(lerMemoria(uso(200), 200 * 1024))!, /uso 200 MB/)
    assert.equal(m.verificar(lerMemoria(uso(220), 220 * 1024)), undefined)
    assert.match(m.verificar(lerMemoria(uso(260), 260 * 1024))!, /uso 260 MB/)
    assert.match(m.verificar(lerMemoria(uso(410), 410 * 1024))!, /⚠️ ALTA uso 410 MB/)
    assert.match(m.verificar(lerMemoria(uso(412), 412 * 1024))!, /ALTA/)
  })

  it('o Dockerfile limita a memória dos objetos abaixo dos 512 MB da Render', () => {
    const d = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8')
    const limite = Number(/ENV NODE_OPTIONS=--max-old-space-size=(\d+)/.exec(d)?.[1])
    assert.ok(limite >= 256 && limite <= 384, `limite ${limite}`)
  })
})
