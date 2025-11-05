// services/contextAnalyzer.js
export class ContextAnalyzer {
  analisarRelevancia(fragmentos, threshold = 0.7) {
    if (!fragmentos || fragmentos.length === 0) return { temConteudoRelevante: false };

    const fragmentosRelevantes = fragmentos.filter(f => {
      const score = f.score_final || f.score || 0;
      return score >= threshold;
    });
    
    return {
      temConteudoRelevante: fragmentosRelevantes.length > 0,
      fragmentosRelevantes,
      scoreMaximo: Math.max(...fragmentos.map(f => f.score_final || f.score || 0)),
      scoreMedio: fragmentos.reduce((sum, f) => sum + (f.score_final || f.score || 0), 0) / fragmentos.length,
      diversidadeDocumentos: this.calcularDiversidadeDocumentos(fragmentosRelevantes)
    };
  }

  calcularDiversidadeDocumentos(fragmentos) {
    if (!fragmentos || fragmentos.length === 0) return 0;
    
    const documentosUnicos = new Set(
      fragmentos.map(f => f.metadados.arquivo_url)
    );
    
    return documentosUnicos.size / fragmentos.length;
  }

  analisarDocumentos(documentos) {
    const tiposUnicos = new Set(documentos.map(d => d.metadados.tipo));
    const fontesUnicas = new Set(documentos.map(d => d.metadados.arquivo_nome));
    const tagsUnicas = new Set(documentos.flatMap(d => d.metadados.tags || []));

    return {
      totalDocumentos: documentos.length,
      tiposUnicos: Array.from(tiposUnicos),
      fontesUnicas: Array.from(fontesUnicas),
      tagsUnicas: Array.from(tagsUnicas),
      diversidade: this.calcularDiversidade(documentos)
    };
  }

  calcularDiversidade(documentos) {
    const tipos = new Set(documentos.map(d => d.metadados.tipo));
    const fontes = new Set(documentos.map(d => d.metadados.arquivo_nome));
    
    const diversidadeTipos = tipos.size / Math.max(documentos.length, 1);
    const diversidadeFontes = fontes.size / Math.max(documentos.length, 1);
    
    return (diversidadeTipos + diversidadeFontes) / 2;
  }

  calcularCompletudeChunk(chunk) {
    if (!chunk || !chunk.conteudo) return 0;

    const texto = chunk.conteudo.trim();
    let score = 0;

    // Verifica início com letra maiúscula
    if (/^[A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ]/.test(texto)) {
      score += 0.25;
    }

    // Verifica final com pontuação adequada
    if (/[.!?]$/.test(texto)) {
      score += 0.25;
    }

    // Verifica se tem frases completas
    const frases = texto.split(/[.!?]+/).filter(f => f.trim().length > 10);
    if (frases.length >= 1) {
      score += 0.2;
    }

    // Verifica tamanho adequado
    const palavras = texto.split(/\s+/).length;
    if (palavras >= 20 && palavras <= 400) {
      score += 0.15;
    }

    // Verifica estrutura (parágrafos, pontuação)
    const temParagrafos = texto.includes('\n') || palavras > 50;
    if (temParagrafos) {
      score += 0.1;
    }

    // Verifica densidade de pontuação (não muito fragmentado)
    const pontuacoes = (texto.match(/[.,;:!?]/g) || []).length;
    const densidadePontuacao = pontuacoes / palavras;
    if (densidadePontuacao > 0.05 && densidadePontuacao < 0.15) {
      score += 0.05;
    }

    return Math.min(1, score);
  }

  detectarSequencialidade(chunks) {
    if (!chunks || chunks.length === 0) return [];

    // Agrupar por arquivo
    const porArquivo = new Map();

    for (const chunk of chunks) {
      const url = chunk.metadados.arquivo_url;
      if (!porArquivo.has(url)) {
        porArquivo.set(url, {
          arquivo_url: url,
          arquivo_nome: chunk.metadados.arquivo_nome,
          tipo: chunk.metadados.tipo,
          chunks: []
        });
      }
      porArquivo.get(url).chunks.push(chunk);
    }

    // Para cada arquivo, ordenar chunks e identificar sequências
    const grupos = [];

    for (const [url, dados] of porArquivo.entries()) {
      // Ordenar por chunk_index
      dados.chunks.sort((a, b) => {
        const idxA = a.metadados.chunk_index || 0;
        const idxB = b.metadados.chunk_index || 0;
        return idxA - idxB;
      });

      // Identificar sequências contíguas
      const sequencias = [];
      let sequenciaAtual = [dados.chunks[0]];

      for (let i = 1; i < dados.chunks.length; i++) {
        const anterior = dados.chunks[i - 1].metadados.chunk_index || 0;
        const atual = dados.chunks[i].metadados.chunk_index || 0;

        if (atual === anterior + 1) {
          sequenciaAtual.push(dados.chunks[i]);
        } else {
          if (sequenciaAtual.length > 0) {
            sequencias.push({
              chunks: sequenciaAtual,
              inicio: sequenciaAtual[0].metadados.chunk_index,
              fim: sequenciaAtual[sequenciaAtual.length - 1].metadados.chunk_index,
              contiguo: sequenciaAtual.length > 1
            });
          }
          sequenciaAtual = [dados.chunks[i]];
        }
      }

      // Adicionar última sequência
      if (sequenciaAtual.length > 0) {
        sequencias.push({
          chunks: sequenciaAtual,
          inicio: sequenciaAtual[0].metadados.chunk_index,
          fim: sequenciaAtual[sequenciaAtual.length - 1].metadados.chunk_index,
          contiguo: sequenciaAtual.length > 1
        });
      }

      grupos.push({
        arquivo: dados.arquivo_nome,
        arquivo_url: url,
        tipo: dados.tipo,
        sequencias: sequencias,
        total_chunks: dados.chunks.length
      });
    }

    return grupos;
  }

