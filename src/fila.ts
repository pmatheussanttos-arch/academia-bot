/**
 * Executa as tarefas de uma mesma chave (o número do cliente) uma de cada vez e em ordem.
 * Sem isso, duas mensagens seguidas do cliente gerariam duas respostas atropeladas.
 * Clientes diferentes seguem em paralelo.
 */
export class FilaPorChave {
  private pontas = new Map<string, Promise<unknown>>()

  executar<T>(chave: string, tarefa: () => Promise<T>): Promise<T> {
    const anterior = this.pontas.get(chave) ?? Promise.resolve()
    const atual = anterior.then(tarefa, tarefa)
    const ponta = atual.catch(() => undefined)
    this.pontas.set(chave, ponta)
    void ponta.then(() => {
      if (this.pontas.get(chave) === ponta) this.pontas.delete(chave)
    })
    return atual
  }

  get pendentes(): number {
    return this.pontas.size
  }
}
