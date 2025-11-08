// routes/chatRoutes.js
import express from 'express';
import { ResponseFormatter } from '../utils/responseFormatter.js';
import { DialogueManager } from '../services/dialogueManager.js';
import { ContextAnalyzer } from '../services/contextAnalyzer.js';
import { IntentAnalyzer } from '../services/intentAnalyzer.js';
import { DiscoveryService } from '../services/discoveryService.js';
import { SmartRanker } from '../services/smartRanker.js';
import { TopicValidator } from '../services/topicValidator.js';

function extrairEscolha(mensagem, maxOpcoes) {
  const lower = mensagem.toLowerCase().trim();
  const match = lower.match(/\b(\d+)\b/);
  if (match) {
    const numero = parseInt(match[1]);
    if (numero >= 1 && numero <= maxOpcoes) return numero - 1;
  }
  const opcoes = ['primeiro', 'segunda', 'terceiro', 'quarto', 'quinto'];
  for (let i = 0; i < Math.min(opcoes.length, maxOpcoes); i++) {
    if (lower.includes(opcoes[i])) return i;
  }
  return null;
}

async function iniciarConversaComSaudacao(conversationManager, conversationId, ai) {
  let currentConversationId = conversationId;

  if (!currentConversationId) {
    currentConversationId = conversationManager.criarConversa();
  }

  const conversa = conversationManager.getConversa(currentConversationId);
  const temSaudacao = conversa.mensagens.some(msg =>
    msg.role === 'assistant' && msg.metadata?.tipo === 'boas_vindas'
  );

  if (!temSaudacao) {
    const mensagemBoasVindas = `Olá! 👋 Sou o Edu, seu assistente educacional.

Trabalho com materiais didáticos específicos do banco de dados. Posso:

📚 Mostrar quais tópicos tenho disponíveis
💡 Explicar conteúdos usando os materiais
🎯 Adaptar as explicações ao seu ritmo

Pergunte "o que você ensina?" para ver os tópicos disponíveis, ou faça sua pergunta diretamente!`;

    conversationManager.adicionarMensagem(
      currentConversationId,
      'assistant',
      mensagemBoasVindas,
      [],
      {
        tipo: 'boas_vindas',
        primeira_interacao: true
      }
    );
  }

  return currentConversationId;
}

