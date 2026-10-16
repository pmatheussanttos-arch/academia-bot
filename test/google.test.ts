import assert from 'node:assert/strict'
import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto'
import { describe, it } from 'node:test'
import { ClienteGoogleAgenda, ErroGoogle, lerCredenciaisGoogle, normalizarEvento } from '../src/google.js'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})
const CRED = { clientEmail: 'bot@projeto.iam.gserviceaccount.com', privateKey }

interface Chamada {
  url: string
  metodo: string
  corpo: string | undefined
  auth: string | undefined
}

/** fetch falso: devolve as respostas em ordem e guarda o que foi pedido. */
function fetchFalso(respostas: Array<{ status?: number; json?: unknown }>) {
  const fila = [...respostas]
  const chamadas: Chamada[] = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({
      url: String(url),
      metodo: init?.method ?? 'GET',
      corpo: init?.body instanceof URLSearchParams ? init.body.toString() : (init?.body as string | undefined),
      auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
    })
    const r = fila.shift() ?? { status: 500, json: { error: { message: 'sem resposta preparada' } } }
    const status = r.status ?? 200
    return new Response(JSON.stringify(r.json ?? {}), { status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { fn, chamadas }
}

const TOKEN = { json: { access_token: 'tok-1', expires_in: 3600 } }

describe('credenciais do Google', () => {
  const arquivo = JSON.stringify({ client_email: 'a@b.iam.gserviceaccount.com', private_key: privateKey })
  it('aceita o JSON puro ou em base64', () => {
    assert.equal(lerCredenciaisGoogle(arquivo).clientEmail, 'a@b.iam.gserviceaccount.com')
    assert.equal(lerCredenciaisGoogle(Buffer.from(arquivo).toString('base64')).privateKey, privateKey)
  })
  it('conserta quebras de linha coladas como \\n', () => {
    const colado = `{"client_email":"a@b","private_key":${JSON.stringify(privateKey.replace(/\n/g, '\\n'))}}`
    assert.equal(lerCredenciaisGoogle(colado).privateKey, privateKey.replace(/\n/g, '\\n').replace(/\\n/g, '\n'))
  })
  it('dá erro claro para lixo ou arquivo errado', () => {
    assert.throws(() => lerCredenciaisGoogle('isso não é json'), /não é um JSON válido/)
    assert.throws(() => lerCredenciaisGoogle('{"type":"service_account"}'), /sem "client_email" ou "private_key"/)
  })
})

describe('eventos do Google', () => {
  it('normaliza evento com horário, dia inteiro, livre e cancelado', () => {
    const horario = normalizarEvento({ id: 'a', summary: 'Avaliação', start: { dateTime: '2026-10-19T10:00:00-03:00' }, end: { dateTime: '2026-10-19T10:30:00-03:00' } })
    assert.deepEqual(horario, { id: 'a', titulo: 'Avaliação', ocupa: true, inicio: Date.parse('2026-10-19T13:00:00Z'), fim: Date.parse('2026-10-19T13:30:00Z') })
    const diaInteiro = normalizarEvento({ id: 'b', summary: 'FECHADO', start: { date: '2026-11-15' }, end: { date: '2026-11-16' } })
    assert.deepEqual(diaInteiro.diaInteiro, { de: '2026-11-15', ate: '2026-11-16' })
    assert.equal(normalizarEvento({ id: 'c', transparency: 'transparent', start: { dateTime: '2026-10-19T10:00:00-03:00' }, end: { dateTime: '2026-10-19T10:30:00-03:00' } }).ocupa, false)
    assert.equal(normalizarEvento({ id: 'd', status: 'cancelled' }).ocupa, false)
  })
})

describe('ClienteGoogleAgenda', () => {
  it('assina o JWT de verdade (RS256) com o escopo mínimo e troca por um token', async () => {
    const f = fetchFalso([TOKEN, { json: { items: [] } }])
    const c = new ClienteGoogleAgenda(CRED, f.fn, () => 1_800_000_000_000)
    await c.listarEventos('agenda@group.calendar.google.com', 0, 1)

    const pedidoToken = f.chamadas[0]!
    assert.equal(pedidoToken.url, 'https://oauth2.googleapis.com/token')
    const form = new URLSearchParams(pedidoToken.corpo)
    assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer')
    const [cab, corpo, assinatura] = form.get('assertion')!.split('.') as [string, string, string]
    assert.deepEqual(JSON.parse(Buffer.from(cab, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' })
    const claims = JSON.parse(Buffer.from(corpo, 'base64url').toString())
    assert.equal(claims.iss, CRED.clientEmail)
    assert.equal(claims.scope, 'https://www.googleapis.com/auth/calendar.events')
    assert.equal(claims.aud, 'https://oauth2.googleapis.com/token')
    assert.equal(claims.exp - claims.iat, 3600)
    const valido = createVerify('RSA-SHA256').update(`${cab}.${corpo}`).verify(createPublicKey(publicKey), Buffer.from(assinatura, 'base64url'))
    assert.equal(valido, true, 'a assinatura confere com a chave pública')
    assert.equal(f.chamadas[1]!.auth, 'Bearer tok-1')
  })

  it('reaproveita o token em chamadas seguidas', async () => {
    const f = fetchFalso([TOKEN, { json: { items: [] } }, { json: { items: [] } }])
    const c = new ClienteGoogleAgenda(CRED, f.fn)
    await c.listarEventos('a', 0, 1)
    await c.listarEventos('a', 0, 1)
    assert.equal(f.chamadas.filter((x) => x.url.includes('oauth2')).length, 1)
  })

  it('lista eventos com os parâmetros certos e junta as páginas', async () => {
    const ev = (id: string, h: string) => ({ id, summary: id, start: { dateTime: `2026-10-19T${h}:00-03:00` }, end: { dateTime: `2026-10-19T${h}:30-03:00` } })
    const f = fetchFalso([TOKEN, { json: { items: [ev('a', '10')], nextPageToken: 'p2' } }, { json: { items: [ev('b', '11')] } }])
    const c = new ClienteGoogleAgenda(CRED, f.fn)
    const eventos = await c.listarEventos('equipe@gmail.com', Date.parse('2026-10-19T03:00:00Z'), Date.parse('2026-10-20T03:00:00Z'))
    assert.deepEqual(eventos.map((e) => e.id), ['a', 'b'])
    const url = new URL(f.chamadas[1]!.url)
    assert.equal(url.pathname, '/calendar/v3/calendars/equipe%40gmail.com/events')
    assert.equal(url.searchParams.get('timeMin'), '2026-10-19T03:00:00.000Z')
    assert.equal(url.searchParams.get('timeMax'), '2026-10-20T03:00:00.000Z')
    assert.equal(url.searchParams.get('singleEvents'), 'true')
    assert.equal(new URL(f.chamadas[2]!.url).searchParams.get('pageToken'), 'p2')
  })

  it('cria o evento com fuso horário, descrição e marcas internas, sem convidados', async () => {
    const f = fetchFalso([TOKEN, { json: { id: 'novo123' } }])
    const c = new ClienteGoogleAgenda(CRED, f.fn)
    const id = await c.criarEvento('agenda1', {
      titulo: 'Avaliação — Maria',
      descricao: 'WhatsApp: +5511999998888',
      inicio: Date.parse('2026-10-19T13:00:00Z'),
      fim: Date.parse('2026-10-19T13:30:00Z'),
      fuso: 'America/Sao_Paulo',
      privado: { origem: 'assistente-whatsapp' },
    })
    assert.equal(id, 'novo123')
    const req = f.chamadas[1]!
    assert.equal(req.metodo, 'POST')
    const corpo = JSON.parse(req.corpo!)
    assert.equal(corpo.summary, 'Avaliação — Maria')
    assert.deepEqual(corpo.start, { dateTime: '2026-10-19T13:00:00.000Z', timeZone: 'America/Sao_Paulo' })
    assert.deepEqual(corpo.end, { dateTime: '2026-10-19T13:30:00.000Z', timeZone: 'America/Sao_Paulo' })
    assert.deepEqual(corpo.extendedProperties, { private: { origem: 'assistente-whatsapp' } })
    assert.equal('attendees' in corpo, false)
  })

  it('evento apagado (404) ou cancelado volta como null', async () => {
    const f = fetchFalso([TOKEN, { status: 404, json: { error: { message: 'Not Found' } } }, { json: { id: 'x', status: 'cancelled' } }])
    const c = new ClienteGoogleAgenda(CRED, f.fn)
    assert.equal(await c.obterEvento('a', 'x'), null)
    assert.equal(await c.obterEvento('a', 'x'), null)
  })

  it('tenta de novo uma vez em erro 503 e renova o token em 401', async () => {
    const f = fetchFalso([TOKEN, { status: 503, json: {} }, { json: { items: [] } }])
    assert.deepEqual(await new ClienteGoogleAgenda(CRED, f.fn).listarEventos('a', 0, 1), [])
    assert.equal(f.chamadas.length, 3)

    const g = fetchFalso([TOKEN, { status: 401, json: {} }, { json: { access_token: 'tok-2', expires_in: 3600 } }, { json: { items: [] } }])
    await new ClienteGoogleAgenda(CRED, g.fn).listarEventos('a', 0, 1)
    assert.equal(g.chamadas[3]!.auth, 'Bearer tok-2')
  })

  it('traduz erros do Google em mensagens úteis', async () => {
    const f = fetchFalso([TOKEN, { status: 404, json: { error: { message: 'Not Found' } } }])
    await assert.rejects(new ClienteGoogleAgenda(CRED, f.fn).listarEventos('agenda-errada', 0, 1), (e: unknown) => e instanceof ErroGoogle && e.status === 404 && /Not Found/.test(e.message))

    const r = fetchFalso([{ status: 400, json: { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' } }])
    await assert.rejects(new ClienteGoogleAgenda(CRED, r.fn).listarEventos('a', 0, 1), /Invalid JWT Signature/)
  })
})
