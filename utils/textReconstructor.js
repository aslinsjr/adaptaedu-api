export class TextReconstructor {
  constructor(mongoService) {
    this.mongo = mongoService;
  }

  async reconstruirDocumento(arquivo_url) {
    const chunks = await this.mongo.getAllChunksFromDocument(arquivo_url);
    
    if (chunks.length === 0) return null;

    const chunksOrdenados = this.ordenarChunks(chunks);
    const textoCompleto = this.juntarTexto(chunksOrdenados);
    
    const metadata = {
      arquivo_url: chunks[0].metadados.arquivo_url,
      arquivo_nome: chunks[0].metadados.arquivo_nome,
      tipo: chunks[0].metadados.tipo,
      tags: chunks[0].metadados.tags || [],
      tamanho_bytes: chunks[0].metadados.tamanho_bytes,
      total_chunks: chunks.length
    };

    return {
      arquivo_url: metadata.arquivo_url,
      arquivo_nome: metadata.arquivo_nome,
      texto_completo: textoCompleto,
      chunks: chunksOrdenados.map(c => ({
        index: c.metadados.chunk_index,
        texto: c.conteudo
      })),
      metadata
    };
  }

  ordenarChunks(chunks) {
    return chunks.sort((a, b) => {
      const indexA = a.metadados.chunk_index || 0;
      const indexB = b.metadados.chunk_index || 0;
      return indexA - indexB;
    });
  }

  juntarTexto(chunks) {
    return chunks.map(c => c.conteudo).join('\n\n');
  }

  async reconstruirParcial(arquivo_url, inicio, fim) {
    const todosChunks = await this.mongo.getAllChunksFromDocument(arquivo_url);
    const chunksOrdenados = this.ordenarChunks(todosChunks);
    
    const chunksSelecionados = chunksOrdenados.slice(inicio, fim);
    const textoCompleto = this.juntarTexto(chunksSelecionados);

    return {
      texto: textoCompleto,
      chunks: chunksSelecionados.map(c => ({
        index: c.metadados.chunk_index,
        texto: c.conteudo
      })),
      range: { inicio, fim },
      total: todosChunks.length
    };
  }
}
