// routes/chatRoutes.js
import express from 'express';
import { ResponseFormatter } from '../utils/responseFormatter.js';
import { DiscoveryService } from '../services/discoveryService.js';
import { SmartRanker } from '../services/smartRanker.js';
import { ContextAnalyzer } from '../services/contextAnalyzer.js';
import { IntentDetector } from '../services/intentDetector.js';
import { DialogueManager } from '../services/dialogueManager.js';

export function createChatRoutes(vectorSearch, ai, conversationManager, mongo) {
  const router = express.Router();
  const discoveryService = new DiscoveryService(mongo);
  const smartRanker = new SmartRanker();
  const contextAnalyzer = new ContextAnalyzer();
  const intentDetector = new IntentDetector();
  const dialogueManager = new DialogueManager(ai);

  // Serviços disponíveis para outras funções
  conversationManager.mongo = mongo;
  conversationManager.vectorSearch = vectorSearch;
  conversationManager.ai = ai;

  // VERIFICAÇÃO DE TÓPICOS DISPONÍVEIS
  async function verificarTopicosDisponiveis() {
    try {
      const dados = await discoveryService.listarTopicosDisponiveis();
      return {
        disponiveis: dados.topicos.map(t => t.nome),
        detalhes: dados.topicos,
        estatisticas: dados.resumo,
        sugestoes: dados.sugestoes || []
      };
    } catch (error) {
      console.error('Erro ao carregar tópicos:', error);
      return { 
        disponiveis: [], 
        detalhes: [], 
        estatisticas: {},
        sugestoes: []
      };
    }
  }

  // BUSCA BASEADA EM TÓPICOS DISPONÍVEIS
  async function buscarNosTopicosDisponiveis(mensagem, limite = 15) {
    const topicos = await verificarTopicosDisponiveis();
    
    if (topicos.disponiveis.length === 0) {
      throw new Error('Nenhum tópico disponível no banco de dados');
    }

    // Extrair termos relevantes da mensagem
    const termos = extrairTermosRelevantes(mensagem);

    // Encontrar tópicos relevantes
    const topicosRelevantes = topicos.disponiveis.filter(topico => 
      termos.some(termo => topico.toLowerCase().includes(termo)) ||
      topicos.disponiveis.some(t => mensagem.toLowerCase().includes(t.toLowerCase()))
    );

    let todosFragmentos = [];

    if (topicosRelevantes.length > 0) {
      // Buscar nos tópicos relevantes
      for (const topico of topicosRelevantes.slice(0, 3)) {
        const fragmentos = await vectorSearch.buscarFragmentosRelevantes(
          `${topico} ${mensagem}`,
          {},
          Math.ceil(limite / topicosRelevantes.length)
        );
        todosFragmentos = [...todosFragmentos, ...fragmentos];
      }
    } else {
      // Busca geral mas limitada aos materiais existentes
      todosFragmentos = await vectorSearch.buscarFragmentosRelevantes(mensagem, {}, limite);
    }

    return {
      fragmentos: todosFragmentos,
      topicosRelevantes,
      todosTopicos: topicos.disponiveis,
      totalTopicos: topicos.disponiveis.length,
      detalhesTopicos: topicos.detalhes
    };
  }

  function extrairTermosRelevantes(texto) {
    const stopWords = new Set([
      'como', 'que', 'para', 'sobre', 'qual', 'quais', 'quando',
      'onde', 'porque', 'quem', 'quanto', 'pela', 'pelo', 'esta',
      'esse', 'essa', 'isso', 'aqui', 'ali', 'mais', 'menos',
      'você', 'voce', 'pode', 'sabe', 'ensina', 'conhece'
    ]);
    
    return texto.toLowerCase()
      .split(/\s+/)
      .filter(termo => termo.length > 3 && !stopWords.has(termo))
      .slice(0, 5);
  }

  // INICIAR CONVERSA COM VERIFICAÇÃO DE TÓPICOS
  async function iniciarConversaComTopicos(conversationId) {
    let currentConversationId = conversationId;
    
    if (!currentConversationId) {
      currentConversationId = conversationManager.criarConversa();
    }

    // Verificar se já tem mensagem de boas-vindas
    const conversa = conversationManager.getConversa(currentConversationId);
    const temSaudacao = conversa.mensagens.some(msg => 
      msg.role === 'assistant' && msg.metadata?.tipo === 'boas_vindas'
    );

    if (!temSaudacao) {
      const topicos = await verificarTopicosDisponiveis();
      const principaisTopicos = topicos.detalhes.slice(0, 5);

      const mensagemBoasVindas = await ai.gerarBoasVindasComTopicos(
        principaisTopicos, 
        topicos.estatisticas
      );

      conversationManager.adicionarMensagem(
        currentConversationId,
        'assistant',
        mensagemBoasVindas,
        [],
        { 
          tipo: 'boas_vindas',
          primeira_interacao: true,
          topicos_disponiveis: principaisTopicos.map(t => t.nome)
        }
      );
    }

    return currentConversationId;
  }

  // PROCESSAR MENSAGEM COM DETECÇÃO DE INTENÇÃO
  async function processarMensagemUsuario(mensagem, conversationId, contextoCompleto) {
    // 1. VERIFICAR TÓPICOS DISPONÍVEIS E BUSCAR CONTEÚDO
    const resultadoBusca = await buscarNosTopicosDisponiveis(mensagem);
    
    // 2. DETECTAR INTENÇÃO COM CONTEXTO DE TÓPICOS
    const contextoIntencao = {
      ...contextoCompleto,
      topicosDisponiveis: resultadoBusca.todosTopicos
    };
    
    const deteccaoIntencao = intentDetector.detectar(mensagem, contextoIntencao);

    // 3. DETECTAR PREFERÊNCIAS IMPLÍCITAS
    const preferenciasDetectadas = dialogueManager.detectarPreferenciaImplicita(mensagem);
    if (preferenciasDetectadas) {
      conversationManager.atualizarPreferencias(conversationId, preferenciasDetectadas);
    }

    // 4. PROCESSAR BASEADO NA INTENÇÃO DETECTADA
    switch (deteccaoIntencao.intencao) {
      case 'casual':
        return await processarIntencaoCasual(mensagem, contextoCompleto);
        
      case 'descoberta':
        return await processarIntencaoDescoberta(contextoCompleto);
        
      case 'interesse_topico':
        return await processarIntencaoInteresseTopico(
          mensagem, 
          deteccaoIntencao.metadados, 
          conversationId,
          contextoCompleto,
          resultadoBusca
        );
        
      case 'confirmacao':
        return await processarIntencaoConfirmacao(
          mensagem,
          conversationId,
          contextoCompleto,
          resultadoBusca
        );
        
      case 'nivel_conhecimento':
        return await processarIntencaoNivelConhecimento(
          mensagem,
          conversationId,
          contextoCompleto,
          resultadoBusca
        );
        
      case 'follow_up':
      case 'reexplicacao':
        return await processarIntencaoFollowUp(
          mensagem,
          conversationId,
          contextoCompleto,
          resultadoBusca,
          deteccaoIntencao.intencao
        );

      case 'continuacao':
        return await processarIntencaoContinuacao(
          mensagem,
          conversationId,
          contextoCompleto,
          resultadoBusca
        );
        
      default:
        // CONSULTA PADRÃO
        return await processarIntencaoConsulta(
          mensagem,
          conversationId,
          contextoCompleto,
          resultadoBusca,
          deteccaoIntencao
        );
    }
  }

  // PROCESSADORES DE INTENÇÃO ESPECÍFICOS
  async function processarIntencaoCasual(mensagem, contextoCompleto) {
    const resposta = await ai.conversarLivremente(
      mensagem,
      contextoCompleto.historico
    );

    return {
      resposta,
      fragmentos: [],
      metadata: {
        tipo: 'casual',
        intencaoDetectada: 'casual'
      }
    };
  }

  async function processarIntencaoDescoberta(contextoCompleto) {
    const topicos = await verificarTopicosDisponiveis();
    const principaisTopicos = topicos.detalhes.slice(0, 8);
    
    const resposta = await ai.apresentarTopicosDescoberta(
      principaisTopicos,
      topicos.estatisticas,
      contextoCompleto.historico
    );

    return {
      resposta,
      fragmentos: [],
      metadata: {
        tipo: 'descoberta',
        intencaoDetectada: 'descoberta',
        topicos_apresentados: principaisTopicos.map(t => t.nome)
      }
    };
  }

  async function processarIntencaoInteresseTopico(mensagem, metadados, conversationId, contextoCompleto, resultadoBusca) {
    const termoBuscado = metadados.termoBuscado;
    const topicoCorrespondente = metadados.topicoCorrespondente;

    if (resultadoBusca.fragmentos.length > 0) {
      // Rankear e filtrar fragmentos
      let fragmentosRankeados = smartRanker.rankearPorQualidade(resultadoBusca.fragmentos, mensagem);
      fragmentosRankeados = smartRanker.deduplicarConteudo(fragmentosRankeados);
      const fragmentosFinais = smartRanker.selecionarMelhores(fragmentosRankeados, 5);

      const analiseRelevancia = contextAnalyzer.analisarRelevancia(fragmentosFinais, 0.6);

      if (analiseRelevancia.temConteudoRelevante) {
        const preferencias = conversationManager.getPreferencias(conversationId);
        const resposta = await ai.responderComReferenciasEspecificas(
          `Explique sobre ${termoBuscado}`,
          contextoCompleto.historico,
          analiseRelevancia.fragmentosRelevantes,
          preferencias
        );

        return {
          resposta,
          fragmentos: analiseRelevancia.fragmentosRelevantes,
          metadata: {
            tipo: 'resposta_topico_especifico',
            intencaoDetectada: 'interesse_topico',
            topico: termoBuscado,
            topico_correspondente: topicoCorrespondente
          }
        };
      }
    }

    // Se não encontrou conteúdo relevante
    const resposta = await ai.sugerirTopicosRelacionados(
      resultadoBusca.topicosRelevantes.length > 0 ? resultadoBusca.topicosRelevantes : [topicoCorrespondente],
      termoBuscado,
      contextoCompleto.historico
    );

    return {
      resposta,
      fragmentos: [],
      metadata: {
        tipo: 'sugestao_topicos_relacionados',
        intencaoDetectada: 'interesse_topico'
      }
    };
  }

  async function processarIntencaoConsulta(mensagem, conversationId, contextoCompleto, resultadoBusca, deteccaoIntencao) {
    // SE NÃO ENCONTROU CONTEÚDO, SUGERIR TÓPICOS
    if (resultadoBusca.fragmentos.length === 0) {
      const sugestao = await ai.sugerirTopicosDisponiveis(
        resultadoBusca.todosTopicos,
        mensagem,
        contextoCompleto.historico
      );

      return {
        resposta: sugestao,
        fragmentos: [],
        metadata: {
          tipo: 'sugestao_topicos',
          intencaoDetectada: deteccaoIntencao.intencao,
          topicos_sugeridos: resultadoBusca.todosTopicos.slice(0, 5)
        }
      };
    }

    // RANKEAR E FILTRAR FRAGMENTOS
    let fragmentosRankeados = smartRanker.rankearPorQualidade(resultadoBusca.fragmentos, mensagem);
    fragmentosRankeados = smartRanker.deduplicarConteudo(fragmentosRankeados);
    const fragmentosFinais = smartRanker.selecionarMelhores(fragmentosRankeados, 5);

    const analiseRelevancia = contextAnalyzer.analisarRelevancia(fragmentosFinais, 0.6);

    // SE CONTEÚDO NÃO É RELEVANTE O SUFICIENTE
    if (!analiseRelevancia.temConteudoRelevante) {
      const resposta = await ai.sugerirAproximacaoTopico(
        resultadoBusca.topicosRelevantes,
        mensagem,
        contextoCompleto.historico
      );

      return {
        resposta,
        fragmentos: [],
        metadata: {
          tipo: 'redirecionamento_topicos',
          intencaoDetectada: deteccaoIntencao.intencao,
          topicos_relevantes: resultadoBusca.topicosRelevantes
        }
      };
    }

    // VERIFICAR SE PRECISA OFERECER ESCOLHA ENTRE MÚLTIPLOS DOCUMENTOS
    const documentosAgrupados = contextAnalyzer.agruparPorDocumento(analiseRelevancia.fragmentosRelevantes);
    
    if (documentosAgrupados.length > 1) {
      const opcoes = documentosAgrupados.map(doc => ({
        arquivo_url: doc.arquivo_url,
        arquivo_nome: doc.arquivo_nome,
        tipo: doc.tipo,
        fragmentos: doc.fragmentos,
        score_medio: doc.score_medio
      }));
      
      const resposta = await ai.apresentarMateriaisContextual(opcoes, contextoCompleto.historico);
      
      conversationManager.setMateriaisPendentes(conversationId, opcoes, { 
        mensagem_original: mensagem 
      });
      
      return {
        resposta,
        fragmentos: [],
        metadata: {
          tipo: 'lista_materiais',
          intencaoDetectada: deteccaoIntencao.intencao,
          total_opcoes: opcoes.length
        }
      };
    }

    // GERAR RESPOSTA COM REFERÊNCIAS ESPECÍFICAS
    const preferencias = conversationManager.getPreferencias(conversationId);
    const resposta = await ai.responderComReferenciasEspecificas(
      mensagem,
      contextoCompleto.historico,
      analiseRelevancia.fragmentosRelevantes,
      preferencias
    );

    return {
      resposta,
      fragmentos: analiseRelevancia.fragmentosRelevantes,
      metadata: {
        tipo: 'resposta_baseada_topicos',
        intencaoDetectada: deteccaoIntencao.intencao,
        topicos_utilizados: resultadoBusca.topicosRelevantes,
        score_maximo: analiseRelevancia.scoreMaximo,
        documentos_utilizados: [...new Set(analiseRelevancia.fragmentosRelevantes.map(f => f.metadados.arquivo_nome))]
      }
    };
  }

  async function processarIntencaoConfirmacao(mensagem, conversationId, contextoCompleto, resultadoBusca) {
    const preferencias = conversationManager.getPreferencias(conversationId);
    const resposta = await ai.responderComReferenciasEspecificas(
      "Continue com mais informações sobre o tópico atual",
      contextoCompleto.historico,
      resultadoBusca.fragmentos.slice(0, 3),
      preferencias
    );

    return {
      resposta,
      fragmentos: resultadoBusca.fragmentos.slice(0, 3),
      metadata: {
        tipo: 'confirmacao_processada',
        intencaoDetectada: 'confirmacao'
      }
    };
  }

  async function processarIntencaoNivelConhecimento(mensagem, conversationId, contextoCompleto, resultadoBusca) {
    const nivel = mensagem.toLowerCase().includes('não') || mensagem.toLowerCase().includes('pouco') 
      ? 'basico' 
      : 'intermediario';
    
    // Atualizar preferências
    conversationManager.atualizarPreferencias(conversationId, {
      profundidade: nivel,
      limiteFragmentos: nivel === 'basico' ? 3 : 5
    });

    const resposta = await ai.responderComReferenciasEspecificas(
      `Explique de forma ${nivel} sobre o tópico`,
      contextoCompleto.historico,
      resultadoBusca.fragmentos,
      { profundidade: nivel }
    );

    return {
      resposta,
      fragmentos: resultadoBusca.fragmentos,
      metadata: {
        tipo: 'resposta_nivel_adaptado',
        intencaoDetectada: 'nivel_conhecimento',
        nivel_adaptado: nivel
      }
    };
  }

  async function processarIntencaoFollowUp(mensagem, conversationId, contextoCompleto, resultadoBusca, tipoIntencao) {
    const preferencias = conversationManager.getPreferencias(conversationId);
    
    // Ajustar profundidade baseado no tipo de follow-up
    const preferenciasAjustadas = {
      ...preferencias,
      profundidade: tipoIntencao === 'reexplicacao' ? 'basico' : 'detalhado'
    };

    const resposta = await ai.responderComReferenciasEspecificas(
      mensagem,
      contextoCompleto.historico,
      resultadoBusca.fragmentos,
      preferenciasAjustadas
    );

    return {
      resposta,
      fragmentos: resultadoBusca.fragmentos,
      metadata: {
        tipo: tipoIntencao === 'follow_up' ? 'esclarecimento' : 'reexplicacao',
        intencaoDetectada: tipoIntencao
      }
    };
  }

  async function processarIntencaoContinuacao(mensagem, conversationId, contextoCompleto, resultadoBusca) {
    const preferencias = conversationManager.getPreferencias(conversationId);
    const resposta = await ai.responderComReferenciasEspecificas(
      `Continue com mais informações: ${mensagem}`,
      contextoCompleto.historico,
      resultadoBusca.fragmentos,
      preferencias
    );

    return {
      resposta,
      fragmentos: resultadoBusca.fragmentos,
      metadata: {
        tipo: 'continuacao',
        intencaoDetectada: 'continuacao'
      }
    };
  }

  // TRATAMENTO DE ESCOLHA DE MATERIAL PENDENTE
  function extrairEscolhaMaterial(mensagem, maxOpcoes) {
    const lower = mensagem.toLowerCase().trim();
    const match = lower.match(/\b(\d+)\b/);
    if (match) {
      const numero = parseInt(match[1]);
      if (numero >= 1 && numero <= maxOpcoes) return numero - 1;
    }
    
    const opcoes = ['primeiro', 'segundo', 'terceiro', 'quarto', 'quinto'];
    for (let i = 0; i < Math.min(opcoes.length, maxOpcoes); i++) {
      if (lower.includes(opcoes[i])) return i;
    }
    
    return null;
  }

  // ROTA PRINCIPAL DE CHAT
  router.post('/chat', async (req, res) => {
    let currentConversationId;
    
    try {
      const { mensagem, conversationId } = req.body;
      
      if (!mensagem || mensagem.trim().length === 0) {
        return res.status(400).json(
          ResponseFormatter.formatError('Mensagem é obrigatória', 400)
        );
      }

      // 1. INICIAR/VERIFICAR CONVERSA
      currentConversationId = await iniciarConversaComTopicos(conversationId);
      
      // 2. VERIFICAR SE HÁ MATERIAIS PENDENTES PARA ESCOLHA
      const materiaisPendentes = conversationManager.getMateriaisPendentes(currentConversationId);
      if (materiaisPendentes) {
        const escolha = extrairEscolhaMaterial(mensagem, materiaisPendentes.opcoes.length);
        if (escolha !== null && escolha >= 0 && escolha < materiaisPendentes.opcoes.length) {
          const materialEscolhido = materiaisPendentes.opcoes[escolha];
          
          // Adicionar mensagem do usuário
          conversationManager.adicionarMensagem(currentConversationId, 'user', mensagem);
          
          // Obter contexto atualizado
          const contextoCompleto = conversationManager.getContextoCompleto(currentConversationId);
          const preferencias = conversationManager.getPreferencias(currentConversationId);
          
          // Gerar resposta com o material escolhido
          const resposta = await ai.responderComReferenciasEspecificas(
            materiaisPendentes.contexto.mensagem_original || mensagem,
            contextoCompleto.historico,
            materialEscolhido.fragmentos,
            preferencias
          );
          
          // Registrar documentos utilizados
          const documentosUsados = [materialEscolhido.arquivo_url];
          conversationManager.registrarDocumentosApresentados(currentConversationId, documentosUsados);
          conversationManager.limparMateriaisPendentes(currentConversationId);
          
          // Atualizar contexto
          conversationManager.atualizarContextoConversacional(
            currentConversationId,
            mensagem,
            resposta,
            'escolha_material',
            { 
              tipo: 'consulta', 
              material_escolhido: materialEscolhido.arquivo_nome 
            }
          );
          
          // Adicionar resposta ao histórico
          conversationManager.adicionarMensagem(
            currentConversationId,
            'assistant',
            resposta,
            materialEscolhido.fragmentos,
            { 
              tipo: 'consulta', 
              escolha_processada: true,
              intencaoDetectada: 'escolha_material'
            }
          );
          
          return res.json(ResponseFormatter.formatChatResponse(
            currentConversationId,
            resposta,
            materialEscolhido.fragmentos,
            { 
              tipo: 'consulta', 
              escolha_processada: true 
            }
          ));
        } else {
          // Se não foi uma escolha válida, limpar pendentes e processar normalmente
          conversationManager.limparMateriaisPendentes(currentConversationId);
        }
      }

      // 3. OBTER CONTEXTO
      const contextoCompleto = conversationManager.getContextoCompleto(currentConversationId);
      
      // 4. ADICIONAR MENSAGEM DO USUÁRIO
      conversationManager.adicionarMensagem(currentConversationId, 'user', mensagem);

      // 5. PROCESSAR MENSAGEM COM DETECÇÃO DE INTENÇÃO
      const processamento = await processarMensagemUsuario(
        mensagem, 
        currentConversationId, 
        contextoCompleto
      );

      const { resposta, fragmentos, metadata } = processamento;

      // 6. REGISTRAR DOCUMENTOS UTILIZADOS
      const documentosUsados = [...new Set(fragmentos.map(f => f.metadados.arquivo_url))];
      if (documentosUsados.length > 0) {
        conversationManager.registrarDocumentosApresentados(currentConversationId, documentosUsados);
      }

      // 7. ATUALIZAR CONTEXTO
      conversationManager.atualizarContextoConversacional(
        currentConversationId,
        mensagem,
        resposta,
        metadata.intencaoDetectada,
        metadata
      );

      // 8. ADICIONAR RESPOSTA AO HISTÓRICO
      conversationManager.adicionarMensagem(
        currentConversationId,
        'assistant',
        resposta,
        fragmentos,
        metadata
      );

      // 9. RETORNAR RESPOSTA
      return res.json(
        ResponseFormatter.formatChatResponse(
          currentConversationId,
          resposta,
          fragmentos,
          metadata
        )
      );

    } catch (error) {
      console.error('Erro no processamento do chat:', error);
      
      // Resposta de erro informativa
      let mensagemErro = 'Desculpe, estou com dificuldades para acessar os materiais no momento.';
      
      try {
        const topicos = await verificarTopicosDisponiveis();
        if (topicos.disponiveis.length > 0) {
          const topicosTexto = topicos.disponiveis.slice(0, 3).join(', ');
          mensagemErro += ` Posso te ajudar com: ${topicosTexto}.`;
        }
      } catch (e) {
        mensagemErro += ' Por favor, tente novamente.';
      }

      if (currentConversationId) {
        conversationManager.adicionarMensagem(
          currentConversationId,
          'assistant',
          mensagemErro,
          [],
          { tipo: 'erro', error: error.message }
        );
      }

      return res.status(500).json(
        ResponseFormatter.formatError(mensagemErro)
      );
    }
  });

  // ROTA PARA LISTAR TÓPICOS DISPONÍVEIS
  router.get('/topicos-disponiveis', async (req, res) => {
    try {
      const topicos = await verificarTopicosDisponiveis();
      
      res.json({
        success: true,
        total_topicos: topicos.disponiveis.length,
        topicos: topicos.detalhes.map(t => ({
          nome: t.nome,
          tipos_material: t.tipos_disponiveis,
          quantidade_fragmentos: t.quantidade,
          documentos_exemplo: t.documentos?.slice(0, 2) || []
        })),
        estatisticas: topicos.estatisticas,
        sugestoes: topicos.sugestoes
      });
    } catch (error) {
      res.status(500).json(
        ResponseFormatter.formatError(error.message)
      );
    }
  });

  // ROTAS DE GERENCIAMENTO DE CONVERSA
  router.get('/conversas/:conversationId', async (req, res) => {
    try {
      const { conversationId } = req.params;
      const conversa = conversationManager.getConversa(conversationId);
      if (!conversa) return res.status(404).json(ResponseFormatter.formatError('Conversa não encontrada', 404));
      res.json(ResponseFormatter.formatConversationResponse(conversa));
    } catch (error) {
      console.error('Erro ao buscar conversa:', error);
      res.status(500).json(ResponseFormatter.formatError(error.message));
    }
  });

  router.put('/conversas/:conversationId/preferencias', async (req, res) => {
    try {
      const { conversationId } = req.params;
      const { preferencias } = req.body;
      if (!preferencias) return res.status(400).json(ResponseFormatter.formatError('Preferências são obrigatórias', 400));
      const atualizado = conversationManager.atualizarPreferencias(conversationId, preferencias);
      if (!atualizado) return res.status(404).json(ResponseFormatter.formatError('Conversa não encontrada', 404));
      const novasPreferencias = conversationManager.getPreferencias(conversationId);
      res.json({ success: true, preferencias: novasPreferencias });
    } catch (error) {
      console.error('Erro ao atualizar preferências:', error);
      res.status(500).json(ResponseFormatter.formatError(error.message));
    }
  });

  router.delete('/conversas/:conversationId', async (req, res) => {
    try {
      const { conversationId } = req.params;
      const deletado = conversationManager.limparConversa(conversationId);
      if (!deletado) return res.status(404).json(ResponseFormatter.formatError('Conversa não encontrada', 404));
      res.json({ success: true, message: 'Conversa excluída' });
    } catch (error) {
      console.error('Erro ao excluir conversa:', error);
      res.status(500).json(ResponseFormatter.formatError(error.message));
    }
  });

  return router;
}