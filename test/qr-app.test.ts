import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { criarApp, type AppDeps } from '../src/app.js'
import type { EstadoWhatsapp } from '../src/baileys.js'
import { FilaPorChave } from '../src/fila.js'
import type { ClienteWhatsapp } from '../src/whatsapp.js'
import { carregarConfig } from '../src/config.js'
import { criarDepsDeAgente } from './helpers.js'

function appQr(estado: EstadoWhatsapp, extra: Record<string, string> = {}) {
  const base = criarDepsDeAgente([], { WHATSAPP_MODO: 'qr', ADMIN_TOKEN: 'segredo-admin', ...extra })
  const wa: ClienteWhatsapp = { async enviarTexto() {}, async marcarLida() {} }
  const deps: AppDeps = {
    ...base.deps,
    wa,
    avisarErro: async () => {},
    fila: new FilaPorChave(),
    whatsappEstado: () => estado,
    iniciadoEm: Date.now(),
  }
  return criarApp(deps)
}

const QR_FAKE = '2@abcdef,ghijkl,mnopqr'

describe('configuração do modo QR', () => {
  it('reconhece WHATSAPP_MODO=qr e mantém cloud como padrão', () => {
    assert.equal(carregarConfig({ WHATSAPP_MODO: 'qr' }).modoWhatsapp, 'qr')
    assert.equal(carregarConfig({}).modoWhatsapp, 'cloud')
    assert.equal(carregarConfig({ WHATSAPP_MODO: 'xyz' }).modoWhatsapp, 'cloud')
  })
})

describe('página /conectar (QR code)', () => {
  it('exige o token e nega sem ele', async () => {
    const app = appQr({ status: 'aguardando_qr', qr: QR_FAKE, desde: Date.now() })
    assert.equal((await app.request('/conectar')).status, 401)
    assert.equal((await app.request('/conectar?token=errado')).status, 401)
    assert.equal((await app.request('/conectar?token=segredo-admin')).status, 200)
  })

  it('com token, mostra a imagem do QR quando aguardando leitura', async () => {
    const app = appQr({ status: 'aguardando_qr', qr: QR_FAKE, desde: Date.now() })
    const html = await (await app.request('/conectar?token=segredo-admin')).text()
    assert.match(html, /Aparelhos conectados/)
    assert.match(html, /<img src="data:image\/png;base64,/)
    assert.match(html, /http-equiv="refresh"/, 'recarrega sozinha enquanto aguarda')
  })

  it('quando conectado, mostra o número e não recarrega', async () => {
    const app = appQr({ status: 'conectado', numero: '5511999998888', desde: Date.now() })
    for (const aba of ['', '&aba=bot']) {
      const html = await (await app.request(`/conectar?token=segredo-admin${aba}`)).text()
      assert.match(html, /[Cc]onectado/)
      assert.match(html, /\+5511999998888/)
      assert.doesNotMatch(html, /http-equiv="refresh"/)
      assert.doesNotMatch(html, /<img/)
    }
    assert.match(await (await app.request('/conectar?token=segredo-admin&aba=bot')).text(), /✅ Conectado como/)
  })

  it('a raiz redireciona para /conectar levando o token', async () => {
    const app = appQr({ status: 'iniciando', desde: Date.now() })
    const res = await app.request('/?token=segredo-admin', { redirect: 'manual' })
    assert.equal(res.status, 302)
    assert.match(res.headers.get('location') ?? '', /\/conectar\?token=segredo-admin/)
  })
})

describe('/health no modo QR', () => {
  it('mostra o modo e o status da conexão', async () => {
    const app = appQr({ status: 'aguardando_qr', qr: QR_FAKE, desde: Date.now() })
    const dados = (await (await app.request('/health')).json()) as { whatsapp: string; whatsapp_status: string }
    assert.equal(dados.whatsapp, 'qr')
    assert.equal(dados.whatsapp_status, 'aguardando_qr')
  })
})

describe('/admin aceita token na URL (para uso no navegador)', () => {
  it('lista handoffs com ?token=', async () => {
    const app = appQr({ status: 'conectado', desde: Date.now() })
    assert.equal((await app.request('/admin/handoffs')).status, 401)
    assert.equal((await app.request('/admin/handoffs?token=segredo-admin')).status, 200)
  })
})
