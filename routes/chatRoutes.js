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

  function extrairEscolha(mensagem, maxOpcoes) {
    const lower = mensagem.toLowerCase().trim();
    
    const match = lower.match(/\b(\d+)\b/);
    if (match) {
      const numero = parseInt(match[1]);
      if (numero >= 1 && numero <= maxOpcoes) {
        return numero - 1;
      }
    }

    const opcoes = ['primeiro', 'segunda', 'terceiro', 'quarto', 'quinto'];
    for (let i = 0; i < Math.min(opcoes.length, maxOpcoes); i++) {
      if (lower.includes(opcoes[i])) {
        return i;
      }
    }

    return null;
  }

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

      if (currentConversationId) {
        preferencias = conversationManager.getPreferencias(currentConversationId);
      }

      if (!preferencias) {
        currentConversationId = conversationManager.criarConversa();
        preferencias = conversationManager.getPreferencias(currentConversationId);
      }

      const historico = conversationManager.getHistorico(currentConversationId, 5);
      const materiaisPendentes = conversationManager.getMateriaisPendentes(currentConversationId);
      
      // Tratamento de escolha de material
      if (materiaisPendentes) {
        const escolha = extrairEscolha(mensagem, materiaisPendentes.opcoes.length);
        
        if (escolha !== null && escolha >= 0 && escolha < materiaisPendentes.opcoes.length) {
          const materialEscolhido = materiaisPendentes.opcoes[escolha];
          
          conversationManager.adicionarMensagem(currentConversationId, 'user', mensagem);
          
          const resposta = await ai.responderComContexto(
            materiaisPendentes.contexto.mensagem_original || mensagem,
            historico,
            materialEscolhido.fragmentos,
            preferencias
          );

          const documentosUsados = [materialEscolhido.arquivo_url];
          conversationManager.registrarDocumentosApresentados(currentConversationId, documentosUsados);
          conversationManager.limparMateriaisPendentes(currentConversationId);

          conversationManager.adicionarMensagem(
            currentConversationId,
            'assistant',
            resposta,
            materialEscolhido.fragmentos,
            { tipo: 'consulta', material_escolhido: materialEscolhido.arquivo_nome }
          );

          return res.json(ResponseFormatter.formatChatResponse(
            currentConversationId,
            resposta,
            materialEscolhido.fragmentos,
            { tipo: 'consulta', escolha_processada: true }
          ));
        } else {
          conversationManager.limparMateriaisPendentes(currentConversationId);
        }
      }

      // Adiciona mensagem do usuário
      conversationManager.adicionarMensagem(currentConversationId, 'user', mensagem);

      // Detecta intenção
      const deteccaoIntencao = intentDetector.detectar(mensagem, { historico });

      // CASUAL: Saudação ou interação leve
      if (deteccaoIntencao.intencao === 'casual') {
        const resposta = await ai.conversarLivremente(
          mensagem,
          historico,
          `${ai.personaEdu}\n\nResponda de forma amigável e natural. Se for saudação, convide a explorar os materiais disponíveis.`
        );

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

      // DESCOBERTA: Pergunta o que pode ensinar
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
            { tipo: 'engajamento_topico', topico: topicoInfo.topico }
          );

          return res.json(ResponseFormatter.formatChatResponse(
            currentConversationId,
            resposta,
            [],
            { tipo: 'engajamento_topico' }
          ));
        }
      }

      // CONSULTA NORMAL
      let queryBusca = mensagem;
      if (deteccaoIntencao.metadados.usar_contexto_historico) {
        const ultimoTopico = deteccaoIntencao.metadados.topico_contexto;
        queryBusca = `${ultimoTopico} ${mensagem}`;
      }

      const tipoMidiaSolicitado = dialogueManager.detectarTipoMidiaSolicitado(mensagem);
      const documentosApresentados = conversationManager.getDocumentosApresentados(currentConversationId);

      let fragmentosBrutos = await vectorSearch.buscarFragmentosRelevantes(
        queryBusca,
        {
          tipo: tipoMidiaSolicitado?.tipo,
          tiposSolicitados: tipoMidiaSolicitado?.filtros
        },
        20
      );

      // Remove documentos já apresentados
      fragmentosBrutos = fragmentosBrutos.filter(f => 
        !documentosApresentados.includes(f.metadados.arquivo_url)
      );

      if (fragmentosBrutos.length === 0) {
        // Evita loop de "não tenho materiais" para mensagens casuais
        if (deteccaoIntencao.intencao === 'casual') {
          const resposta = await ai.conversarLivremente(
            mensagem,
            historico,
            `Você é um assistente educacional. Responda de forma amigável e convide o usuário a perguntar sobre tópicos disponíveis.`
          );
          conversationManager.adicionarMensagem(currentConversationId, 'assistant', resposta, [], { tipo: 'casual' });
          return res.json(ResponseFormatter.formatChatResponse(currentConversationId, resposta, [], { tipo: 'casual' }));
        }

        // Resposta padrão de ausência de material
        const resposta = `Desculpe, não encontrei materiais relevantes sobre "${mensagem}". Que tal explorar outros tópicos? Pergunte "o que você pode me ensinar" para ver as opções disponíveis.`;

        conversationManager.adicionarMensagem(
          currentConversationId,
          'assistant',
          resposta,
          [],
          { tipo: 'sem_resultado' }
        );

        return res.json(ResponseFormatter.formatChatResponse(
          currentConversationId,
          resposta,
          [],
          { tipo: 'sem_resultado' }
        ));
      }

      let fragmentosRankeados = smartRanker.rankearPorQualidade(fragmentosBrutos, queryBusca);
      fragmentosRankeados = smartRanker.deduplicarConteudo(fragmentosRankeados);
      fragmentosRankeados = smartRanker.agruparChunksContiguos(fragmentosRankeados);

      const maxFragmentos = preferencias?.limiteFragmentos || 5;
      let fragmentosFinais = smartRanker.selecionarMelhores(fragmentosRankeados, maxFragmentos);

      let thresholdRelevancia = 0.65;
      if (tipoMidiaSolicitado) thresholdRelevancia = 0.40;
      else if (deteccaoIntencao.metadados.pos_apresentacao) thresholdRelevancia = 0.30;
      
      const analiseRelevancia = contextAnalyzer.analisarRelevancia(
        fragmentosFinais, 
        thresholdRelevancia
      );

      if (!analiseRelevancia.temConteudoRelevante) {
        const resposta = `Não encontrei conteúdo suficientemente relevante sobre "${mensagem}". Posso te ajudar com outros temas — é só perguntar!`;

        conversationManager.adicionarMensagem(
          currentConversationId,
          'assistant',
          resposta,
          [],
          { tipo: 'sem_resultado' }
        );

        return res.json(ResponseFormatter.formatChatResponse(
          currentConversationId,
          resposta,
          [],
          { tipo: 'sem_resultado' }
        ));
      }

      const temApresentacao = analiseRelevancia.fragmentosRelevantes.some(f => 
        contextAnalyzer.isConteudoApresentacao(f)
      );

      const tagsApresentacao = temApresentacao 
        ? [...new Set(analiseRelevancia.fragmentosRelevantes.flatMap(f => f.metadados.tags || []))]
        : [];

      const documentosAgrupados = contextAnalyzer.agruparPorDocumento(
        analiseRelevancia.fragmentosRelevantes
      );

      // Sempre perguntar se houver múltiplos documentos
      if (documentosAgrupados.length > 1) {
        const opcoes = documentosAgrupados.map(doc => ({
          arquivo_url: doc.arquivo_url,
          arquivo_nome: doc.arquivo_nome,
          tipo: doc.tipo,
          fragmentos: doc.fragmentos,
          score_medio: doc.score_medio
        }));

        const topico = intentDetector.extrairTopicoDaMensagem(queryBusca).join(' ') || 'este assunto';
        const resposta = await ai.listarMateriaisParaEscolha(opcoes, topico, historico);

        conversationManager.setMateriaisPendentes(currentConversationId, opcoes, {
          mensagem_original: mensagem,
          query_usada: queryBusca
        });

        conversationManager.adicionarMensagem(
          currentConversationId,
          'assistant',
          resposta,
          [],
          { tipo: 'lista_materiais', total_opcoes: opcoes.length }
        );

        return res.json(ResponseFormatter.formatChatResponse(
          currentConversationId,
          resposta,
          [],
          { 
            tipo: 'lista_materiais',
            opcoes: opcoes.map((o, i) => ({
              numero: i + 1,
              nome: o.arquivo_nome,
              tipo: o.tipo
            }))
          }
        ));
      }

      // Resposta direta com um material
      const resposta = await ai.responderComContexto(
        mensagem,
        historico,
        analiseRelevancia.fragmentosRelevantes,
        preferencias
      );

      const documentosUsados = [...new Set(
        analiseRelevancia.fragmentosRelevantes.map(f => f.metadados.arquivo_url)
      )];
      conversationManager.registrarDocumentosApresentados(currentConversationId, documentosUsados);

      conversationManager.adicionarMensagem(
        currentConversationId,
        'assistant',
        resposta,
        analiseRelevancia.fragmentosRelevantes,
        { 
          tipo: 'consulta',
          foi_apresentacao: temApresentacao,
          tags_apresentacao: tagsApresentacao
        }
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

  // Rotas de gerenciamento de conversa
  router.get('/conversas/:conversationId', async (req, res) => {
    try {
      const { conversationId } = req.params;
      const conversa = conversationManager.getConversa(conversationId);
      if (!conversa) {
        return res.status(404).json(ResponseFormatter.formatError('Conversa não encontrada', 404));
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
        return res.status(400).json(ResponseFormatter.formatError('Preferências são obrigatórias', 400));
      }
      const atualizado = conversationManager.atualizarPreferencias(conversationId, preferencias);
      if (!atualizado) {
        return res.status(404).json(ResponseFormatter.formatError('Conversa não encontrada', 404));
      }
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
      if (!deletado) {
        return res.status(404).json(ResponseFormatter.formatError('Conversa não encontrada', 404));
      }
      res.json({ success: true, message: 'Conversa excluída' });
    } catch (error) {
      console.error('Erro ao excluir conversa:', error);
      res.status(500).json(ResponseFormatter.formatError(error.message));
    }
  });

  return router;
}