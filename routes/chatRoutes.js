// routes/chatRoutes.js
import express from 'express';
import { ResponseFormatter } from '../utils/responseFormatter.js';
import { DialogueManager } from '../services/dialogueManager.js';
import { ContextAnalyzer } from '../services/contextAnalyzer.js';
import { IntentDetector } from '../services/intentDetector.js';
import { DiscoveryService } from '../services/discoveryService.js';
import { SmartRanker } from '../services/smartRanker.js';

function mapearTiposParaAmigavel(tipos) {
  const mapeamento = {
    'pdf': 'texto',
    'docx': 'texto',
    'doc': 'texto',
    'txt': 'texto',
    'video': 'vídeo',
    'mp4': 'vídeo',
    'avi': 'vídeo',
    'mkv': 'vídeo',
    'imagem': 'imagem',
    'image': 'imagem',
    'png': 'imagem',
    'jpg': 'imagem',
    'jpeg': 'imagem',
    'gif': 'imagem'
  };

  const tiposAmigaveis = new Set();
  
  for (const tipo of tipos) {
    const tipoLower = tipo.toLowerCase();
    const tipoAmigavel = mapeamento[tipoLower] || tipoLower;
    tiposAmigaveis.add(tipoAmigavel);
  }

  return Array.from(tiposAmigaveis);
}

