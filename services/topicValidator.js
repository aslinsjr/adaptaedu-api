// services/topicValidator.js
export class TopicValidator {
  constructor(mongoService, discoveryService) {
    this.mongo = mongoService;
    this.discovery = discoveryService;
  }

  async validarExistenciaConteudo(mensagem, intencao, topicoExtraido = null) {
    const intencoesIsentas = ['casual', 'descoberta'];
    if (intencoesIsentas.includes(intencao)) {
      return { temConteudo: true, bypass: true };
    }

    const topicos = await this.discovery.listarTopicosDisponiveis();
    
    const termosParaBusca = topicoExtraido 
      ? this.extrairTermosChave(topicoExtraido)
      : this.extrairTermosChave(mensagem);
    
    const topicosRelacionados = this.encontrarTopicosRelacionados(termosParaBusca, topicos.topicos);
    
    return {
      temConteudo: topicosRelacionados.length > 0,
      topicosEncontrados: topicosRelacionados,
      sugestoes: this.gerarSugestoes(topicos.topicos, 5),
      topicoUsado: topicoExtraido || mensagem
    };
  }

  extrairTermosChave(mensagem) {
    const stopWords = new Set([
      'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da',
      'sobre', 'como', 'que', 'qual', 'me', 'ensina', 'explica',
      'pode', 'você', 'voce'
    ]);
    
    return mensagem
      .toLowerCase()
      .replace(/[^\w\sáàâãéèêíïóôõöúçñ]/g, '')
      .split(/\s+/)
      .filter(t => t.length > 2 && !stopWords.has(t));
  }

  encontrarTopicosRelacionados(termos, topicos) {
    const relacionados = [];
    
    for (const topico of topicos) {
      const topicoNome = topico.nome.toLowerCase();
      
      for (const termo of termos) {
        if (topicoNome.includes(termo) || termo.includes(topicoNome)) {
          relacionados.push(topico);
          break;
        }
      }
    }
    
    return relacionados;
  }

  gerarSugestoes(topicos, limite = 5) {
    return topicos
      .sort((a, b) => b.quantidade - a.quantidade)
      .slice(0, limite)
      .map(t => t.nome);
  }
}