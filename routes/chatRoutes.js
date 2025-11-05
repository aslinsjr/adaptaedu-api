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

  // Função auxiliar para extrair escolha numérica
  function extrairEscolha(mensagem, maxOpcoes) {
    const lower = mensagem.toLowerCase().trim();
    
    // Procura por números
    const match = lower.match(/\b(\d+)\b/);
    if (match) {
      const numero = parseInt(match[1]);
      if (numero >= 1 && numero <= maxOpcoes) {
        return numero - 1; // Retorna índice (0-based)
      }
    }

    // Procura por palavras-chave de escolha
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

      // Cria ou recupera conversa
      if (currentConversationId) {
        preferencias = conversationManager.getPreferencias(currentConversationId);
      }

      if (!preferencias) {
        currentConversationId = conversationManager.criarConversa();
        preferencias = conversationManager.getPreferencias(currentConversationId);
      }

      const historico = conversationManager.getHistorico(currentConversationId, 5);

      // Verifica se há materiais pendentes de escolha
      const materiaisPendentes = conversationManager.getMateriaisPendentes(currentConversationId);
      
      if (materiaisPendentes) {
        // Processa escolha do usuário
        const escolha = this.extrairEscolha(mensagem, materiaisPendentes.opcoes.length);
        
        if (escolha !== null && escolha >= 0 && escolha < materiaisPendentes.opcoes.length) {
          const materialEscolhido = materiaisPendentes.opcoes[escolha];
          
          conversationManager.adicionarMensagem(currentConversationId, 'user', mensagem);
          
          // Responde com o material escolhido
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
          // Escolha inválida - limpa pendentes e continua fluxo normal
          conversationManager.limparMateriaisPendentes(currentConversationId);
        }
      }

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
        const ultimaFoiApresentacao = conversationManager.ultimaRespostaFoiApresentacao(currentConversationId);
        
        if (ultimaFoiApresentacao) {
          // Continuação após apresentação: busca conteúdo real usando tags
          const tagsApresentacao = conversationManager.getTagsApresentacao(currentConversationId);
          
          deteccaoIntencao.intencao = 'consulta';
          deteccaoIntencao.metadados.pos_apresentacao = true;
          deteccaoIntencao.metadados.tags_busca = tagsApresentacao;
          deteccaoIntencao.metadados.query_enriquecida = tagsApresentacao.join(' ');
        } else {
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
      }

      // CONSULTA COM SMART RANKER
      const preferenciasImplicitas = dialogueManager.detectarPreferenciaImplicita(mensagem);
      if (preferenciasImplicitas) {
        conversationManager.atualizarPreferencias(currentConversationId, preferenciasImplicitas);
        preferencias = conversationManager.getPreferencias(currentConversationId);
      }

      // Detecta se usuário solicita tipo específico de mídia
      const tipoMidiaSolicitado = dialogueManager.detectarTipoMidiaSolicitado(mensagem);

      const filtros = {};
      
      // Prioriza tipo de mídia solicitado explicitamente
      if (tipoMidiaSolicitado) {
        filtros.tiposSolicitados = tipoMidiaSolicitado.filtros;
      } else if (preferencias.tiposMaterialPreferidos?.length > 0) {
        filtros.tipo = preferencias.tiposMaterialPreferidos[0];
      }

      // Se pós-apresentação, usa tags da apresentação
      if (deteccaoIntencao.metadados.pos_apresentacao && deteccaoIntencao.metadados.tags_busca?.length > 0) {
        filtros.tags = deteccaoIntencao.metadados.tags_busca;
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
        const termosPesquisados = topicosExtraidos.join(', ');
        
        let mensagemTipo = '';
        if (tipoMidiaSolicitado) {
          mensagemTipo = `do tipo "${tipoMidiaSolicitado.tipo}" `;
        }
        
        const sugestaoContexto = `INSTRUÇÃO CRÍTICA: Você NÃO possui materiais didáticos ${mensagemTipo}sobre "${termosPesquisados || mensagem}".

PROIBIDO:
- Responder com seu conhecimento próprio
- Explicar o conceito
- Dar exemplos do seu conhecimento
- Ensinar sobre o assunto

OBRIGATÓRIO:
- Informar que não há material ${mensagemTipo}disponível sobre este tópico
- Ser direto e honesto
- Sugerir que o usuário explore outros tópicos ou tipos de material perguntando "o que você pode me ensinar"

Responda de forma breve e natural.`;

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

      // 2.5. Penaliza documentos já apresentados (exceto pós-apresentação)
      const documentosApresentados = conversationManager.getDocumentosApresentados(currentConversationId);
      const posApresentacao = deteccaoIntencao.metadados.pos_apresentacao || false;
      
      const fragmentosComPenalidade = posApresentacao 
        ? fragmentosRankeados // Ignora penalidade após apresentação
        : smartRanker.aplicarPenalidadeRepeticao(fragmentosRankeados, documentosApresentados);

      // 3. Agrupamento de contíguos
      const fragmentosAgrupados = smartRanker.agruparChunksContiguos(
        fragmentosComPenalidade
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

      // 6. Análise de relevância - threshold ajustado
      let thresholdRelevancia = 0.65;
      if (tipoMidiaSolicitado) {
        thresholdRelevancia = 0.40;
      } else if (deteccaoIntencao.metadados.pos_apresentacao) {
        thresholdRelevancia = 0.30; // Mais permissivo após apresentação
      }
      
      const analiseRelevancia = contextAnalyzer.analisarRelevancia(
        fragmentosFinais, 
        thresholdRelevancia
      );

      if (!analiseRelevancia.temConteudoRelevante) {
        const topicosExtraidos = intentDetector.extrairTopicoDaMensagem(queryBusca);
        const termosPesquisados = topicosExtraidos.join(', ');
        
        const sugestaoContexto = `INSTRUÇÃO CRÍTICA: Você NÃO possui materiais didáticos relevantes sobre "${termosPesquisados || mensagem}".

PROIBIDO:
- Responder com seu conhecimento próprio
- Explicar o conceito
- Dar exemplos do seu conhecimento
- Ensinar sobre o assunto

OBRIGATÓRIO:
- Informar que não há material suficientemente relevante sobre este tópico
- Ser direto e honesto
- Sugerir que o usuário explore outros tópicos disponíveis perguntando "o que você pode me ensinar"

Responda de forma breve e natural.`;

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

      // Verifica se há conteúdo de apresentação
      const temApresentacao = analiseRelevancia.fragmentosRelevantes.some(f => 
        contextAnalyzer.isConteudoApresentacao(f)
      );

      // Extrai tags se for apresentação
      const tagsApresentacao = temApresentacao 
        ? [...new Set(analiseRelevancia.fragmentosRelevantes.flatMap(f => f.metadados.tags || []))]
        : [];

      // Agrupa fragmentos por documento
      const documentosAgrupados = contextAnalyzer.agruparPorDocumento(
        analiseRelevancia.fragmentosRelevantes
      );

      // Se há múltiplos documentos (exceto se for apenas apresentação), pergunta preferência
      if (documentosAgrupados.length > 1 && !temApresentacao) {
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

        conversationManager.adicionarMensagem(currentConversationId, 'user', mensagem);
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

      // 7. Resposta com contexto enriquecido
      const resposta = await ai.responderComContexto(
        mensagem,
        historico,
        analiseRelevancia.fragmentosRelevantes,
        preferencias
      );

      // Registra documentos apresentados
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