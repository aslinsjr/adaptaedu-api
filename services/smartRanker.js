// services/smartRanker.js
export class SmartRanker {
  constructor() {
    this.pesos = {
      scoreVetorial: 0.35,
      completude: 0.20,
      posicaoDocumento: 0.15,
      matchMetadados: 0.15,
      relevanciaTopico: 0.15
    };
  }

  // MÉTODO PRINCIPAL MELHORADO - Considera relevância do tópico
  rankearPorQualidade(fragmentos, query, topico = null) {
    if (!fragmentos || fragmentos.length === 0) return [];

    const queryLower = query.toLowerCase();
    const topicoLower = topico ? topico.toLowerCase() : queryLower;
    const queryTermos = this.extrairTermos(queryLower);
    const topicosTermos = this.extrairTermos(topicoLower);

    return fragmentos.map(f => {
      const scoreVetorial = f.score || 0;
      const scoreCompletude = this.calcularCompletude(f.conteudo);
      const scorePosicao = this.calcularScorePosicao(f.metadados);
      const scoreMetadados = this.calcularMatchMetadados(f.metadados, queryTermos);
      
      // NOVO: Score de relevância do tópico
      const scoreTopico = this.calcularRelevanciaTopico(f, topicosTermos);

      const scoreFinal = 
        (scoreVetorial * this.pesos.scoreVetorial) +
        (scoreCompletude * this.pesos.completude) +
        (scorePosicao * this.pesos.posicaoDocumento) +
        (scoreMetadados * this.pesos.matchMetadados) +
        (scoreTopico * this.pesos.relevanciaTopico);

      return {
        ...f,
        score_original: scoreVetorial,
        score_final: scoreFinal,
        scores_detalhados: {
          vetorial: scoreVetorial,
          completude: scoreCompletude,
          posicao: scorePosicao,
          metadados: scoreMetadados,
          topico: scoreTopico
        },
        relevante_para_topico: scoreTopico > 0.3
      };
    }).sort((a, b) => b.score_final - a.score_final);
  }

  // NOVO: Método específico para rankear considerando tópico
  rankearPorQualidadeETopico(fragmentos, query, topico) {
    return this.rankearPorQualidade(fragmentos, query, topico);
  }

  // NOVO: Filtrar por relevância semântica do tópico
  filtrarPorTopico(fragmentos, topicoConsulta, threshold = 0.4) {
    if (!fragmentos || fragmentos.length === 0) return [];
    
    const topicoLower = topicoConsulta.toLowerCase();
    const termosTopico = this.extrairTermosRelevantes(topicoLower);
    
    return fragmentos.filter(fragmento => {
      const scoreRelevancia = this.calcularRelevanciaTopicoSimples(fragmento, termosTopico);
      return scoreRelevancia >= threshold;
    });
  }

  // NOVO: Calcular relevância específica para o tópico (versão detalhada)
  calcularRelevanciaTopico(fragmento, topicosTermos) {
    if (!topicosTermos || topicosTermos.length === 0) return 0;
    
    let score = 0;
    const conteudoLower = fragmento.conteudo.toLowerCase();
    
    // 1. Match com termos do tópico no conteúdo (60%)
    const matchConteudo = topicosTermos.filter(termo => 
      conteudoLower.includes(termo)
    ).length;
    score += (matchConteudo / Math.max(topicosTermos.length, 1)) * 0.6;
    
    // 2. Match com tags (25%)
    if (fragmento.metadados.tags && Array.isArray(fragmento.metadados.tags)) {
      const tagsLower = fragmento.metadados.tags.map(t => t.toLowerCase());
      const matchTags = topicosTermos.filter(termo =>
        tagsLower.some(tag => tag.includes(termo) || termo.includes(tag))
      ).length;
      score += (matchTags / Math.max(topicosTermos.length, 1)) * 0.25;
    }
    
    // 3. Match com nome do arquivo (15%)
    if (fragmento.metadados.arquivo_nome) {
      const nomeLower = fragmento.metadados.arquivo_nome.toLowerCase();
      const matchNome = topicosTermos.filter(termo =>
        nomeLower.includes(termo)
      ).length;
      score += (matchNome / Math.max(topicosTermos.length, 1)) * 0.15;
    }
    
    return Math.min(1, score);
  }

  // NOVO: Versão simplificada para filtro rápido
  calcularRelevanciaTopicoSimples(fragmento, termosTopico) {
    if (!termosTopico || termosTopico.length === 0) return 0;
    
    let score = 0;
    const conteudoLower = fragmento.conteudo.toLowerCase();
    
    // Match com conteúdo
    const matchConteudo = termosTopico.filter(termo => 
      conteudoLower.includes(termo)
    ).length;
    score += (matchConteudo / Math.max(termosTopico.length, 1)) * 0.7;
    
    // Match com metadados
    if (fragmento.metadados.tags) {
      const tagsLower = fragmento.metadados.tags.map(t => t.toLowerCase());
      const matchTags = termosTopico.filter(termo =>
        tagsLower.some(tag => tag.includes(termo))
      ).length;
      score += (matchTags / Math.max(termosTopico.length, 1)) * 0.3;
    }
    
    return Math.min(1, score);
  }

