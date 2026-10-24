import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { FERRAMENTAS, responder } from '../src/agent.js'
import { carregarMensagens } from '../src/mensagens.js'
import { CHAVES_PLANOS, chaveDoPlano, lerLinksPagamento, textoPagamentoCartao, trechoCartaoDaMatricula } from '../src/pagamento.js'
import { criarConfigDeTeste, criarDepsDeAgente, texto, usarFerramenta } from './helpers.js'

const CHAT = '5511977776666'
const BASE = readFileSync('./mensagens.md', 'utf8')

function cfgComLinks(linhas: string[]) {
  const pasta = mkdtempSync(join(tmpdir(), 'pag-'))
  const arq = join(pasta, 'm.md')
  const antes = BASE.slice(0, BASE.indexOf('## links-pagamento'))
  const depois = BASE.slice(BASE.indexOf('## lembrete-avaliacao'))
  writeFileSync(arq, `${antes}## links-pagamento\n${linhas.join('\n')}\n\n${depois}`)
  return criarConfigDeTeste({ MENSAGENS_PATH: arq })
}

describe('links de pagamento (InfinitePay)', () => {
  it('os 5 links do Matheus estão no mensagens.md, um por plano', () => {
    const links = lerLinksPagamento(carregarMensagens('./mensagens.md'))
    assert.deepEqual(Object.keys(links).sort(), [...CHAVES_PLANOS].sort())
    assert.equal(links.anual_vip, 'https://link.infinitepay.io/garagefitacad/VC1DLUMtSQ-htztVZNxF4-838,80')
    assert.equal(links.trimestral_vip, 'https://link.infinitepay.io/garagefitacad/VC1DLTMtSQ-xNLN4aIOBC-269,70')
    assert.equal(links.semestral_vip, 'https://link.infinitepay.io/garagefitacad/VC1DLTYtSQ-KEMxUZM0qv-479,40')
    assert.equal(links['3x_por_semana'], 'https://link.infinitepay.io/garagefitacad/VC1DLTEtSQ-jxQLGYnUUJ-90,00')
    assert.equal(links.acesso_livre, 'https://link.infinitepay.io/garagefitacad/VC1DLTEtSQ-CyRHhyOSxh-100,00')
  })

  it('ignora comentário, linha em branco, plano inventado e endereço que não é da InfinitePay', () => {
    const links = lerLinksPagamento({
      'links-pagamento': [
        '# comentário',
        '',
        '3x_por_semana | https://link.infinitepay.io/x/1',
        'acesso_livre | http://link.infinitepay.io/x/2',
        'anual_vip | https://site-do-golpe.com/pague',
        'anual_vip | https://infinitepay.io.golpe.com/x',
        'plano_inventado | https://link.infinitepay.io/x/3',
        'semestral_vip | javascript:alert(1)',
        '# trimestral_vip | https://link.infinitepay.io/x/4',
        'trimestral_vip',
      ].join('\n'),
    })
    assert.deepEqual(links, { '3x_por_semana': 'https://link.infinitepay.io/x/1' })
  })

  it('reconhece o plano pelo texto livre', () => {
    const casos: Array<[string, string | undefined]> = [
      ['Anual VIP (12x de R$ 69,90)', 'anual_vip'],
      ['Trimestral VIP (3x de R$ 89,90)', 'trimestral_vip'],
      ['semestral', 'semestral_vip'],
      ['Acesso livre', 'acesso_livre'],
      ['todos os dias', 'acesso_livre'],
      ['3x por semana', '3x_por_semana'],
      ['Plano 3x na semana', '3x_por_semana'],
      ['Plano especial', undefined],
    ]
    for (const [t, chave] of casos) assert.equal(chaveDoPlano(t), chave, t)
  })

  it('a mensagem leva o link do plano e as garantias: seguro, sem dados do cartão por aqui, comprovante', () => {
    const cfg = criarConfigDeTeste()
    const m = textoPagamentoCartao(cfg, 'anual_vip')!
    assert.match(m, /Anual VIP \(total R\$ 838,80\)/)
    assert.match(m, /https:\/\/link\.infinitepay\.io\/garagefitacad\/VC1DLUMtSQ-htztVZNxF4-838,80/)
    assert.match(m, /nunca por aqui/)
    assert.match(m, /me enviar o comprovante que a recepção confere/)
    assert.doesNotMatch(m, /\{|\}/, 'nenhuma variável ficou sem trocar')
  })

  it('VIP: avisa até quantas parcelas (3x, 6x, 12x); plano básico: nada de parcelamento', () => {
    const cfg = criarConfigDeTeste()
    assert.match(textoPagamentoCartao(cfg, 'trimestral_vip')!, /Na própria página você pode parcelar em até 3x\./)
    assert.match(textoPagamentoCartao(cfg, 'semestral_vip')!, /parcelar em até 6x\./)
    assert.match(textoPagamentoCartao(cfg, 'anual_vip')!, /parcelar em até 12x\./)
    for (const basico of ['3x_por_semana', 'acesso_livre'] as const) {
      const m = textoPagamentoCartao(cfg, basico)!
      assert.doesNotMatch(m, /parcelar/)
      assert.doesNotMatch(m, /\n\n\n/, 'sem linha em branco sobrando')
    }
  })

  it('plano sem link (linha comentada ou apagada): sem mensagem de link e a matrícula cai na recepção', () => {
    const cfg = cfgComLinks(['anual_vip | https://link.infinitepay.io/x/1', '# acesso_livre | https://link.infinitepay.io/x/2'])
    assert.ok(textoPagamentoCartao(cfg, 'anual_vip'))
    assert.equal(textoPagamentoCartao(cfg, 'acesso_livre'), undefined)
    assert.match(trechoCartaoDaMatricula(cfg, 'Acesso livre'), /cartão é passado na recepção/)
    assert.match(trechoCartaoDaMatricula(cfg, 'Anual VIP'), /link\.infinitepay\.io\/x\/1/)
    assert.match(trechoCartaoDaMatricula(cfg, 'Plano especial'), /recepção da academia/)
  })

  it('mensagens.md ilegível: nada de link, e o cartão cai na recepção (o cliente nunca fica sem resposta)', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'pag-'))
    const arq = join(pasta, 'quebrado.md')
    writeFileSync(arq, 'sem seções')
    const cfg = criarConfigDeTeste({ MENSAGENS_PATH: arq })
    assert.equal(textoPagamentoCartao(cfg, 'anual_vip'), undefined)
    assert.match(trechoCartaoDaMatricula(cfg, 'Anual VIP'), /recepção/)
  })
})