  avaliarQualidadeFragmento(chunk, query) {
    if (!chunk || !chunk.conteudo) return 0;

    const queryLower = query.toLowerCase();
    const conteudoLower = chunk.conteudo.toLowerCase();
    
    let score = 0;

    // 1. Densidade de keywords (30%)
    const queryTermos = this.extrairTermosRelevantes(queryLower);
    const matchCount = queryTermos.filter(termo => 
      conteudoLower.includes(termo)
    ).length;
    
    const densidadeKeywords = matchCount / Math.max(queryTermos.length, 1);
    score += densidadeKeywords * 0.3;

    // 2. Estrutura do texto (25%)
    const completude = this.calcularCompletudeChunk(chunk);
    score += completude * 0.25;

    // 3. Tamanho apropriado (20%)
    const palavras = chunk.conteudo.split(/\s+/).length;
    let scoreTamanho = 0;
    if (palavras >= 30 && palavras <= 300) {
      scoreTamanho = 1.0;
    } else if (palavras >= 15 && palavras < 30) {
      scoreTamanho = 0.7;
    } else if (palavras > 300 && palavras <= 500) {
      scoreTamanho = 0.8;
    } else {
      scoreTamanho = 0.4;
    }
    score += scoreTamanho * 0.2;

    // 4. Relevância dos metadados (25%)
    const scoreMetadados = this.avaliarMetadados(chunk.metadados, queryTermos);
    score += scoreMetadados * 0.25;

    return Math.min(1, score);
  }

  avaliarMetadados(metadados, queryTermos) {
    let score = 0;

    // Tags
    if (metadados.tags && Array.isArray(metadados.tags)) {
      const tagsLower = metadados.tags.map(t => t.toLowerCase());
      const matchTags = queryTermos.filter(termo =>
        tagsLower.some(tag => tag.includes(termo) || termo.includes(tag))
      ).length;
      score += (matchTags / Math.max(queryTermos.length, 1)) * 0.5;
    }

    // Nome do arquivo
    if (metadados.arquivo_nome) {
      const nomeLower = metadados.arquivo_nome.toLowerCase();
      const matchNome = queryTermos.filter(termo =>
        nomeLower.includes(termo)
      ).length;
      score += (matchNome / Math.max(queryTermos.length, 1)) * 0.3;
    }

    // Localização (página baixa = mais provável de ter definições)
    if (metadados.localizacao?.pagina) {
      const pagina = metadados.localizacao.pagina;
      if (pagina <= 5) {
        score += 0.2;
      } else if (pagina <= 15) {
        score += 0.1;
      }
    }

    return Math.min(1, score);
  }

  extrairTermosRelevantes(texto) {
    const stopWords = new Set([
      'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'em', 'no', 'na',
      'para', 'por', 'com', 'sem', 'sobre', 'como', 'que', 'qual', 'quando',
      'é', 'são', 'foi', 'ser', 'estar', 'ter', 'o que', 'como'
    ]);

    return texto
      .toLowerCase()
      .replace(/[^\w\sáàâãéèêíïóôõöúçñ]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2 && !stopWords.has(t));
  }

  extrairTopicos(mensagens) {
    const stopWords = new Set([
      'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'em', 'no', 'na',
      'para', 'por', 'com', 'sem', 'sobre', 'como', 'que', 'qual', 'quando'
    ]);

    const palavrasChave = new Map();

    for (const msg of mensagens) {
      const palavras = msg.content
        .toLowerCase()
        .replace(/[^\w\sáàâãéèêíïóôõöúçñ]/g, '')
        .split(/\s+/)
        .filter(p => p.length > 3 && !stopWords.has(p));

      for (const palavra of palavras) {
        palavrasChave.set(palavra, (palavrasChave.get(palavra) || 0) + 1);
      }
    }

    return Array.from(palavrasChave.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([palavra]) => palavra);
  }

  calcularCobertura(chunks, query) {
    if (!chunks || chunks.length === 0) return 0;

    const queryTermos = this.extrairTermosRelevantes(query.toLowerCase());
    if (queryTermos.length === 0) return 0;

    const termosEncontrados = new Set();

    for (const chunk of chunks) {
      const conteudoLower = chunk.conteudo.toLowerCase();
      for (const termo of queryTermos) {
        if (conteudoLower.includes(termo)) {
          termosEncontrados.add(termo);
        }
      }
    }

    return termosEncontrados.size / queryTermos.length;
  }
}