// services/smartRanker.js
export class SmartRanker {
  constructor() {
    this.pesos = {
      scoreVetorial: 0.40,
      completude: 0.25,
      posicaoDocumento: 0.15,
      matchMetadados: 0.20
    };
  }

  rankearPorQualidade(fragmentos, query) {
    if (!fragmentos || fragmentos.length === 0) return [];

    const queryLower = query.toLowerCase();
    const queryTermos = this.extrairTermos(queryLower);

    return fragmentos.map(f => {
      const scoreVetorial = f.score || 0;
      const scoreCompletude = this.calcularCompletude(f.conteudo);
      const scorePosicao = this.calcularScorePosicao(f.metadados);
      const scoreMetadados = this.calcularMatchMetadados(f.metadados, queryTermos);

      const scoreFinal = 
        (scoreVetorial * this.pesos.scoreVetorial) +
        (scoreCompletude * this.pesos.completude) +
        (scorePosicao * this.pesos.posicaoDocumento) +
        (scoreMetadados * this.pesos.matchMetadados);

      return {
        ...f,
        score_original: scoreVetorial,
        score_final: scoreFinal,
        scores_detalhados: {
          vetorial: scoreVetorial,
          completude: scoreCompletude,
          posicao: scorePosicao,
          metadados: scoreMetadados
        }
      };
    }).sort((a, b) => b.score_final - a.score_final);
  }

  calcularCompletude(texto) {
    if (!texto || texto.length < 10) return 0;

    let score = 0;

    if (/^[A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ]/.test(texto.trim())) {
      score += 0.3;
    }

    if (/[.!?]$/.test(texto.trim())) {
      score += 0.3;
    }

    const frases = texto.split(/[.!?]+/).filter(f => f.trim().length > 0);
    if (frases.length >= 2) {
      score += 0.2;
    }

    if (/^\w+/.test(texto) && texto[0] === texto[0].toLowerCase()) {
      score -= 0.1;
    }

    const tamanhoPalavras = texto.split(/\s+/).length;
    if (tamanhoPalavras >= 30 && tamanhoPalavras <= 300) {
      score += 0.2;
    }

    return Math.max(0, Math.min(1, score));
  }

  calcularScorePosicao(metadados) {
    const chunkIndex = metadados.chunk_index || 0;
    const totalChunks = metadados.total_chunks || 1;
    
    const posicaoRelativa = chunkIndex / totalChunks;

    let score = 0;
    
    if (posicaoRelativa <= 0.1) {
      score = 0.9;
    } else if (posicaoRelativa <= 0.5) {
      score = 1.0;
    } else if (posicaoRelativa <= 0.8) {
      score = 0.8;
    } else {
      score = 0.6;
    }

    return score;
  }

  calcularMatchMetadados(metadados, queryTermos) {
    let score = 0;

    if (metadados.tags && Array.isArray(metadados.tags)) {
      const tagsLower = metadados.tags.map(t => t.toLowerCase());
      for (const termo of queryTermos) {
        if (tagsLower.some(tag => tag.includes(termo) || termo.includes(tag))) {
          score += 0.3;
        }
      }
    }

    if (metadados.arquivo_nome) {
      const nomeArquivoLower = metadados.arquivo_nome.toLowerCase();
      for (const termo of queryTermos) {
        if (nomeArquivoLower.includes(termo)) {
          score += 0.2;
        }
      }
    }

    if (metadados.tipo) {
      const tipoLower = metadados.tipo.toLowerCase();
      for (const termo of queryTermos) {
        if (tipoLower.includes(termo)) {
          score += 0.1;
        }
      }
    }

    return Math.min(1, score);
  }

  agruparChunksContiguos(fragmentos) {
    if (!fragmentos || fragmentos.length === 0) return [];

    const porDocumento = new Map();
    
    for (const fragmento of fragmentos) {
      const url = fragmento.metadados.arquivo_url;
      if (!porDocumento.has(url)) {
        porDocumento.set(url, []);
      }
      porDocumento.get(url).push(fragmento);
    }

    const resultado = [];

    for (const [url, chunks] of porDocumento.entries()) {
      chunks.sort((a, b) => {
        const idxA = a.metadados.chunk_index || 0;
        const idxB = b.metadados.chunk_index || 0;
        return idxA - idxB;
      });

      let sequenciaAtual = [chunks[0]];

      for (let i = 1; i < chunks.length; i++) {
        const anterior = chunks[i - 1].metadados.chunk_index || 0;
        const atual = chunks[i].metadados.chunk_index || 0;

        if (atual === anterior + 1) {
          sequenciaAtual.push(chunks[i]);
        } else {
          if (sequenciaAtual.length > 1) {
            resultado.push(this.mesclarSequencia(sequenciaAtual));
          } else {
            resultado.push(sequenciaAtual[0]);
          }
          sequenciaAtual = [chunks[i]];
        }
      }

      if (sequenciaAtual.length > 1) {
        resultado.push(this.mesclarSequencia(sequenciaAtual));
      } else if (sequenciaAtual.length === 1) {
        resultado.push(sequenciaAtual[0]);
      }
    }

    return resultado;
  }

