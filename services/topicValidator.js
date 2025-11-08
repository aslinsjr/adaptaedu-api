// services/topicValidator.js
export class TopicValidator {
  constructor(mongoService, discoveryService) {
    this.mongo = mongoService;
    this.discovery = discoveryService;
  }

  async validarExistenciaConteudo(mensagem, intencao) {
    // Intenções que não precisam validar
    const intencoesIsentas = ['casual', 'descoberta', 'confirmacao'];
    if (intencoesIsentas.includes(intencao)) {
      return { temConteudo: true, bypass: true };
    }

    // Obter tópicos do BD (direto, sem cache)
    const { topicos, resumo } = await this.discovery.listarTopicosDisponiveis();
    
    // Extrair termos da mensagem
    const termos = this.extrairTermosChave(mensagem);
    
    // Buscar matches
    const topicosRelacionados = this.encontrarTopicosRelacionados(termos, topicos);
    
    return {
      temConteudo: topicosRelacionados.length > 0,
      topicosEncontrados: topicosRelacionados,
      sugestoes: this.gerarSugestoes(topicos, 5)
    };
  }

  extrairTermosChave(mensagem) {
    const stopWords = new Set([
      'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da',
      'sobre', 'como', 'que', 'qual', 'me', 'ensina', 'explica'
    ]);
    
    return mensagem
      .toLowerCase()
      .replace(/[^\w\sáàâãéèêíïóôõöúç]/g, '')
      .split(/\s+/)
      .filter(t => t.length > 2 && !stopWords.has(t));
  }

  encontrarTopicosRelacionados(termos, topicos) {
    const relacionados = [];
    
    for (const topico of topicos) {
      const topicoNome = topico.nome.toLowerCase();
      const tags = topico.tipos_disponiveis || [];
      
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