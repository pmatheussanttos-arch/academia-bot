import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { tratarMensagem, type AtendimentoDeps } from '../src/atendimento.js'
import { FilaPorChave } from '../src/fila.js'
import type { ClienteWhatsapp, MensagemRecebida } from '../src/whatsapp.js'
import { criarDepsDeAgente, texto } from './helpers.js'

const CHAT = '5511977776666'

function montar(respostas: Parameters<typeof criarDepsDeAgente>[0], agrupar = true) {
  const base = criarDepsDeAgente(respostas)
  const fila = new FilaPorChave()
  const enviadas: string[] = []
  const wa: ClienteWhatsapp = {
    async enviarTexto(_p, t) {
      enviadas.push(t)
    },
    async marcarLida() {},
  }
  const deps: AtendimentoDeps = {
    ...base.deps,
    wa,
    avisarErro: async () => {},
    pausaEntreMensagensMs: 0,
    ...(agrupar ? { esperaAgruparMs: 30, maisMensagensNaFila: (c: string) => fila.naFila(c) > 1 } : {}),
  }
  const chegou = (texto: string) => fila.executar(CHAT, () => tratarMensagem(deps, { wamid: `w-${texto}`, from: CHAT, nome: '', tipo: 'text', texto } as MensagemRecebida))
  return { ...base, fila, enviadas, chegou }
}

describe('mensagens seguidas do mesmo cliente viram UMA resposta', () => {
  it('"Oi" + "Boa tarde" + "Qual o valor?" de uma vez: o modelo é chamado uma vez só, com as três', async () => {
    const t = montar([texto('Resposta única')])
    await Promise.all([t.chegou('Oi'), t.chegou('Boa tarde'), t.chegou('Qual o valor da academia')])
    assert.deepEqual(t.enviadas, ['Resposta única'])
    assert.equal(t.chamadas.length, 1)
    const enviadoAoModelo = JSON.stringify(t.chamadas[0]!.messages)
    for (const m of ['Oi', 'Boa tarde', 'Qual o valor da academia']) assert.ok(enviadoAoModelo.includes(m), m)
  })

  it('uma mensagem sozinha é respondida normalmente (depois da pequena espera)', async () => {
    const t = montar([texto('Olá!')])
    await t.chegou('Oi')
    assert.deepEqual(t.enviadas, ['Olá!'])
  })

  it('mensagens espaçadas (a anterior já respondida) têm cada uma a sua resposta', async () => {
    const t = montar([texto('um'), texto('dois')])
    await t.chegou('Oi')
    await t.chegou('quanto custa?')
    assert.deepEqual(t.enviadas, ['um', 'dois'])
  })

  it('sem a configuração de agrupar, continua uma resposta por mensagem (como antes)', async () => {
    const t = montar([texto('um'), texto('dois')], false)
    await Promise.all([t.chegou('Oi'), t.chegou('Boa tarde')])
    assert.deepEqual(t.enviadas, ['um', 'dois'])
  })

  it('a fila conta as tarefas de cada cliente e zera no fim', async () => {
    const fila = new FilaPorChave()
    let dentro = 0
    const p = [fila.executar('a', async () => void (dentro = fila.naFila('a'))), fila.executar('a', async () => {}), fila.executar('b', async () => {})]
    assert.equal(fila.naFila('a'), 2)
    assert.equal(fila.naFila('b'), 1)
    await Promise.all(p)
    assert.equal(dentro, 2, 'enquanto a primeira roda, a segunda já está na fila')
    assert.equal(fila.naFila('a'), 0)
    assert.equal(fila.naFila('b'), 0)
  })
})