export function createChatRoutes(vectorSearch, ai, conversationManager, mongo) {
  const router = express.Router();
  const dialogueManager = new DialogueManager(ai);
  const contextAnalyzer = new ContextAnalyzer();
  const intentAnalyzer = new IntentAnalyzer(ai);
  const discoveryService = new DiscoveryService(mongo);
  const smartRanker = new SmartRanker();
  const topicValidator = new TopicValidator(mongo, discoveryService);

  conversationManager.mongo = mongo;
  conversationManager.vectorSearch = vectorSearch;
  conversationManager.ai = ai;

  router.post('/chat', async (req, res) => {
    let currentConversationId;

    try {
      const { mensagem, conversationId } = req.body;
      if (!mensagem) return res.status(400).json(ResponseFormatter.formatError('Mensagem é obrigatória', 400));

      currentConversationId = conversationId;

      currentConversationId = await iniciarConversaComSaudacao(conversationManager, currentConversationId, ai);

      const contextoCompleto = conversationManager.getContextoCompleto(currentConversationId);
      const preferencias = conversationManager.getPreferencias(currentConversationId);

      // Adicionar materiais pendentes ao contexto conversacional
      const materiaisPendentes = conversationManager.getMateriaisPendentes(currentConversationId);
      if (materiaisPendentes && contextoCompleto.contextoConversacional) {
        contextoCompleto.contextoConversacional.materiaisPendentes = materiaisPendentes.opcoes;
      }

      if (materiaisPendentes) {
        const escolha = extrairEscolha(mensagem, materiaisPendentes.opcoes.length);
        if (escolha !== null && escolha >= 0 && escolha < materiaisPendentes.opcoes.length) {
          const materialEscolhido = materiaisPendentes.opcoes[escolha];
          conversationManager.adicionarMensagem(currentConversationId, 'user', mensagem);

          const resposta = await ai.responderComContexto(
            materiaisPendentes.contexto.mensagem_original || mensagem,
            contextoCompleto.historico,
            materialEscolhido.fragmentos,
            preferencias
          );

          const documentosUsados = [materialEscolhido.arquivo_url];
          conversationManager.registrarDocumentosApresentados(currentConversationId, documentosUsados);
          conversationManager.limparMateriaisPendentes(currentConversationId);

          conversationManager.atualizarContextoConversacional(
            currentConversationId,
            mensagem,
            resposta,
            'escolha_material',
            { tipo: 'consulta' }
          );

          conversationManager.adicionarMensagem(
            currentConversationId,
            'assistant',
            resposta,
            materialEscolhido.fragmentos,
            { tipo: 'consulta', intencaoDetectada: 'escolha_material' }
          );

          return res.json(ResponseFormatter.formatChatResponse(
            currentConversationId,
            resposta,
            materialEscolhido.fragmentos,
            { tipo: 'consulta' }
          ));
        } else {
          conversationManager.limparMateriaisPendentes(currentConversationId);
        }
      }

      conversationManager.adicionarMensagem(currentConversationId, 'user', mensagem);

      const deteccaoIntencao = await intentAnalyzer.analisarComIA(mensagem, contextoCompleto);

      if (deteccaoIntencao.intencao === 'casual') {
        const resposta = await ai.conversarLivremente(mensagem, contextoCompleto.historico);

        conversationManager.atualizarContextoConversacional(
          currentConversationId,
          mensagem,
          resposta,
          'casual',
          { tipo: 'casual' }
        );

        conversationManager.adicionarMensagem(
          currentConversationId,
          'assistant',
          resposta,
          [],
          { tipo: 'casual', intencaoDetectada: 'casual', ia_metadata: deteccaoIntencao.metadados }
        );

        return res.json(ResponseFormatter.formatChatResponse(
          currentConversationId,
          resposta,
          [],
          { tipo: 'casual' }
        ));
      }

      if (deteccaoIntencao.intencao === 'descoberta') {
        const dadosDisponiveis = await discoveryService.listarTopicosDisponiveis();
        const apresentacao = discoveryService.formatarParaApresentacao(dadosDisponiveis);
        
        const tiposMaterialAmigaveis = apresentacao.estatisticas.tipos_material.map(t => ({
          tipo: t.tipo,
          quantidade: t.quantidade
        }));

        const resposta = await ai.apresentarTopicos(
          apresentacao.destaques, 
          tiposMaterialAmigaveis, 
          contextoCompleto.historico
        );

        conversationManager.atualizarContextoConversacional(
          currentConversationId,
          mensagem,
          resposta,
          'descoberta',
          { tipo: 'descoberta', topicos: apresentacao.destaques }
        );

        conversationManager.adicionarMensagem(
          currentConversationId,
          'assistant',
          resposta,
          [],
          { tipo: 'descoberta', intencaoDetectada: 'descoberta', ia_metadata: deteccaoIntencao.metadados }
        );

        return res.json(ResponseFormatter.formatDiscoveryResponse(
          currentConversationId,
          resposta,
          apresentacao.destaques,
          tiposMaterialAmigaveis
        ));
      }

      if (deteccaoIntencao.intencao === 'consulta') {
        const topicoExtraido = deteccaoIntencao.metadados?.topico_mencionado;
        
        const validacao = await topicValidator.validarExistenciaConteudo(
          mensagem, 
          'consulta',
          topicoExtraido
        );

        if (!validacao.temConteudo) {
          const topicoUsado = topicoExtraido || mensagem;
          const resposta = `Não encontrei materiais sobre "${topicoUsado}" no banco de dados.

Os tópicos disponíveis são: ${validacao.sugestoes.join(', ')}.

Sobre qual destes você gostaria de aprender?`;

          conversationManager.atualizarContextoConversacional(
            currentConversationId,
            mensagem,
            resposta,
            'consulta',
            { tipo: 'sem_conteudo' }
          );

          conversationManager.adicionarMensagem(
            currentConversationId,
            'assistant',
            resposta,
            [],
            { tipo: 'sem_conteudo', sugestoes: validacao.sugestoes, intencaoDetectada: 'consulta', ia_metadata: deteccaoIntencao.metadados }
          );

          return res.json(ResponseFormatter.formatChatResponse(
            currentConversationId,
            resposta,
            [],
            { tipo: 'sem_conteudo', sugestoes: validacao.sugestoes }
          ));
        }

        const tipoMidiaSolicitado = deteccaoIntencao.metadados?.tipo_material_solicitado 
          ? { tipo: deteccaoIntencao.metadados.tipo_material_solicitado, filtros: [deteccaoIntencao.metadados.tipo_material_solicitado] }
          : dialogueManager.detectarTipoMidiaSolicitado(mensagem);

        const documentosApresentados = conversationManager.getDocumentosApresentados(currentConversationId);

        const queryParaBusca = topicoExtraido || mensagem;

        let fragmentosBrutos = await vectorSearch.buscarFragmentosRelevantes(
          mensagem,
          { tipo: tipoMidiaSolicitado?.tipo, tiposSolicitados: tipoMidiaSolicitado?.filtros },
          20,
          queryParaBusca
        );

        fragmentosBrutos = fragmentosBrutos.filter(f => 
          !documentosApresentados.includes(f.metadados.arquivo_url)
        );

        if (fragmentosBrutos.length === 0) {
          const topicoUsado = topicoExtraido || mensagem;
          const resposta = `Não encontrei mais materiais sobre "${topicoUsado}". Já apresentei todo o conteúdo disponível sobre esse tema. Posso ajudar com outro tópico?`;

          conversationManager.atualizarContextoConversacional(
            currentConversationId,
            mensagem,
            resposta,
            'consulta',
            { tipo: 'sem_resultado' }
          );

          conversationManager.adicionarMensagem(
            currentConversationId,
            'assistant',
            resposta,
            [],
            { tipo: 'sem_resultado', intencaoDetectada: 'consulta', ia_metadata: deteccaoIntencao.metadados }
          );

          return res.json(ResponseFormatter.formatChatResponse(
            currentConversationId,
            resposta,
            [],
            { tipo: 'sem_resultado' }
          ));
        }

        let fragmentosRankeados = smartRanker.rankearPorQualidade(fragmentosBrutos, queryParaBusca);
        fragmentosRankeados = smartRanker.deduplicarConteudo(fragmentosRankeados);
        fragmentosRankeados = smartRanker.agruparChunksContiguos(fragmentosRankeados);
        
        const maxFragmentos = preferencias?.limiteFragmentos || 5;
        let fragmentosFinais = smartRanker.selecionarMelhores(fragmentosRankeados, maxFragmentos);

        const analiseRelevancia = contextAnalyzer.analisarRelevancia(fragmentosFinais, 0.40);

        if (!analiseRelevancia.temConteudoRelevante) {
          const topicoUsado = topicoExtraido || mensagem;
          const resposta = `Os materiais que encontrei não são suficientemente relevantes para "${topicoUsado}". 

Tente reformular sua pergunta ou pergunte "o que você ensina?" para ver os tópicos disponíveis.`;

          conversationManager.atualizarContextoConversacional(
            currentConversationId,
            mensagem,
            resposta,
            'consulta',
            { tipo: 'baixa_relevancia' }
          );

          conversationManager.adicionarMensagem(
            currentConversationId,
            'assistant',
            resposta,
            [],
            { tipo: 'baixa_relevancia', intencaoDetectada: 'consulta', ia_metadata: deteccaoIntencao.metadados }
          );

          return res.json(ResponseFormatter.formatChatResponse(
            currentConversationId,
            resposta,
            [],
            { tipo: 'baixa_relevancia' }
          ));
        }

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

          conversationManager.setMateriaisPendentes(currentConversationId, opcoes, {
            mensagem_original: mensagem
          });

          conversationManager.atualizarContextoConversacional(
            currentConversationId,
            mensagem,
            resposta,
            'consulta',
            { tipo: 'lista_materiais', aguardando_escolha: true }
          );

          conversationManager.adicionarMensagem(
            currentConversationId,
            'assistant',
            resposta,
            [],
            { tipo: 'lista_materiais', intencaoDetectada: 'consulta', ia_metadata: deteccaoIntencao.metadados }
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

        try {
          const resposta = await ai.responderComContexto(
            mensagem,
            contextoCompleto.historico,
            analiseRelevancia.fragmentosRelevantes,
            preferencias
          );

          const documentosUsados = [...new Set(analiseRelevancia.fragmentosRelevantes.map(f => f.metadados.arquivo_url))];
          conversationManager.registrarDocumentosApresentados(currentConversationId, documentosUsados);

          conversationManager.atualizarContextoConversacional(
            currentConversationId,
            mensagem,
            resposta,
            'consulta',
            { tipo: 'consulta' }
          );

          conversationManager.adicionarMensagem(
            currentConversationId,
            'assistant',
            resposta,
            analiseRelevancia.fragmentosRelevantes,
            { tipo: 'consulta', intencaoDetectada: 'consulta', ia_metadata: deteccaoIntencao.metadados }
          );

          return res.json(ResponseFormatter.formatChatResponse(
            currentConversationId,
            resposta,
            analiseRelevancia.fragmentosRelevantes,
            { tipo: 'consulta' }
          ));
        } catch (error) {
          const resposta = `Desculpe, não consegui processar os materiais encontrados. Tente reformular sua pergunta.`;

          conversationManager.adicionarMensagem(
            currentConversationId,
            'assistant',
            resposta,
            [],
            { tipo: 'erro', intencaoDetectada: 'consulta', ia_metadata: deteccaoIntencao.metadados }
          );

          return res.json(ResponseFormatter.formatChatResponse(
            currentConversationId,
            resposta,
            [],
            { tipo: 'erro' }
          ));
        }
      }

      const resposta = 'Desculpe, não entendi. Pode reformular?';
      conversationManager.adicionarMensagem(
        currentConversationId,
        'assistant',
        resposta,
        [],
        { tipo: 'fallback' }
      );

      return res.json(ResponseFormatter.formatChatResponse(
        currentConversationId,
        resposta,
        [],
        { tipo: 'fallback' }
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