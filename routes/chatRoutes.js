// routes/chatRoutes.js
import express from 'express';
import { ResponseFormatter } from '../utils/responseFormatter.js';
import { DiscoveryService } from '../services/discoveryService.js';
import { SmartRanker } from '../services/smartRanker.js';
import { ContextAnalyzer } from '../services/contextAnalyzer.js';
import { IntentDetector } from '../services/intentDetector.js';

export function createChatRoutes(vectorSearch, ai, conversationManager, mongo) {
  const router = express.Router();
  const discoveryService = new DiscoveryService(mongo);
  const smartRanker = new SmartRanker();
  const contextAnalyzer = new ContextAnalyzer();
  const intentDetector = new IntentDetector();

  // Serviços disponíveis para outras funções
  conversationManager.mongo = mongo;
  conversationManager.vectorSearch = vectorSearch;
  conversationManager.ai = ai;

  // VERIFICAÇÃO DE TÓPICOS DISPONÍVEIS
  async function verificarTopicosDisponiveis() {
    try {
      const dados = await discoveryService.listarTopicosDisponiveis();
      return {
        disponiveis: dados.topicos,
        estatisticas: dados.resumo,
        sugestoes: dados.sugestoes || []
      };
    } catch (error) {
      console.error('Erro ao carregar tópicos:', error);
      return { disponiveis: [], estatisticas: {}, sugestoes: [] };
    }
  }

  // BUSCA BASEADA EM TÓPICOS DISPONÍVEIS
  async function buscarNosTopicosDisponiveis(mensagem, limite = 15) {
    const topicos = await verificarTopicosDisponiveis();
    
    if (topicos.disponiveis.length === 0) {
      throw new Error('Nenhum tópico disponível no banco de dados');
    }

    // Extrair termos relevantes da mensagem
    const termos = mensagem.toLowerCase().split(/\s+/)
      .filter(termo => termo.length > 3)
      .slice(0, 5);

    // Encontrar tópicos relevantes
    const topicosRelevantes = topicos.disponiveis.filter(topico => 
      termos.some(termo => topico.nome.toLowerCase().includes(termo)) ||
      topicos.disponiveis.some(t => mensagem.toLowerCase().includes(t.nome.toLowerCase()))
    );

    let todosFragmentos = [];

    if (topicosRelevantes.length > 0) {
      // Buscar nos tópicos relevantes
      for (const topico of topicosRelevantes.slice(0, 3)) {
        const fragmentos = await vectorSearch.buscarFragmentosRelevantes(
          `${topico.nome} ${mensagem}`,
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
      topicosRelevantes: topicosRelevantes.map(t => t.nome),
      todosTopicos: topicos.disponiveis.map(t => t.nome),
      totalTopicos: topicos.disponiveis.length
    };
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
      const principaisTopicos = topicos.disponiveis.slice(0, 5).map(t => t.nome);

      const mensagemBoasVindas = await ai.gerarBoasVindasComTopicos(principaisTopicos, topicos.estatisticas);

      conversationManager.adicionarMensagem(
        currentConversationId,
        'assistant',
        mensagemBoasVindas,
        [],
        { 
          tipo: 'boas_vindas',
          primeira_interacao: true,
          topicos_disponiveis: principaisTopicos
        }
      );
    }

    return currentConversationId;
  }

  // PROCESSAR MENSAGEM DO USUÁRIO
  async function processarMensagemUsuario(mensagem, conversationId, contextoCompleto) {
    // 1. VERIFICAR TÓPICOS DISPONÍVEIS
    const resultadoBusca = await buscarNosTopicosDisponiveis(mensagem);
    
    // 2. SE NÃO ENCONTROU CONTEÚDO, SUGERIR TÓPICOS
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
          topicos_sugeridos: resultadoBusca.todosTopicos.slice(0, 5),
          total_topicos: resultadoBusca.totalTopicos
        }
      };
    }

    // 3. RANKEAR E FILTRAR FRAGMENTOS
    let fragmentosRankeados = smartRanker.rankearPorQualidade(resultadoBusca.fragmentos, mensagem);
    fragmentosRankeados = smartRanker.deduplicarConteudo(fragmentosRankeados);
    const fragmentosFinais = smartRanker.selecionarMelhores(fragmentosRankeados, 5);

    const analiseRelevancia = contextAnalyzer.analisarRelevancia(fragmentosFinais, 0.6);

    // 4. SE CONTEÚDO NÃO É RELEVANTE O SUFICIENTE
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
          topicos_relevantes: resultadoBusca.topicosRelevantes
        }
      };
    }

    // 5. GERAR RESPOSTA COM REFERÊNCIAS ESPECÍFICAS
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
        topicos_utilizados: resultadoBusca.topicosRelevantes,
        score_maximo: analiseRelevancia.scoreMaximo,
        documentos_utilizados: [...new Set(analiseRelevancia.fragmentosRelevantes.map(f => f.metadados.arquivo_nome))]
      }
    };
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
      
      // 2. OBTER CONTEXTO
      const contextoCompleto = conversationManager.getContextoCompleto(currentConversationId);
      
      // 3. ADICIONAR MENSAGEM DO USUÁRIO
      conversationManager.adicionarMensagem(currentConversationId, 'user', mensagem);

      // 4. PROCESSAR MENSAGEM (SEMPRE BASEADO NOS TÓPICOS DISPONÍVEIS)
      const processamento = await processarMensagemUsuario(
        mensagem, 
        currentConversationId, 
        contextoCompleto
      );

      const { resposta, fragmentos, metadata } = processamento;

      // 5. REGISTRAR DOCUMENTOS UTILIZADOS
      const documentosUsados = [...new Set(fragmentos.map(f => f.metadados.arquivo_url))];
      if (documentosUsados.length > 0) {
        conversationManager.registrarDocumentosApresentados(currentConversationId, documentosUsados);
      }

      // 6. ATUALIZAR CONTEXTO
      conversationManager.atualizarContextoConversacional(
        currentConversationId,
        mensagem,
        resposta,
        metadata.tipo,
        metadata
      );

      // 7. ADICIONAR RESPOSTA AO HISTÓRICO
      conversationManager.adicionarMensagem(
        currentConversationId,
        'assistant',
        resposta,
        fragmentos,
        metadata
      );

      // 8. RETORNAR RESPOSTA
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
        // Tentar pelo menos mostrar os tópicos disponíveis
        const topicos = await verificarTopicosDisponiveis();
        if (topicos.disponiveis.length > 0) {
          const topicosTexto = topicos.disponiveis.slice(0, 3).map(t => t.nome).join(', ');
          mensagemErro += ` Posso te ajudar com: ${topicosTexto}.`;
        }
      } catch (e) {
        // Fallback simples
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
        topicos: topicos.disponiveis.map(t => ({
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

  // ROTAS DE GERENCIAMENTO DE CONVERSA (mantidas do código original)
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