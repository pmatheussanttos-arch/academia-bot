import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MSG_HANDOFF_PADRAO, responder } from '../src/agent.js'
import { chamarHumano, criarDepsDeAgente, texto } from './helpers.js'

const CHAT = '5511999998888'

describe('responder', () => {
  it('responde com o texto do modelo e manda as configurações certas para a API', async () => {
    const { deps, store, chamadas } = criarDepsDeAgente([texto('Nosso plano custa R$ 100,00 😊')])
    store.adicionarMensagem(CHAT, 'user', 'Quanto custa?')

    const resposta = await responder(deps, CHAT, 'Maria')

    assert.equal(resposta, 'Nosso plano custa R$ 100,00 😊')
    const chamada = chamadas[0]!
    assert.equal(chamada.model, 'claude-haiku-5-5')
    assert.deepEqual(chamada.output_config, { effort: 'low' })
    assert.equal(chamada.tools?.[0] && 'name' in chamada.tools[0] ? chamada.tools[0].name : '', 'chamar_humano')
    assert.equal('temperature' in chamada, false)
    assert.equal('tool_choice' in chamada, false, 'tool_choice forçado dá erro 400 neste modelo')
    assert.equal('thinking' in chamada, false)
    const sistema = chamada.system as Array<{ text: string }>
    assert.match(sistema[0]!.text, /Plano único: R\$ 100,00/)
    assert.deepEqual(chamada.messages, [{ role: 'user', content: 'Quanto custa?' }])
  })

  it('manda o histórico começando sempre pelo cliente', async () => {
    const { deps, store, chamadas } = criarDepsDeAgente([texto('ok')])
    store.adicionarMensagem(CHAT, 'assistant', 'resposta solta de antes do corte')
    store.adicionarMensagem(CHAT, 'user', 'Oi')
    store.adicionarMensagem(CHAT, 'assistant', 'Olá!')
    store.adicionarMensagem(CHAT, 'user', 'Tem sábado?')
    await responder(deps, CHAT, 'Maria')
    const papeis = chamadas[0]!.messages.map((m) => m.role)
    assert.deepEqual(papeis, ['user', 'assistant', 'user'])
  })

  it('chama a equipe, devolve o raciocínio do modelo intacto e usa o texto final', async () => {
    const { deps, store, chamadas, avisos } = criarDepsDeAgente([
      chamarHumano('Quer cancelar o plano', 'Vou chamar a equipe'),
      texto('Pronto! A equipe vai falar com você em breve. 😊'),
    ])
    store.adicionarMensagem(CHAT, 'user', 'Quero cancelar')

    const resposta = await responder(deps, CHAT, 'Maria')

    assert.equal(resposta, 'Pronto! A equipe vai falar com você em breve. 😊')
    assert.equal(chamadas.length, 2)
    const segunda = chamadas[1]!.messages
    assert.equal(segunda.length, 3)
    const assistente = segunda[1]!
    assert.equal(assistente.role, 'assistant')
    const tipos = (assistente.content as Array<{ type: string }>).map((b) => b.type)
    assert.deepEqual(tipos, ['thinking', 'text', 'tool_use'])
    const resultado = (segunda[2]!.content as Array<{ type: string; tool_use_id: string }>)[0]!
    assert.equal(resultado.type, 'tool_result')
    assert.equal(resultado.tool_use_id, 'toolu_1')
    assert.equal(store.emHandoff(CHAT), true)
    assert.equal(avisos.length, 1)
    assert.match(avisos[0]!, /Quer cancelar o plano/)
    assert.match(avisos[0]!, /\+5511999998888/)
  })

  it('usa a mensagem padrão se o modelo chamou a equipe e não escreveu nada', async () => {
    const { deps, store } = criarDepsDeAgente([chamarHumano('Dúvida sobre matrícula'), { content: [], stop_reason: 'end_turn' }])
    store.adicionarMensagem(CHAT, 'user', 'Quanto é a matrícula?')
    assert.equal(await responder(deps, CHAT, 'Maria'), MSG_HANDOFF_PADRAO)
  })

  it('trata bloqueio de segurança passando para a equipe', async () => {
    const { deps, store, avisos } = criarDepsDeAgente([{ content: [], stop_reason: 'refusal' }])
    store.adicionarMensagem(CHAT, 'user', 'alguma coisa')
    assert.equal(await responder(deps, CHAT, 'Maria'), MSG_HANDOFF_PADRAO)
    assert.equal(store.emHandoff(CHAT), true)
    assert.equal(avisos.length, 1)
  })

  it('lança erro quando a resposta é cortada ou vazia, para quem chamou decidir', async () => {
    const cortada = criarDepsDeAgente([{ content: [{ type: 'text', text: 'meio', citations: null }], stop_reason: 'max_tokens' }])
    cortada.store.adicionarMensagem(CHAT, 'user', 'oi')
    await assert.rejects(responder(cortada.deps, CHAT, 'M'), /max_tokens/)

    const vazia = criarDepsDeAgente([{ content: [], stop_reason: 'end_turn' }])
    vazia.store.adicionarMensagem(CHAT, 'user', 'oi')
    await assert.rejects(responder(vazia.deps, CHAT, 'M'), /sem texto/)
  })

  it('não entra em loop infinito de ferramentas', async () => {
    const { deps, store } = criarDepsDeAgente(Array.from({ length: 6 }, () => chamarHumano('de novo')))
    store.adicionarMensagem(CHAT, 'user', 'oi')
    assert.equal(await responder(deps, CHAT, 'M'), MSG_HANDOFF_PADRAO)
  })
})