export function createChatRoutes(vectorSearch, ai, conversationManager, mongo) {
  const router = express.Router();
  const dialogueManager = new DialogueManager(ai);
  const contextAnalyzer = new ContextAnalyzer();
  const intentDetector = new IntentDetector();
  const discoveryService = new DiscoveryService(mongo);
  const smartRanker = new SmartRanker();

  router.post('/chat', async (req, res) => {
    try {
      const { mensagem, conversationId } = req.body;

      if (!mensagem) {
        return res.status(400).json(
          ResponseFormatter.formatError('Mensagem é obrigatória', 400)
        );
      }

      let currentConversationId = conversationId;
      let preferencias = null;

      // Cria ou recupera conversa
      if (currentConversationId) {
        preferencias = conversationManager.getPreferencias(currentConversationId);
      }

      if (!preferencias) {
        currentConversationId = conversationManager.criarConversa();
        preferencias = conversationManager.getPreferencias(currentConversationId);
      }

      const historico = conversationManager.getHistorico(currentConversationId, 5);

      // Detecta intenção
      const deteccaoIntencao = intentDetector.detectar(mensagem, { historico });

      // Adiciona mensagem do usuário
      conversationManager.adicionarMensagem(currentConversationId, 'user', mensagem);

      // CASUAL
      if (deteccaoIntencao.intencao === 'casual') {
        const resposta = await ai.conversarLivremente(mensagem, historico);

        conversationManager.adicionarMensagem(
          currentConversationId,
          'assistant',
          resposta,
          [],
          { tipo: 'casual' }
        );

        return res.json(ResponseFormatter.formatChatResponse(
          currentConversationId,
          resposta,
          [],
          { tipo: 'casual' }
        ));
      }

      // DESCOBERTA
      if (deteccaoIntencao.intencao === 'descoberta') {
        const dadosDisponiveis = await discoveryService.listarTopicosDisponiveis();
        const apresentacao = discoveryService.formatarParaApresentacao(dadosDisponiveis);
        
        const tiposMaterialAmigaveis = apresentacao.estatisticas.tipos_material.map(t => ({
          tipo: mapearTiposParaAmigavel([t.tipo])[0],
          quantidade: t.quantidade
        }));

        const topicosComTiposAmigaveis = apresentacao.destaques.map(t => ({
          nome: t.nome,
          tipos_disponiveis: mapearTiposParaAmigavel(t.tipos_disponiveis),
          quantidade: t.quantidade
        }));

        const resposta = await ai.apresentarTopicos(
          topicosComTiposAmigaveis,
          tiposMaterialAmigaveis,
          historico
        );

        conversationManager.adicionarMensagem(
          currentConversationId,
          'assistant',
          resposta,
          [],
          { 
            tipo: 'descoberta',
            topicos: apresentacao.destaques,
            categorias: apresentacao.categorias
          }
        );

        return res.json(ResponseFormatter.formatDiscoveryResponse(
          currentConversationId,
          resposta,
          apresentacao.destaques,
          tiposMaterialAmigaveis
        ));
      }

      // INTERESSE EM TÓPICO
      if (deteccaoIntencao.intencao === 'interesse_topico') {
        const termoBuscado = deteccaoIntencao.metadados.termoBuscado;
        const topicoInfo = await discoveryService.verificarSeEhTopicoConhecido(termoBuscado);

        if (topicoInfo && topicoInfo.encontrado) {
          const tiposAmigaveis = mapearTiposParaAmigavel(topicoInfo.tipos_material);
          const resposta = await ai.gerarEngajamentoTopico(
            topicoInfo.topico,
            tiposAmigaveis,
            historico
          );

          conversationManager.adicionarMensagem(
            currentConversationId,
            'assistant',
            resposta,
            [],
            { 
              tipo: 'engajamento_topico',
              topico: topicoInfo.topico,
              tipos_disponiveis: tiposAmigaveis
            }
          );

          return res.json(ResponseFormatter.formatChatResponse(
            currentConversationId,
            resposta,
            [],
            { tipo: 'engajamento_topico', topico: topicoInfo.topico }
          ));
        }

        // Se não encontrou o tópico, trata como consulta normal
        deteccaoIntencao.intencao = 'consulta';
      }

      // PREFERENCIA
      if (deteccaoIntencao.intencao === 'preferencia') {
        const preferenciasDetectadas = dialogueManager.detectarPreferenciaImplicita(mensagem);
        
        if (preferenciasDetectadas) {
          conversationManager.atualizarPreferencias(currentConversationId, preferenciasDetectadas);
          preferencias = conversationManager.getPreferencias(currentConversationId);
        }

        const resposta = await ai.conversarLivremente(
          mensagem,
          historico,
          'O usuário está configurando preferências. Confirme as mudanças de forma amigável.'
        );

        conversationManager.adicionarMensagem(
          currentConversationId,
          'assistant',
          resposta,
          [],
          { tipo: 'preferencia', preferencias: preferenciasDetectadas }
        );

        return res.json(ResponseFormatter.formatChatResponse(
          currentConversationId,
          resposta,
          [],
          { tipo: 'preferencia', preferencias_atualizadas: preferenciasDetectadas }
        ));
      }

      // CONTINUACAO - usa contexto do histórico
      if (deteccaoIntencao.intencao === 'continuacao') {
        const topicoContexto = deteccaoIntencao.metadados.topico_contexto;
        
        // Enriquece a query com o tópico do contexto
        const queryEnriquecida = topicoContexto 
          ? `${topicoContexto} ${mensagem}` 
          : mensagem;

        // Força intenção para CONSULTA para processar normalmente
        deteccaoIntencao.intencao = 'consulta';
        deteccaoIntencao.metadados.query_enriquecida = queryEnriquecida;
        deteccaoIntencao.metadados.usou_contexto = true;
      }

      // CONSULTA COM SMART RANKER
      const preferenciasImplicitas = dialogueManager.detectarPreferenciaImplicita(mensagem);
      if (preferenciasImplicitas) {
        conversationManager.atualizarPreferencias(currentConversationId, preferenciasImplicitas);
        preferencias = conversationManager.getPreferencias(currentConversationId);
      }

      const filtros = {};
      if (preferencias.tiposMaterialPreferidos?.length > 0) {
        filtros.tipo = preferencias.tiposMaterialPreferidos[0];
      }

      const maxFragmentos = preferencias.limiteFragmentos || 5;

      // Determina query para busca
      let queryBusca = mensagem;
      
      // Se há contexto no histórico e mensagem é curta, enriquece query
      if (deteccaoIntencao.metadados.usar_contexto_historico && 
          deteccaoIntencao.metadados.topico_contexto) {
        queryBusca = `${deteccaoIntencao.metadados.topico_contexto} ${mensagem}`;
      } else if (deteccaoIntencao.metadados.query_enriquecida) {
        queryBusca = deteccaoIntencao.metadados.query_enriquecida;
      }

      // 1. Busca inicial com mais resultados
      const fragmentosBrutos = await vectorSearch.buscarFragmentosRelevantes(
        queryBusca,
        filtros,
        maxFragmentos * 3
      );

      if (!fragmentosBrutos || fragmentosBrutos.length === 0) {
        const topicosExtraidos = intentDetector.extrairTopicoDaMensagem(queryBusca);
        const sugestaoContexto = topicosExtraidos.length > 0
          ? `O usuário perguntou sobre: ${topicosExtraidos.join(', ')}. Não há material relevante. Seja honesto e sugira explorar tópicos disponíveis.`
          : 'Não há material sobre isso. Sugira ao usuário explorar os tópicos disponíveis.';

        const resposta = await ai.conversarLivremente(mensagem, historico, sugestaoContexto);

        conversationManager.adicionarMensagem(
          currentConversationId,
          'assistant',
          resposta,
          [],
          { tipo: 'sem_resultado', topicos_buscados: topicosExtraidos }
        );

        return res.json(ResponseFormatter.formatChatResponse(
          currentConversationId,
          resposta,
          [],
          { tipo: 'sem_resultado' }
        ));
      }

      // 2. Ranking inteligente
      const fragmentosRankeados = smartRanker.rankearPorQualidade(
        fragmentosBrutos,
        queryBusca
      );

      // 3. Agrupamento de contíguos
      const fragmentosAgrupados = smartRanker.agruparChunksContiguos(
        fragmentosRankeados
      );

      // 4. Deduplicação
      const fragmentosDedupados = smartRanker.deduplicarConteudo(
        fragmentosAgrupados
      );

      // 5. Seleção final
      const fragmentosFinais = smartRanker.selecionarMelhores(
        fragmentosDedupados,
        maxFragmentos
      );

      // 6. Análise de relevância
      const analiseRelevancia = contextAnalyzer.analisarRelevancia(fragmentosFinais, 0.65);

      if (!analiseRelevancia.temConteudoRelevante) {
        const topicosExtraidos = intentDetector.extrairTopicoDaMensagem(queryBusca);
        const sugestaoContexto = topicosExtraidos.length > 0
          ? `O usuário perguntou sobre: ${topicosExtraidos.join(', ')}. Não há material suficientemente relevante. Seja honesto e sugira explorar tópicos disponíveis.`
          : 'Não há material relevante sobre isso. Sugira ao usuário explorar os tópicos disponíveis.';

        const resposta = await ai.conversarLivremente(mensagem, historico, sugestaoContexto);

        conversationManager.adicionarMensagem(
          currentConversationId,
          'assistant',
          resposta,
          [],
          { tipo: 'sem_resultado', topicos_buscados: topicosExtraidos }
        );

        return res.json(ResponseFormatter.formatChatResponse(
          currentConversationId,
          resposta,
          [],
          { tipo: 'sem_resultado' }
        ));
      }

      // 7. Resposta com contexto enriquecido
      const resposta = await ai.responderComContexto(
        mensagem,
        historico,
        analiseRelevancia.fragmentosRelevantes,
        preferencias
      );

      conversationManager.adicionarMensagem(
        currentConversationId,
        'assistant',
        resposta,
        analiseRelevancia.fragmentosRelevantes,
        { tipo: 'consulta' }
      );

      return res.json(ResponseFormatter.formatChatResponse(
        currentConversationId,
        resposta,
        analiseRelevancia.fragmentosRelevantes,
        { 
          tipo: 'consulta',
          scoreMaximo: analiseRelevancia.scoreMaximo,
          confianca: deteccaoIntencao.confianca,
          diversidade: analiseRelevancia.diversidadeDocumentos,
          total_processados: fragmentosBrutos.length,
          selecionados: fragmentosFinais.length,
          contexto_usado: deteccaoIntencao.metadados.usou_contexto || false
        }
      ));

    } catch (error) {
      console.error('Erro no chat:', error);
      res.status(500).json(ResponseFormatter.formatError(error.message));
    }
  });

  router.get('/conversas/:conversationId', async (req, res) => {
    try {
      const { conversationId } = req.params;
      const conversa = conversationManager.getConversa(conversationId);

      if (!conversa) {
        return res.status(404).json(
          ResponseFormatter.formatError('Conversa não encontrada', 404)
        );
      }

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

      if (!preferencias) {
        return res.status(400).json(
          ResponseFormatter.formatError('Preferências são obrigatórias', 400)
        );
      }

      const atualizado = conversationManager.atualizarPreferencias(
        conversationId,
        preferencias
      );

      if (!atualizado) {
        return res.status(404).json(
          ResponseFormatter.formatError('Conversa não encontrada', 404)
        );
      }

      const novasPreferencias = conversationManager.getPreferencias(conversationId);

      res.json({
        success: true,
        preferencias: novasPreferencias
      });
    } catch (error) {
      console.error('Erro ao atualizar preferências:', error);
      res.status(500).json(ResponseFormatter.formatError(error.message));
    }
  });

  router.delete('/conversas/:conversationId', async (req, res) => {
    try {
      const { conversationId } = req.params;
      const deletado = conversationManager.limparConversa(conversationId);

      if (!deletado) {
        return res.status(404).json(
          ResponseFormatter.formatError('Conversa não encontrada', 404)
        );
      }

      res.json({ success: true, message: 'Conversa excluída' });
    } catch (error) {
      console.error('Erro ao excluir conversa:', error);
      res.status(500).json(ResponseFormatter.formatError(error.message));
    }
  });

  return router;
}