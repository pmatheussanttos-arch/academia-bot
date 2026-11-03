import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { criarApp, type AppDeps } from '../src/app.js'
import { FilaPorChave } from '../src/fila.js'
import type { ClienteWhatsapp } from '../src/whatsapp.js'
import { criarConfigDeTeste, criarDepsDeAgente } from './helpers.js'

/**
 * A imagem Docker só leva os arquivos listados no COPY. Um arquivo que o bot lê mas que ficou fora da lista some em produção
 * sem dar erro (foi assim que a campanha Black não apareceu para um cliente real).
 */
describe('imagem Docker (Render) leva todos os arquivos que o bot lê', () => {
  const docker = readFileSync('./Dockerfile', 'utf8')
  const copiados = new Set(
    docker
      .split('\n')
      .filter((l) => l.startsWith('COPY ') && !l.includes('package'))
      .flatMap((l) => l.replace(/^COPY\s+/, '').trim().split(/\s+/).slice(0, -1)),
  )

  it('os arquivos padrão da configuração estão no COPY e existem no repositório', () => {
    const cfg = criarConfigDeTeste()
    const padroes = ['instrucoesPath', 'agendaPath', 'mensagensPath', 'campanhaPath'] as const
    // criarConfigDeTeste troca o caminho das instruções por um arquivo temporário: os outros são os padrões de produção
    for (const chave of ['agendaPath', 'mensagensPath', 'campanhaPath'] as const) {
      const arquivo = cfg[chave].replace(/^\.\//, '')
      assert.ok(existsSync(`./${arquivo}`), `${arquivo} não existe no repositório`)
      assert.ok(copiados.has(arquivo), `${arquivo} NÃO está no COPY do Dockerfile: não existiria em produção`)
    }
    assert.ok(copiados.has('instrucoes.md'), 'instrucoes.md fora do COPY do Dockerfile')
    assert.equal(padroes.length, 4)
  })

  it('a pasta src inteira vai junto', () => {
    assert.ok(copiados.has('src'))
  })
})

describe('/health mostra se a campanha chegou ao servidor', () => {
  function app(quando: string) {
    const base = criarDepsDeAgente([], { ADMIN_TOKEN: 'segredo-admin' })
    base.deps.agora = () => new Date(quando)
    const wa: ClienteWhatsapp = { async enviarTexto() {}, async marcarLida() {} }
    const deps: AppDeps = { ...base.deps, wa, avisarErro: async () => {}, fila: new FilaPorChave(), iniciadoEm: Date.now() }
    return criarApp(deps)
  }
  const campanha = async (a: ReturnType<typeof app>) => ((await (await a.request('/health')).json()) as { campanha: string }).campanha

  it('fase de hoje, ou "nenhuma" fora das datas', async () => {
    assert.equal(await campanha(app('2026-11-10T15:00:00Z')), 'ativa')
    assert.equal(await campanha(app('2026-11-25T15:00:00Z')), 'semana_final')
    assert.equal(await campanha(app('2026-11-30T15:00:00Z')), 'ultimo_dia')
    assert.equal(await campanha(app('2026-12-05T15:00:00Z')), 'encerrada')
    assert.equal(await campanha(app('2026-10-20T15:00:00Z')), 'nenhuma')
  })

  it('sem o arquivo de campanha, aparece "nenhuma" (assim dá para ver o problema pelo /health)', async () => {
    const base = criarDepsDeAgente([], { ADMIN_TOKEN: 'segredo-admin', CAMPANHA_PATH: './nao-existe.md' })
    base.deps.agora = () => new Date('2026-11-10T15:00:00Z')
    const wa: ClienteWhatsapp = { async enviarTexto() {}, async marcarLida() {} }
    const a = criarApp({ ...base.deps, wa, avisarErro: async () => {}, fila: new FilaPorChave(), iniciadoEm: Date.now() })
    assert.equal(await campanha(a), 'nenhuma')
  })
})