  calcularCompletude(texto) {
    if (!texto || texto.length < 10) return 0;

    let score = 0;

    // Verifica início com letra maiúscula
    if (/^[A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ]/.test(texto.trim())) {
      score += 0.3;
    }

    // Verifica final com pontuação
    if (/[.!?]$/.test(texto.trim())) {
      score += 0.3;
    }

    // Verifica frases completas
    const frases = texto.split(/[.!?]+/).filter(f => f.trim().length > 0);
    if (frases.length >= 2) {
      score += 0.2;
    }

    // Penaliza se começa/termina no meio de palavra
    if (/^\w+/.test(texto) && texto[0] === texto[0].toLowerCase()) {
      score -= 0.1;
    }

    // Tamanho adequado (não muito curto, não muito longo)
    const tamanhoPalavras = texto.split(/\s+/).length;
    if (tamanhoPalavras >= 30 && tamanhoPalavras <= 300) {
      score += 0.2;
    }

    return Math.max(0, Math.min(1, score));
  }

  calcularScorePosicao(metadados) {
    const chunkIndex = metadados.chunk_index || 0;
    const totalChunks = metadados.total_chunks || 1;
    
    // Posição relativa no documento (0 a 1)
    const posicaoRelativa = chunkIndex / totalChunks;

    // Chunks do início/meio são geralmente mais informativos
    let score = 0;
    
    if (posicaoRelativa <= 0.1) {
      // Primeiros 10%: introdução, definições importantes
      score = 0.9;
    } else if (posicaoRelativa <= 0.5) {
      // 10-50%: conteúdo principal
      score = 1.0;
    } else if (posicaoRelativa <= 0.8) {
      // 50-80%: ainda relevante
      score = 0.8;
    } else {
      // 80-100%: conclusões, menos específico
      score = 0.6;
    }

    return score;
  }

