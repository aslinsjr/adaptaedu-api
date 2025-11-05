export class VectorSearchService {
  constructor(mongoService, aiService) {
    this.mongo = mongoService;
    this.ai = aiService;
  }

  async buscarFragmentosRelevantes(query, filtros = {}, limite = 5) {
    const queryEmbedding = await this.ai.createEmbedding(query);
    
    const mongoFiltros = {};

    // === FILTRO POR TAGS ===
    if (filtros.tags && Array.isArray(filtros.tags) && filtros.tags.length > 0) {
      mongoFiltros['metadados.tags'] = { $in: filtros.tags };
    }

    // === FILTRO POR MÚLTIPLOS TIPOS (usar $in com strings) ===
    if (filtros.tiposSolicitados && Array.isArray(filtros.tiposSolicitados) && filtros.tiposSolicitados.length > 0) {
      const tiposValidos = filtros.tiposSolicitados
        .map(t => typeof t === 'string' ? t.trim().toLowerCase() : null)
        .filter(t => t && t.length > 0);

      if (tiposValidos.length > 0) {
        // Usa $in com strings (case-sensitive por padrão)
        mongoFiltros['metadados.tipo'] = { $in: tiposValidos };
      }
    }
    // === FILTRO POR TIPO ÚNICO ===
    else if (filtros.tipo && typeof filtros.tipo === 'string' && filtros.tipo.trim()) {
      mongoFiltros['metadados.tipo'] = { $eq: filtros.tipo.trim().toLowerCase() };
    }

    // === FILTRO POR FONTE (com regex) ===
    if (filtros.fonte && typeof filtros.fonte === 'string' && filtros.fonte.trim()) {
      mongoFiltros['metadados.fonte'] = { 
        $regex: filtros.fonte.trim(), 
        $options: 'i' 
      };
    }

    // Debug (remova em produção)
    // console.log('Filtros Vector Search:', JSON.stringify(mongoFiltros, null, 2));

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
        total_chunks: r.metadados.total_chunks,
        tags: r.metadados.tags || [],
        titulo: r.metadados.titulo,
        localizacao: {
          pagina: r.metadados.localizacao?.pagina,
          secao: r.metadados.localizacao?.secao,
          linha: r.metadados.localizacao?.linha
        },
        contexto_documento: {
          chunk_index: r.metadados.chunk_index,
          total_chunks: r.metadados.total_chunks,
          posicao_percentual: r.metadados.total_chunks > 0 
            ? ((r.metadados.chunk_index / r.metadados.total_chunks) * 100).toFixed(1)
            : '0.0'
        }
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
        metadata: {
          ...contexto.chunk_atual.metadados,
          localizacao: {
            pagina: contexto.chunk_atual.metadados.localizacao?.pagina,
            secao: contexto.chunk_atual.metadados.localizacao?.secao
          }
        }
      },
      contexto_anterior: contexto.contexto_anterior ? {
        chunk_id: contexto.contexto_anterior._id.toString(),
        texto: contexto.contexto_anterior.conteudo,
        chunk_index: contexto.contexto_anterior.metadados.chunk_index,
        localizacao: {
          pagina: contexto.contexto_anterior.metadados.localizacao?.pagina
        }
      } : null,
      contexto_posterior: contexto.contexto_posterior ? {
        chunk_id: contexto.contexto_posterior._id.toString(),
        texto: contexto.contexto_posterior.conteudo,
        chunk_index: contexto.contexto_posterior.metadados.chunk_index,
        localizacao: {
          pagina: contexto.contexto_posterior.metadados.localizacao?.pagina
        }
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