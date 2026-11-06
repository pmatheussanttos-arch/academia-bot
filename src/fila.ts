/**
 * Executa as tarefas de uma mesma chave (o número do cliente) uma de cada vez e em ordem.
 * Sem isso, duas mensagens seguidas do cliente gerariam duas respostas atropeladas.
 * Clientes diferentes seguem em paralelo.
 */
export class FilaPorChave {
  private pontas = new Map<string, Promise<unknown>>()
  private contagem = new Map<string, number>()

  executar<T>(chave: string, tarefa: () => Promise<T>): Promise<T> {
    const anterior = this.pontas.get(chave) ?? Promise.resolve()
    this.contagem.set(chave, (this.contagem.get(chave) ?? 0) + 1)
    const baixar = () => {
      const n = (this.contagem.get(chave) ?? 1) - 1
      if (n <= 0) this.contagem.delete(chave)
      else this.contagem.set(chave, n)
    }
    const atual = anterior.then(tarefa, tarefa).finally(baixar)
    const ponta = atual.catch(() => undefined)
    this.pontas.set(chave, ponta)
    void ponta.then(() => {
      if (this.pontas.get(chave) === ponta) this.pontas.delete(chave)
    })
    return atual
  }

  /** Quantas tarefas desta chave estão na fila (contando a que está rodando). */
  naFila(chave: string): number {
    return this.contagem.get(chave) ?? 0
  }

  get pendentes(): number {
    return this.pontas.size
  }
}
