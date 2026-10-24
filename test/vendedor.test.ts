import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { REGRAS_FIXAS } from '../src/prompt.js'

const i = readFileSync('./instrucoes.md', 'utf8')
const secao = i.slice(i.indexOf('## Como vender'), i.indexOf('## Modalidades'))

describe('bot vendedor: quebra de objeções, curto e amigável', () => {
  it('a seção existe e define a postura e a fórmula de 3 passos', () => {
    assert.ok(secao.length > 500, 'seção presente')
    assert.match(secao, /amigável, direto e confiante/)
    assert.match(secao, /sempre conduz para o próximo passo/)
    assert.match(secao, /Acolha:/)
    assert.match(secao, /Um argumento real/)
    assert.match(secao, /Pergunta de condução/)
    assert.match(secao, /em até 3 frases/)
  })

  it('cobre as objeções mais comuns', () => {
    for (const objecao of ['Tá caro', 'Vou pensar', 'Preciso falar com alguém', 'Não tenho tempo', 'Já treino em outro lugar', 'Sou iniciante', 'Não sei se vou continuar', 'Tem desconto', '"ok"']) {
      assert.ok(secao.includes(objecao), objecao)
    }
  })

  it('conduz para o próximo passo com os recursos reais: aula experimental grátis, avaliação, cadastro', () => {
    assert.match(secao, /aula experimental é gratuita, sem compromisso/)
    assert.match(secao, /Quer vir conhecer numa aula experimental gratuita/)
    assert.match(secao, /pare de argumentar e feche/)
  })

  it('não estende a conversa: uma insistência só, porta aberta, respostas curtas', () => {
    assert.match(secao, /No máximo UMA insistência por objeção/)
    assert.match(secao, /Se mudar de ideia, é só chamar/)
    assert.match(secao, /Respostas curtas: 1 a 3 frases/)
  })

  it('respeita as regras de segurança: sem urgência falsa, sem promessa, sem falar mal, sem desconto inventado', () => {
    assert.match(secao, /Nada de urgência falsa/)
    assert.match(secao, /não invente prazo, vagas limitadas nem promoção/)
    assert.match(secao, /Não prometa resultado/)
    assert.match(secao, /Nunca fale mal de outra academia/)
    assert.match(secao, /Não invente desconto/)
    assert.match(REGRAS_FIXAS + i, /Nunca prometer resultado/)
    assert.doesNotMatch(secao, /últimas vagas|só hoje|promoção imperdível|garantido|você vai perder/i)
  })

  it('todo valor e horário citado nos exemplos existe de verdade nestas instruções', () => {
    const resto = i.replace(secao, '')
    for (const valor of new Set(secao.match(/R\$ \d+,\d\d/g) ?? [])) assert.ok(resto.includes(valor), `${valor} não existe na tabela de planos`)
    assert.match(resto, /Segunda a sexta: 5h às 12h e 14h às 21h/, 'o "até as 21h" dos exemplos confere com o funcionamento')
    assert.match(resto, /Anual VIP: \*\*12x de R\$ 69,90\*\*/)
  })

  it('o tom de voz agora é de vendedor amigável e direto, e continua neutro em gênero', () => {
    assert.match(i, /Vendedor amigável e direto/)
    assert.doesNotMatch(secao, /tranquilo\(a\)|bem-vindo\(a\)|\(a\)/, 'sem flexão de gênero: o bot não sabe')
  })

  it('o limite de 3 frases e uma pergunta por mensagem continua valendo, com as exceções já previstas', () => {
    assert.match(i, /no máximo \*\*3 frases curtas\*\* e termina com \*\*UMA pergunta só\*\*/)
    assert.match(secao, /A exceção é a mensagem de valores e as mensagens oficiais das ferramentas/)
  })
})
