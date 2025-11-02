// utils/responseFormatter.js
export class ResponseFormatter {
  static formatChatResponse(conversationId, resposta, fontes = [], metadata = {}) {
    const documentosUnicos = fontes.length > 0 ? [...new Map(
      fontes.map(f => [f.metadados.arquivo_url, {
        nome: f.metadados.arquivo_nome,
        tipo: f.metadados.tipo,
        url: f.metadados.arquivo_url
      }])
    ).values()] : [];

    return {
      conversationId,
      tipo: metadata.tipo || 'resposta',
      resposta,
      fontes: fontes.map(f => ({
        chunk_id: f.chunk_id,
        texto: f.conteudo.substring(0, 200) + (f.conteudo.length > 200 ? '...' : ''),
        metadata: {
          fonte: f.metadados.fonte,
          tipo: f.metadados.tipo,
          chunk_index: f.metadados.chunk_index,
          tags: f.metadados.tags
        },
        score: f.score ? f.score.toFixed(3) : null
      })),
      documentos_usados: documentosUnicos,
      ...metadata
    };
  }

  static formatDiscoveryResponse(conversationId, resposta, topicos, tiposMaterial) {
    return {
      conversationId,
      tipo: 'descoberta',
      resposta,
      topicos_disponiveis: topicos.map(t => ({
        topico: t.topico,
        tipos_material: t.tipos,
        quantidade_fragmentos: t.fragmentos
      })),
      tipos_material: tiposMaterial.map(t => ({
        tipo: t.tipo,
        total_documentos: t.total
      }))
    };
  }

  static formatSearchResponse(resultados) {
    return {
      resultados: resultados.map(r => ({
        chunk_id: r.chunk_id,
        texto: r.texto,
        score: r.score ? r.score.toFixed(3) : null,
        metadata: r.metadata
      })),
      total: resultados.length
    };
  }

  static formatDocumentResponse(documento) {
    if (!documento) {
      return { error: 'Documento não encontrado' };
    }

    return {
      arquivo_url: documento.arquivo_url,
      arquivo_nome: documento.arquivo_nome,
      tipo: documento.metadata.tipo,
      tags: documento.metadata.tags,
      tamanho_mb: (documento.metadata.tamanho_bytes / 1024 / 1024).toFixed(2),
      total_chunks: documento.metadata.total_chunks,
      texto_completo: documento.texto_completo,
      chunks: documento.chunks
    };
  }

  static formatFragmentoResponse(contexto) {
    if (!contexto) {
      return { error: 'Fragmento não encontrado' };
    }

    return {
      chunk_atual: {
        chunk_id: contexto.chunk_atual.chunk_id,
        texto: contexto.chunk_atual.texto,
        metadata: contexto.chunk_atual.metadata
      },
      contexto_anterior: contexto.contexto_anterior ? {
        chunk_id: contexto.contexto_anterior.chunk_id,
        texto: contexto.contexto_anterior.texto,
        chunk_index: contexto.contexto_anterior.chunk_index
      } : null,
      contexto_posterior: contexto.contexto_posterior ? {
        chunk_id: contexto.contexto_posterior.chunk_id,
        texto: contexto.contexto_posterior.texto,
        chunk_index: contexto.contexto_posterior.chunk_index
      } : null,
      documento_pai: contexto.documento_pai
    };
  }

  static formatConversationResponse(conversa) {
    if (!conversa) {
      return { error: 'Conversa não encontrada' };
    }

    return {
      conversationId: conversa.conversationId,
      mensagens: conversa.mensagens.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        fontes: m.fontes || [],
        metadata: m.metadata || {}
      })),
      preferencias: conversa.preferencias || null,
      estado: conversa.estado,
      criado_em: conversa.criado_em,
      atualizado_em: conversa.atualizado_em
    };
  }

  static formatDocumentListResponse(documentos) {
    return {
      documentos: documentos.map(doc => ({
        arquivo_url: doc.arquivo_url,
        arquivo_nome: doc.arquivo_nome,
        tipo: doc.tipo,
        chunks_total: doc.chunks_total,
        tamanho_mb: doc.tamanho_mb ? doc.tamanho_mb.toFixed(2) : '0.00',
        tags: doc.tags || []
      })),
      total: documentos.length
    };
  }

  static formatError(message, status = 500) {
    return {
      error: message,
      status
    };
  }
}