  mesclarSequencia(chunks) {
    if (chunks.length === 1) return chunks[0];

    const primeiro = chunks[0];
    const ultimo = chunks[chunks.length - 1];

    const conteudoMesclado = chunks.map(c => c.conteudo).join('\n\n');

    const scoreMedia = chunks.reduce((sum, c) => sum + (c.score_final || c.score), 0) / chunks.length;

    return {
      chunk_id: `${primeiro.chunk_id}_merged`,
      conteudo: conteudoMesclado,
      metadados: {
        ...primeiro.metadados,
        chunk_index_range: {
          inicio: primeiro.metadados.chunk_index,
          fim: ultimo.metadados.chunk_index
        },
        mesclado: true,
        chunks_originais: chunks.length
      },
      score: scoreMedia,
      score_final: scoreMedia,
      tipo_fragmento: 'mesclado'
    };
  }

  deduplicarConteudo(fragmentos) {
    if (!fragmentos || fragmentos.length <= 1) return fragmentos;

    const resultado = [];
    const processados = new Set();

    for (let i = 0; i < fragmentos.length; i++) {
      if (processados.has(i)) continue;

      const fragmentoA = fragmentos[i];
      let isDuplicado = false;

      for (let j = 0; j < resultado.length; j++) {
        const fragmentoB = resultado[j];
        const similaridade = this.calcularSimilaridadeJaccard(
          fragmentoA.conteudo,
          fragmentoB.conteudo
        );

        if (similaridade > 0.85) {
          isDuplicado = true;
          if ((fragmentoA.score_final || fragmentoA.score) > 
              (fragmentoB.score_final || fragmentoB.score)) {
            resultado[j] = fragmentoA;
          }
          break;
        }
      }

      if (!isDuplicado) {
        resultado.push(fragmentoA);
      }
      
      processados.add(i);
    }

    return resultado;
  }

  calcularSimilaridadeJaccard(textoA, textoB) {
    const termos = (texto) => {
      return new Set(
        texto
          .toLowerCase()
          .replace(/[^\w\sáàâãéèêíïóôõöúçñ]/g, '')
          .split(/\s+/)
          .filter(t => t.length > 2)
      );
    };

    const setA = termos(textoA);
    const setB = termos(textoB);

    const intersecao = new Set([...setA].filter(x => setB.has(x)));
    const uniao = new Set([...setA, ...setB]);

    return intersecao.size / uniao.size;
  }

  selecionarMelhores(fragmentos, limite = 5) {
    if (!fragmentos || fragmentos.length === 0) return [];
    if (fragmentos.length <= limite) return fragmentos;

    const resultado = [];
    const documentosUsados = new Map();

    const fragmentosOrdenados = [...fragmentos].sort((a, b) => 
      (b.score_final || b.score) - (a.score_final || a.score)
    );

    for (const fragmento of fragmentosOrdenados) {
      if (resultado.length >= limite) break;

      const url = fragmento.metadados.arquivo_url;
      const countDoc = documentosUsados.get(url) || 0;

      if (countDoc < 3) {
        resultado.push(fragmento);
        documentosUsados.set(url, countDoc + 1);
      }
    }

    if (resultado.length < limite) {
      for (const fragmento of fragmentosOrdenados) {
        if (resultado.length >= limite) break;
        if (!resultado.includes(fragmento)) {
          resultado.push(fragmento);
        }
      }
    }

    return resultado;
  }

  extrairTermos(texto) {
    return texto
      .toLowerCase()
      .replace(/[^\w\sáàâãéèêíïóôõöúçñ]/g, '')
      .split(/\s+/)
      .filter(t => t.length > 2 && !this.isStopWord(t));
  }

  isStopWord(palavra) {
    const stopWords = new Set([
      'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das',
      'em', 'no', 'na', 'nos', 'nas', 'para', 'por', 'com', 'sem',
      'sobre', 'como', 'que', 'qual', 'quais', 'quando', 'onde', 'porque',
      'é', 'são', 'foi', 'ser', 'estar', 'ter', 'haver'
    ]);
    return stopWords.has(palavra);
  }

  // Removido: aplicarPenalidadeRepeticao (agora filtrado diretamente no chatRoutes)
}