describe('ferramenta enviar_link_pagamento', () => {
  const ferramenta = FERRAMENTAS.find((f) => f.name === 'enviar_link_pagamento')!

  it('existe, só aceita os 5 planos e proíbe pedir dados do cartão', () => {
    assert.ok(ferramenta)
    const schema = ferramenta.input_schema as { properties: { plano: { enum: string[] } }; required: string[] }
    assert.deepEqual([...schema.properties.plano.enum].sort(), [...CHAVES_PLANOS].sort())
    assert.deepEqual(schema.required, ['plano'])
    assert.match(ferramenta.description!, /Nunca peça dados do cartão pelo WhatsApp/)
    assert.match(ferramenta.description!, /Não confirma pagamento/)
  })

  it('devolve o link do plano com a ordem de enviar exatamente e de não confirmar pagamento', async () => {
    const t = criarDepsDeAgente([usarFerramenta('enviar_link_pagamento', { plano: 'trimestral_vip' }), texto('ok')])
    t.store.adicionarMensagem(CHAT, 'user', 'quero pagar no cartão o trimestral')
    await responder(t.deps, CHAT, undefined)
    const resultado = JSON.stringify(t.chamadas[1]!.messages.at(-1)!.content)
    assert.match(resultado, /EXATAMENTE/)
    assert.match(resultado, /Não diga que o pagamento foi recebido/)
    assert.match(resultado, /link\.infinitepay\.io\/garagefitacad\/VC1DLTMtSQ-xNLN4aIOBC-269,70/)
    assert.match(resultado, /use chamar_humano/)
  })

  it('plano sem link: manda dizer que o cartão é na recepção, sem inventar link', async () => {
    const cfg = cfgComLinks(['anual_vip | https://link.infinitepay.io/x/1'])
    const base = criarDepsDeAgente([usarFerramenta('enviar_link_pagamento', { plano: 'acesso_livre' }), texto('ok')])
    base.deps.cfg = cfg
    base.store.adicionarMensagem(CHAT, 'user', 'cartão no livre')
    await responder(base.deps, CHAT, undefined)
    const resultado = JSON.stringify(base.chamadas[1]!.messages.at(-1)!.content)
    assert.match(resultado, /Não há link de pagamento para Acesso livre/)
    assert.match(resultado, /recepção/)
    assert.doesNotMatch(resultado, /infinitepay/)
  })

  it('plano inventado pelo modelo vira erro para ele corrigir', async () => {
    const t = criarDepsDeAgente([usarFerramenta('enviar_link_pagamento', { plano: 'plano_secreto' }), texto('ok')])
    t.store.adicionarMensagem(CHAT, 'user', 'cartão')
    await responder(t.deps, CHAT, undefined)
    const bloco = (t.chamadas[1]!.messages.at(-1)!.content as Array<{ is_error?: boolean; content: string }>)[0]!
    assert.equal(bloco.is_error, true)
    assert.match(bloco.content, /Plano inválido/)
  })
})

describe('instruções sobre o pagamento no cartão', () => {
  const i = readFileSync('./instrucoes.md', 'utf8')
  it('link seguro ou recepção; nunca dados do cartão; comprovante e equipe depois de pagar', () => {
    assert.match(i, /pode ser pago pelo \*\*link seguro\*\* da InfinitePay/)
    assert.match(i, /\*\*nunca\*\* peça número, validade, código ou senha/)
    assert.match(i, /Depois do Pix ou do pagamento pelo link, peça o comprovante e chame a equipe para conferir/)
    assert.match(i, /Trimestral em até 3x, Semestral em até 6x, Anual em até 12x/)
    assert.match(i, /\(3x por semana e Acesso livre\) são mensais, \*\*sem parcelamento\*\*/)
    assert.match(i, /Não invente o valor da parcela nem juros/)
    assert.match(i, /\*\*Peça SEMPRE o comprovante\*\* para finalizar a matrícula/)
    assert.match(i, /\(No cartão passado na recepção não precisa de comprovante\.\)/)
    assert.doesNotMatch(i, /Pelo WhatsApp não dá para pagar no cartão/)
  })
})
