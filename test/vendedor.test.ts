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

describe('treinar não precisa agendar; só a avaliação física tem horário', () => {
  const i = readFileSync(new URL('../instrucoes.md', import.meta.url), 'utf8')
  it('diz que treino e aula experimental não têm horário marcado', () => {
    assert.match(i, /Para treinar não precisa agendar nada/)
    assert.match(i, /\*\*Nunca\*\* ofereça horário marcado para treinar/)
    assert.match(i, /A aula experimental também não precisa agendar/)
    assert.match(i, /O único horário marcado é o da avaliação física/)
    assert.doesNotMatch(i, /É só agendar e vir/)
    assert.doesNotMatch(i, /aula experimental[^\n]*Qual dia fica bom/)
  })
  it('aluno novo: pergunta se tem treino próprio e explica a avaliação', () => {
    assert.match(i, /Você já tem o seu treino próprio, ou quer que a gente monte o seu treino\?/)
    assert.match(i, /Nela o professor conhece o seu objetivo e o seu condicionamento e monta o seu treino/)
    assert.match(i, /Se já tem treino próprio:\*\* pode vir treinar direto/)
  })
})

describe('diária e entender o pedido real', () => {
  const i = readFileSync(new URL('../instrucoes.md', import.meta.url), 'utf8')
  const c = readFileSync(new URL('../campanha.md', import.meta.url), 'utf8')
  it('a diária existe e custa R$ 15,00', () => {
    assert.match(i, /\*\*Diária:\*\* \*\*R\$ 15,00\*\* por dia de treino/)
    assert.match(i, /Não existe plano "só de sábado": para isso, a diária/)
  })
  it('responde a necessidade explicada, inclusive de outra pessoa, sem seguir o roteiro às cegas', () => {
    assert.match(i, /### Entenda o pedido real antes de seguir o roteiro/)
    assert.match(i, /Não pergunte "o objetivo é seu ou dele\?" quando a situação já está clara/)
    assert.match(i, /Pro seu namorado, o ideal é a diária: R\$ 15 por dia/)
  })
  it('diária: Pix antes de vir, com chave, nome do Pix e comprovante', () => {
    assert.match(i, /de preferência \*\*pelo Pix, antes de vir\*\*/)
    assert.match(i, /🏢 Nome no Pix: MATHEUS S FERREIRA ACADEMIA LTDA\n  💰 Valor: R\$ 15,00 por dia/)
    const m = readFileSync(new URL('../mensagens.md', import.meta.url), 'utf8')
    assert.match(m, /## matricula-pix[\s\S]*🏢 Nome no Pix: MATHEUS S FERREIRA ACADEMIA LTDA/)
    assert.doesNotMatch(m, /🏢 GarageFit Academia/)
  })

  it('na Black, pergunta de diária não é empurrada para a promoção', () => {
    assert.match(c, /Se ela perguntar de \*\*diária\*\*.*Não empurre a Black nesse caso/s)
  })
})

describe('pedido direto: resposta direta, sem empurrar a Black', () => {
  const i = readFileSync(new URL('../instrucoes.md', import.meta.url), 'utf8')
  const c = readFileSync(new URL('../campanha.md', import.meta.url), 'utf8')
  it('chave Pix e pagamento: passa a chave na hora, com o nome do Pix, e pede o comprovante', () => {
    assert.match(i, /### Pedido direto: responda direto \(vale mais do que o roteiro e do que a campanha\)/)
    assert.match(i, /"Claro! Segue o Pix 😊\n  🔑 Chave \(CNPJ\): 35\.950\.235\/0001-29\n  🏢 Nome no Pix: MATHEUS S FERREIRA ACADEMIA LTDA\n  Depois é só me mandar o comprovante por aqui que a equipe confere\."/)
    assert.match(i, /não ofereça a Black e não peça nome para "cadastro" antes de responder/)
  })
  it('aluno atual não vira lead nem recebe a Black sem pedir', () => {
    assert.match(i, /\*\*Aluno atual:\*\* não é lead\. Não peça nome para cadastro, não faça a apresentação de planos e não ofereça a Black/)
    assert.match(c, /=== A BLACK É UMA OFERTA, NÃO O ASSUNTO DE TODA CONVERSA ===/)
    assert.match(c, /\*\*Pedido direto vem primeiro e não recebe a Black\.\*\*/)
    assert.match(c, /\*\*Aluno atual pagando ou resolvendo algo:\*\* não ofereça a Black/)
  })
})
