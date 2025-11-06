// services/vectorSearchService.js
export class VectorSearchService {
  constructor(mongoService, aiService) {
    this.mongo = mongoService;
    this.ai = aiService;
  }

  // Normalização de tipos para garantir consistência
  normalizeTipo(tipo) {
    if (!tipo || typeof tipo !== 'string') return null;
    
    const tipoLower = tipo.trim().toLowerCase();
    
    // Mapeamento de tipos para valores padronizados
    const mapeamento = {
      // PDFs e documentos texto
      'pdf': 'pdf',
      'doc': 'doc',
      'docx': 'docx',
      'txt': 'txt',
      'texto': 'txt',
      'document': 'doc',
      
      // Vídeos
      'video': 'video',
      'vídeo': 'video',
      'mp4': 'video',
      'avi': 'video',
      'mkv': 'video',
      'mov': 'video',
      
      // Imagens
      'imagem': 'imagem',
      'image': 'imagem',
      'img': 'imagem',
      'png': 'imagem',
      'jpg': 'imagem',
      'jpeg': 'imagem',
      'gif': 'imagem',
      'webp': 'imagem',
      
      // Áudio
      'audio': 'audio',
      'áudio': 'audio',
      'mp3': 'audio',
      'wav': 'audio',
      'ogg': 'audio',
      
      // Outros
      'apresentação': 'pptx',
      'apresentacao': 'pptx',
      'ppt': 'pptx',
      'pptx': 'pptx',
      'slides': 'pptx',
      
      'planilha': 'xlsx',
      'excel': 'xlsx',
      'xls': 'xlsx',
      'xlsx': 'xlsx',
      'csv': 'csv'
    };
    
    return mapeamento[tipoLower] || tipoLower;
  }

  async buscarFragmentosRelevantes(query, filtros = {}, limite = 5) {
    const queryEmbedding = await this.ai.createEmbedding(query);
    
    const mongoFiltros = {};

    // === FILTRO POR TAGS ===
    if (filtros.tags && Array.isArray(filtros.tags) && filtros.tags.length > 0) {
      mongoFiltros['metadados.tags'] = { $in: filtros.tags };
    }

    // === FILTRO POR MÚLTIPLOS TIPOS (com normalização) ===
    if (filtros.tiposSolicitados && Array.isArray(filtros.tiposSolicitados) && filtros.tiposSolicitados.length > 0) {
      const tiposNormalizados = filtros.tiposSolicitados
        .map(t => this.normalizeTipo(t))
        .filter(t => t !== null);

      if (tiposNormalizados.length > 0) {
        // Criar regex case-insensitive para cada tipo
        mongoFiltros['$or'] = tiposNormalizados.map(tipo => ({
          'metadados.tipo': { 
            $regex: new RegExp(`^${tipo}$`, 'i') 
          }
        }));
      }
    }
    // === FILTRO POR TIPO ÚNICO (com normalização) ===
    else if (filtros.tipo && typeof filtros.tipo === 'string') {
      const tipoNormalizado = this.normalizeTipo(filtros.tipo);
      if (tipoNormalizado) {
        mongoFiltros['metadados.tipo'] = { 
          $regex: new RegExp(`^${tipoNormalizado}$`, 'i') 
        };
      }
    }

    // === FILTRO POR FONTE (com regex) ===
    if (filtros.fonte && typeof filtros.fonte === 'string' && filtros.fonte.trim()) {
      mongoFiltros['metadados.fonte'] = { 
        $regex: filtros.fonte.trim(), 
        $options: 'i' 
      };
    }

    // === FILTRO POR ARQUIVO URL ===
    if (filtros.arquivo_url && typeof filtros.arquivo_url === 'string') {
      mongoFiltros['metadados.arquivo_url'] = filtros.arquivo_url;
    }

    // === FILTRO POR ARQUIVO NOME ===
    if (filtros.arquivo_nome && typeof filtros.arquivo_nome === 'string') {
      mongoFiltros['metadados.arquivo_nome'] = {
        $regex: filtros.arquivo_nome.trim(),
        $options: 'i'
      };
    }

    // Debug (remova em produção)
    if (process.env.DEBUG === 'true') {
      console.log('Filtros Vector Search:', JSON.stringify(mongoFiltros, null, 2));
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