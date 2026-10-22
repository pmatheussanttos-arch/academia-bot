import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { responder } from '../src/agent.js'
import { situacaoDaConversa, vezesQuePediuNome } from '../src/prompt.js'
import { criarDepsDeAgente, texto } from './helpers.js'

const CHAT = '5511966665555'
const SAUDACAO = 'Olá! Eu sou o GFIT, atendente virtual aqui da GarageFit 😊 Vou te ajudar. Primeiramente, qual o seu nome?'
const PEDIDO2 = 'Para te passar os valores certinhos, qual é o seu nome?'

function textoDoSistema(chamada: { system?: unknown }): string {
  return (chamada.system as Array<{ text: string }>).map((b) => b.text).join('\n')
}

describe('pedir o nome no máximo 2 vezes', () => {
  it('conta os pedidos de nome nas respostas do assistente', () => {
    assert.equal(vezesQuePediuNome([]), 0)
    assert.equal(vezesQuePediuNome([SAUDACAO]), 1)
    assert.equal(vezesQuePediuNome([SAUDACAO, 'O 3x fica R$ 89,90.', PEDIDO2]), 2)
    assert.equal(vezesQuePediuNome(['Como posso te chamar?']), 1)
  })

  it('primeira mensagem: nenhum aviso extra (a apresentação sai normal)', () => {
    assert.deepEqual(situacaoDaConversa([]), [])
  })

  it('depois da apresentação: proíbe repetir a apresentação e deixa pedir o nome mais uma vez', () => {
    const l = situacaoDaConversa([SAUDACAO]).join('\n')
    assert.match(l, /NUNCA repita a apresentação/)
    assert.match(l, /pediu o nome uma vez/)
    assert.match(l, /mais UMA vez/)
  })

  it('depois de 2 pedidos: proíbe pedir de novo e manda seguir o fluxo sem nome', () => {
    const l = situacaoDaConversa([SAUDACAO, PEDIDO2]).join('\n')
    assert.match(l, /NÃO peça o nome de novo/)
    assert.match(l, /siga o fluxo sem nome/)
    assert.doesNotMatch(l, /mais UMA vez/)
  })

  it('o aviso chega de verdade ao modelo, mas só do histórico daquela conversa', async () => {
    const { deps, store, chamadas } = criarDepsDeAgente([texto('ok'), texto('ok'), texto('ok')])
    store.adicionarMensagem(CHAT, 'user', 'Oi')
    store.adicionarMensagem(CHAT, 'assistant', SAUDACAO)
    store.adicionarMensagem(CHAT, 'user', 'Quanto custa?')
    store.adicionarMensagem(CHAT, 'assistant', PEDIDO2)
    store.adicionarMensagem(CHAT, 'user', 'Quanto custa a mensalidade?')
    await responder(deps, CHAT, undefined)
    assert.match(textoDoSistema(chamadas[0]!), /NÃO peça o nome de novo/)

    // outra pessoa, conversa nova: sem aviso nenhum
    store.adicionarMensagem('5511911112222', 'user', 'Oi')
    await responder(deps, '5511911112222', undefined)
    assert.doesNotMatch(textoDoSistema(chamadas[1]!), /NÃO peça o nome|NUNCA repita a apresentação/)
  })

  it('as instruções dizem: no máximo 2 vezes, depois segue sem nome e sem insistir', () => {
    const i = readFileSync('./instrucoes.md', 'utf8')
    assert.match(i, /no máximo 2 vezes na conversa inteira/)
    assert.match(i, /nunca mais peça, e siga o fluxo sem o nome/)
  })
})