  calcularMatchMetadados(metadados, queryTermos) {
    let score = 0;
    let matches = 0;

    // Match com tags
    if (metadados.tags && Array.isArray(metadados.tags)) {
      const tagsLower = metadados.tags.map(t => t.toLowerCase());
      for (const termo of queryTermos) {
        if (tagsLower.some(tag => tag.includes(termo) || termo.includes(tag))) {
          matches++;
          score += 0.3;
        }
      }
    }

    // Match com nome do arquivo
    if (metadados.arquivo_nome) {
      const nomeArquivoLower = metadados.arquivo_nome.toLowerCase();
      for (const termo of queryTermos) {
        if (nomeArquivoLower.includes(termo)) {
          matches++;
          score += 0.2;
        }
      }
    }

    // Match com tipo
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

    // Agrupar por documento
    const porDocumento = new Map();
    
    for (const fragmento of fragmentos) {
      const url = fragmento.metadados.arquivo_url;
      if (!porDocumento.has(url)) {
        porDocumento.set(url, []);
      }
      porDocumento.get(url).push(fragmento);
    }

    // Para cada documento, identificar sequências
    const resultado = [];

    for (const [url, chunks] of porDocumento.entries()) {
      // Ordenar por chunk_index
      chunks.sort((a, b) => {
        const idxA = a.metadados.chunk_index || 0;
        const idxB = b.metadados.chunk_index || 0;
        return idxA - idxB;
      });

      // Identificar sequências contíguas
      let sequenciaAtual = [chunks[0]];

      for (let i = 1; i < chunks.length; i++) {
        const anterior = chunks[i - 1].metadados.chunk_index || 0;
        const atual = chunks[i].metadados.chunk_index || 0;

        if (atual === anterior + 1) {
          // Contíguo
          sequenciaAtual.push(chunks[i]);
        } else {
          // Nova sequência
          if (sequenciaAtual.length > 1) {
            // Mesclar sequência
            resultado.push(this.mesclarSequencia(sequenciaAtual));
          } else {
            resultado.push(sequenciaAtual[0]);
          }
          sequenciaAtual = [chunks[i]];
        }
      }

      // Adicionar última sequência
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

    // Juntar conteúdo
    const conteudoMesclado = chunks.map(c => c.conteudo).join('\n\n');

    // Média dos scores
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
          // Manter o de maior score
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

    // Garantir diversidade de documentos
    const resultado = [];
    const documentosUsados = new Map();

    // Ordenar por score_final (já deve estar ordenado)
    const fragmentosOrdenados = [...fragmentos].sort((a, b) => 
      (b.score_final || b.score) - (a.score_final || a.score)
    );

    // PRIORIDADE: Materiais relevantes para o tópico
    const materiaisRelevantes = fragmentosOrdenados.filter(f => f.relevante_para_topico);
    const materiaisNaoRelevantes = fragmentosOrdenados.filter(f => !f.relevante_para_topico);

    // Primeiro adicionar materiais relevantes
    for (const fragmento of materiaisRelevantes) {
      if (resultado.length >= limite) break;

      const url = fragmento.metadados.arquivo_url;
      const countDoc = documentosUsados.get(url) || 0;

      // Limitar fragmentos por documento (máximo 2 para materiais relevantes)
      if (countDoc < 2) {
        resultado.push(fragmento);
        documentosUsados.set(url, countDoc + 1);
      }
    }

    // Se ainda não atingiu o limite, adicionar outros materiais
    if (resultado.length < limite) {
      for (const fragmento of materiaisNaoRelevantes) {
        if (resultado.length >= limite) break;

        const url = fragmento.metadados.arquivo_url;
        const countDoc = documentosUsados.get(url) || 0;

        // Limitar fragmentos por documento (máximo 1 para não relevantes)
        if (countDoc < 1) {
          resultado.push(fragmento);
          documentosUsados.set(url, countDoc + 1);
        }
      }
    }

    // Se ainda não atingiu o limite, adicionar os melhores restantes
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

  // NOVO: Método para validar conjunto de fragmentos
  validarConjuntoFragmentos(fragmentos, topicoConsulta, minRelevantes = 1) {
    if (!fragmentos || fragmentos.length === 0) {
      return {
        valido: false,
        totalFragmentos: 0,
        totalRelevantes: 0,
        percentualRelevancia: 0,
        recomendacao: 'buscar_mais_materiais'
      };
    }

    const fragmentosRelevantes = fragmentos.filter(f => f.relevante_para_topico);
    const percentualRelevancia = (fragmentosRelevantes.length / fragmentos.length) * 100;

    return {
      valido: fragmentosRelevantes.length >= minRelevantes,
      totalFragmentos: fragmentos.length,
      totalRelevantes: fragmentosRelevantes.length,
      percentualRelevancia,
      fragmentosRelevantes,
      recomendacao: fragmentosRelevantes.length === 0 ? 
        'nenhum_material_relevante' : 
        (percentualRelevancia < 30 ? 'poucos_materiais_relevantes' : 'suficiente')
    };
  }

  extrairTermos(texto) {
    return texto
      .toLowerCase()
      .replace(/[^\w\sáàâãéèêíïóôõöúçñ]/g, '')
      .split(/\s+/)
      .filter(t => t.length > 2 && !this.isStopWord(t));
  }

  extrairTermosRelevantes(texto) {
    const termos = this.extrairTermos(texto);
    
    // Filtrar termos muito comuns que não são relevantes para o tópico
    const termosComuns = new Set([
      'sobre', 'aprender', 'estudar', 'conhecer', 'saber', 'entender',
      'quero', 'gostaria', 'preciso', 'sobre', 'acerca', 'assunto'
    ]);
    
    return termos.filter(termo => !termosComuns.has(termo) && termo.length > 3);
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

  aplicarPenalidadeRepeticao(fragmentos, documentosApresentados = []) {
    if (!documentosApresentados || documentosApresentados.length === 0) {
      return fragmentos;
    }

    const docsSet = new Set(documentosApresentados);

    return fragmentos.map(f => {
      const url = f.metadados.arquivo_url;
      
      if (docsSet.has(url)) {
        // Reduz score em 50% para documentos já apresentados
        const scorePenalizado = (f.score_final || f.score) * 0.5;
        
        return {
          ...f,
          score_final: scorePenalizado,
          score_original: f.score_final || f.score,
          penalizado: true
        };
      }
      
      return f;
    });
  }

  // NOVO: Método para detectar tópicos específicos nos fragmentos
  detectarTopicosFragmentos(fragmentos) {
    if (!fragmentos || fragmentos.length === 0) return [];
    
    const contadorTopicos = new Map();
    
    for (const fragmento of fragmentos) {
      // Extrair termos do conteúdo
      const termos = this.extrairTermos(fragmento.conteudo).slice(0, 10);
      
      // Contar ocorrências
      for (const termo of termos) {
        contadorTopicos.set(termo, (contadorTopicos.get(termo) || 0) + 1);
      }
      
      // Considerar tags
      if (fragmento.metadados.tags) {
        for (const tag of fragmento.metadados.tags) {
          const tagLower = tag.toLowerCase();
          contadorTopicos.set(tagLower, (contadorTopicos.get(tagLower) || 0) + 2); // Peso maior para tags
        }
      }
    }
    
    // Retornar tópicos mais frequentes
    return Array.from(contadorTopicos.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topico]) => topico);
  }
}