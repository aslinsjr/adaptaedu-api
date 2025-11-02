export class VectorSearchService {
  constructor(mongoService, aiService) {
    this.mongo = mongoService;
    this.ai = aiService;
  }

  async buscarFragmentosRelevantes(query, filtros = {}, limite = 5) {
    const queryEmbedding = await this.ai.createEmbedding(query);
    
    const mongoFiltros = {};
    if (filtros.tags && filtros.tags.length > 0) {
      mongoFiltros['metadados.tags'] = { $in: filtros.tags };
    }
    if (filtros.tipo) {
      mongoFiltros['metadados.tipo'] = filtros.tipo;
    }
    if (filtros.fonte) {
      mongoFiltros['metadados.fonte'] = { $regex: filtros.fonte, $options: 'i' };
    }

    const resultados = await this.mongo.searchByVector(
      queryEmbedding, 
      limite, 
      mongoFiltros
    );

    return resultados.map(r => ({
      chunk_id: r._id.toString(),
      conteudo: r.conteudo,
      metadados: {
        fonte: r.metadados.fonte,
        tipo: r.metadados.tipo,
        arquivo_url: r.metadados.arquivo_url,
        arquivo_nome: r.metadados.arquivo_nome,
        chunk_index: r.metadados.chunk_index,
        tags: r.metadados.tags || []
      },
      score: r.score
    }));
  }

  async expandirContexto(chunk_id) {
    const contexto = await this.mongo.getChunkContext(chunk_id);
    
    if (!contexto) return null;

    return {
      chunk_atual: {
        chunk_id: contexto.chunk_atual._id.toString(),
        texto: contexto.chunk_atual.conteudo,
        metadata: contexto.chunk_atual.metadados
      },
      contexto_anterior: contexto.contexto_anterior ? {
        chunk_id: contexto.contexto_anterior._id.toString(),
        texto: contexto.contexto_anterior.conteudo,
        chunk_index: contexto.contexto_anterior.metadados.chunk_index
      } : null,
      contexto_posterior: contexto.contexto_posterior ? {
        chunk_id: contexto.contexto_posterior._id.toString(),
        texto: contexto.contexto_posterior.conteudo,
        chunk_index: contexto.contexto_posterior.metadados.chunk_index
      } : null,
      documento_pai: {
        nome: contexto.chunk_atual.metadados.arquivo_nome,
        url: contexto.chunk_atual.metadados.arquivo_url,
        tipo: contexto.chunk_atual.metadados.tipo
      }
    };
  }

  rankearResultados(chunks, query) {
    return chunks.sort((a, b) => b.score - a.score);
  }
}