// services/vectorSearchService.js
export class VectorSearchService {
  constructor(mongoService, aiService) {
    this.mongo = mongoService;
    this.ai = aiService;
  }

  async buscar(query, filtros = {}, limite = 5) {
    const queryEmbedding = await this.ai.createEmbedding(query);
    
    const mongoFiltros = {};

    if (filtros.tags && Array.isArray(filtros.tags) && filtros.tags.length > 0) {
      mongoFiltros['metadados.tags'] = { $in: filtros.tags };
    }

    if (filtros.tipo_material) {
      mongoFiltros['metadados.tipo'] = { 
        $regex: new RegExp(`^${filtros.tipo_material}$`, 'i') 
      };
    }

    if (filtros.arquivo_url) {
      mongoFiltros['metadados.arquivo_url'] = filtros.arquivo_url;
    }

    const resultados = await this.mongo.searchByVector(
      queryEmbedding, 
      limite * 2, // buscar mais e filtrar depois
      mongoFiltros
    );

    return resultados
      .map(r => ({
        chunk_id: r._id.toString(),
        conteudo: r.conteudo,
        metadados: {
          fonte: r.metadados.fonte,
          tipo: r.metadados.tipo,
          arquivo_url: r.metadados.arquivo_url,
          arquivo_nome: r.metadados.arquivo_nome,
          chunk_index: r.metadados.chunk_index,
          total_chunks: r.metadados.total_chunks,
          tags: r.metadados.tags || [],
          titulo: r.metadados.titulo,
          localizacao: {
            pagina: r.metadados.localizacao?.pagina,
            secao: r.metadados.localizacao?.secao,
            linha: r.metadados.localizacao?.linha
          }
        },
        score: r.score
      }))
      .filter(r => r.score > 0.4) // filtro de relevância mínima
      .slice(0, limite); // limitar resultado final
  }
}