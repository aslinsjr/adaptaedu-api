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
      tipo: metadata.acao || 'resposta',
      resposta,
      fontes: fontes.map(f => ({
        chunk_id: f.chunk_id,
        texto: f.conteudo.substring(0, 200) + (f.conteudo.length > 200 ? '...' : ''),
        metadata: {
          fonte: f.metadados.fonte,
          tipo: f.metadados.tipo,
          chunk_index: f.metadados.chunk_index,
          tags: f.metadados.tags,
          localizacao: {
            pagina: f.metadados.localizacao?.pagina,
            secao: f.metadados.localizacao?.secao
          },
          referencia_completa: this.gerarReferenciaCompleta(f.metadados)
        },
        score: f.score ? f.score.toFixed(3) : null
      })),
      documentos_usados: documentosUnicos,
      ...metadata
    };
  }

  static gerarReferenciaCompleta(metadados) {
    const nome = metadados.arquivo_nome || 'Documento';
    const pagina = metadados.localizacao?.pagina;
    const secao = metadados.localizacao?.secao;

    let referencia = nome;

    if (pagina) {
      referencia += `, pág. ${pagina}`;
    }

    if (secao) {
      referencia += `, seção ${secao}`;
    }

    return referencia;
  }

  static formatConversationResponse(conversa) {
    if (!conversa) {
      return { error: 'Conversa não encontrada' };
    }

    return {
      conversationId: conversa.id,
      mensagens: conversa.mensagens.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        fontes: m.fontes ? m.fontes.map(f => ({
          chunk_id: f.chunk_id,
          texto_preview: f.conteudo?.substring(0, 100) + '...',
          referencia: this.gerarReferenciaCompleta(f.metadados),
          score: f.score
        })) : []
      })),
      criado_em: conversa.criado_em,
      atualizado_em: conversa.atualizado_em
    };
  }

  static formatError(message, status = 500) {
    return {
      error: message,
      status
    };
  }
}