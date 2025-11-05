// routes/chatRoutes.js
import express from 'express';
import { ResponseFormatter } from '../utils/responseFormatter.js';
import { DialogueManager } from '../services/dialogueManager.js';
import { ContextAnalyzer } from '../services/contextAnalyzer.js';
import { DiscoveryService } from '../services/discoveryService.js';
import { SmartRanker } from '../services/smartRanker.js';

function mapearTiposParaAmigavel(tipos) {
  const m = {
    pdf: 'texto', docx: 'texto', doc: 'texto', txt: 'texto',
    mp4: 'vídeo', avi: 'vídeo', mkv: 'vídeo',
    png: 'imagem', jpg: 'imagem', jpeg: 'imagem', gif: 'imagem'
  };
  return Array.from(new Set(tipos.map(t => m[t.toLowerCase()] || t.toLowerCase())));
}

/**
 * Cria as rotas do chat.
 * @param {VectorSearchService} vectorSearch
 * @param {AIService} ai
 * @param {ConversationManager} conversationManager
 * @param {Db} db - Instância do MongoDB (mongo.db)
 * @param {IntentDetector} intentDetector - Já inicializado com init()
 */
export function createChatRoutes(vectorSearch, ai, conversationManager, db, intentDetector) {
  const router = express.Router();
  const dialogueManager = new DialogueManager(ai);
  const contextAnalyzer = new ContextAnalyzer();
  const discoveryService = new DiscoveryService({ db });
  const smartRanker = new SmartRanker();

  // --------------------------------------------------------------------- //
  // Helpers
  // --------------------------------------------------------------------- //
  function extrairEscolha(mensagem, maxOpcoes) {
    const lower = mensagem.toLowerCase().trim();
    const matchNum = lower.match(/\b(\d+)\b/);
    if (matchNum) {
      const n = parseInt(matchNum[1], 10);
      if (n >= 1 && n <= maxOpcoes) return n - 1;
    }
    const palavras = ['primeiro', 'segundo', 'terceiro', 'quarto', 'quinto'];
    for (let i = 0; i < Math.min(palavras.length, maxOpcoes); i++) {
      if (lower.includes(palavras[i])) return i;
    }
    return null;
  }

  // --------------------------------------------------------------------- //
  // POST /chat
  // --------------------------------------------------------------------- //
  router.post('/chat', async (req, res) => {
    try {
      const { mensagem, conversationId } = req.body;
      if (!mensagem?.trim()) {
        return res.status(400).json(ResponseFormatter.formatError('Mensagem é obrigatória', 400));
      }

      // --------------------------------------------------------------- //
      // 1. Gerencia conversa
      // --------------------------------------------------------------- //
      let cid = conversationId;
      if (!cid) cid = conversationManager.criarConversa();

      const preferencias = conversationManager.getPreferencias(cid) ?? {};
      const historico = conversationManager.getHistorico(cid, 7);
      const materiaisPendentes = conversationManager.getMateriaisPendentes(cid);

      // --------------------------------------------------------------- //
      // 2. Escolha de material (quando há múltiplos documentos)
      // --------------------------------------------------------------- //
      if (materiaisPendentes) {
        const escolha = extrairEscolha(mensagem, materiaisPendentes.opcoes.length);
        if (escolha !== null) {
          const escolhido = materiaisPendentes.opcoes[escolha];
          conversationManager.adicionarMensagem(cid, 'user', mensagem);

          const resposta = await ai.responderComContexto(
            materiaisPendentes.contexto?.mensagem_original ?? mensagem,
            historico,
            escolhido.fragmentos,
            preferencias
          );

          conversationManager.registrarDocumentosApresentados(cid, [escolhido.arquivo_url]);
          conversationManager.limparMateriaisPendentes(cid);

          conversationManager.adicionarMensagem(
            cid,
            'assistant',
            resposta,
            escolhido.fragmentos,
            { tipo: 'consulta', escolha_processada: true, material_escolhido: escolhido.arquivo_nome }
          );

          return res.json(
            ResponseFormatter.formatChatResponse(
              cid,
              resposta,
              escolhido.fragmentos,
              { tipo: 'consulta', escolha_processada: true }
            )
          );
        } else {
          // Escolha inválida → limpa pendentes
          conversationManager.limparMateriaisPendentes(cid);
        }
      }

      // --------------------------------------------------------------- //
      // 3. Registra mensagem do usuário
      // --------------------------------------------------------------- //
      conversationManager.adicionarMensagem(cid, 'user', mensagem);

      // --------------------------------------------------------------- //
      // 4. Detecta intenção (com tópicos dinâmicos do MongoDB)
      // --------------------------------------------------------------- //
      const deteccao = intentDetector.detectar(mensagem, { historico });

      // --------------------------------------------------------------- //
      // 5. INTENÇÕES ESPECÍFICAS
      // --------------------------------------------------------------- //

      // ----- CONFIRMAÇÃO (ex: "sim", "vamos") -----
      if (deteccao.intencao === 'confirmacao') {
        const ctx = intentDetector.verificarContextoAtivo(historico);
        if (ctx.temContexto && ctx.fragmentosPendentes?.length > 0) {
          const resposta = await ai.responderComContexto(mensagem, historico, ctx.fragmentosPendentes, preferencias);
          const docs = [...new Set(ctx.fragmentosPendentes.map(f => f.metadados.arquivo_url))];
          conversationManager.registrarDocumentosApresentados(cid, docs);
          conversationManager.adicionarMensagem(cid, 'assistant', resposta, ctx.fragmentosPendentes, { tipo: 'consulta', continuacao_confirmada: true });
          return res.json(ResponseFormatter.formatChatResponse(cid, resposta, ctx.fragmentosPendentes, { tipo: 'consulta' }));
        }
      }

      // ----- NÍVEL DE CONHECIMENTO (ex: "não conheço muito") -----
      if (deteccao.intencao === 'nivel_conhecimento') {
        const ctx = intentDetector.verificarContextoAtivo(historico);
        if (ctx.temContexto && ctx.fragmentosPendentes?.length > 0) {
          const nivel = mensagem.toLowerCase().includes('não') || mensagem.toLowerCase().includes('pouco') ? 'basico' : 'intermediario';
          const prefsAtualizadas = { ...preferencias, profundidade: nivel };
          conversationManager.atualizarPreferencias(cid, prefsAtualizadas);

          const resposta = await ai.responderComContexto(
            `Explicar do básico sobre ${ctx.topico}`,
            historico,
            ctx.fragmentosPendentes,
            prefsAtualizadas
          );

          const docs = [...new Set(ctx.fragmentosPendentes.map(f => f.metadados.arquivo_url))];
          conversationManager.registrarDocumentosApresentados(cid, docs);
          conversationManager.adicionarMensagem(cid, 'assistant', resposta, ctx.fragmentosPendentes, { tipo: 'consulta', nivel_adaptado: nivel });
          return res.json(ResponseFormatter.formatChatResponse(cid, resposta, ctx.fragmentosPendentes, { tipo: 'consulta' }));
        }
      }

      // ----- CASUAL (saudações, agradecimentos) -----
      if (deteccao.intencao === 'casual') {
        const resposta = await ai.conversarLivremente(
          mensagem,
          historico,
          `${ai.personaEdu}\n\nResponda de forma amigável. Convide a explorar materiais se for saudação.`
        );
        conversationManager.adicionarMensagem(cid, 'assistant', resposta, [], { tipo: 'casual' });
        return res.json(ResponseFormatter.formatChatResponse(cid, resposta, [], { tipo: 'casual' }));
      }

      // ----- DESCOBERTA (listar tópicos disponíveis) -----
      if (deteccao.intencao === 'descoberta') {
        const dados = await discoveryService.listarTopicosDisponiveis();
        const apresentacao = discoveryService.formatarParaApresentacao(dados);
        const tiposAmigaveis = apresentacao.estatisticas.tipos_material.map(t => ({
          tipo: mapearTiposParaAmigavel([t.tipo])[0],
          quantidade: t.quantidade
        }));
        const topicosAmigaveis = apresentacao.destaques.map(t => ({
          nome: t.nome,
          tipos_disponiveis: mapearTiposParaAmigavel(t.tipos_disponiveis),
          quantidade: t.quantidade
        }));

        const resposta = await ai.apresentarTopicos(topicosAmigaveis, tiposAmigaveis, historico);
        conversationManager.adicionarMensagem(cid, 'assistant', resposta, [], {
          tipo: 'descoberta',
          topicos: apresentacao.destaques,
          categorias: apresentacao.categorias
        });

        return res.json(
          ResponseFormatter.formatDiscoveryResponse(cid, resposta, apresentacao.destaques, tiposAmigaveis)
        );
      }

      // ----- INTERESSE EM TÓPICO (ex: "quero aprender html") -----
      if (deteccao.intencao === 'interesse_topico') {
        const termo = deteccao.metadados.termoBuscado;
        const info = await discoveryService.verificarSeEhTopicoConhecido(termo);
        if (info?.encontrado) {
          const tipos = mapearTiposParaAmigavel(info.tipos_material);
          const resposta = await ai.gerarEngajamentoTopico(info.topico, tipos, historico);
          conversationManager.adicionarMensagem(cid, 'assistant', resposta, [], { tipo: 'engajamento_topico', topico: info.topico });
          return res.json(ResponseFormatter.formatChatResponse(cid, resposta, [], { tipo: 'engajamento_topico' }));
        }
      }

      // ----- CONTINUAÇÃO (ex: "começar pelo básico") -----
      if (deteccao.intencao === 'continuacao') {
        const topicoContexto = deteccao.metadados.topico_contexto || '';
        const query = `${topicoContexto} básico introdução iniciante estrutura html`;
        const docsJaApresentados = conversationManager.getDocumentosApresentados(cid);

        let fragmentosBrutos = await vectorSearch.buscarFragmentosRelevantes(query, {}, 20);
        fragmentosBrutos = fragmentosBrutos.filter(f => !docsJaApresentados.includes(f.metadados.arquivo_url));

        if (fragmentosBrutos.length === 0) {
          const resposta = `Desculpe, não encontrei materiais introdutórios sobre ${topicoContexto}. Posso te ajudar com outro tópico?`;
          conversationManager.adicionarMensagem(cid, 'assistant', resposta, [], { tipo: 'sem_resultado' });
          return res.json(ResponseFormatter.formatChatResponse(cid, resposta, [], { tipo: 'sem_resultado' }));
        }

        let ranked = smartRanker.rankearPorQualidade(fragmentosBrutos, query);
        ranked = smartRanker.deduplicarConteudo(ranked);
        ranked = smartRanker.agruparChunksContiguos(ranked);
        const max = preferencias?.limiteFragmentos || 5;
        const finais = smartRanker.selecionarMelhores(ranked, max);
        const analise = contextAnalyzer.analisarRelevancia(finais, 0.55);

        if (!analise.temConteudoRelevante) {
          const resposta = `Não encontrei introdução suficiente sobre ${topicoContexto}. Que tal outro tema?`;
          conversationManager.adicionarMensagem(cid, 'assistant', resposta, [], { tipo: 'sem_resultado' });
          return res.json(ResponseFormatter.formatChatResponse(cid, resposta, [], { tipo: 'sem_resultado' }));
        }

        const resposta = await ai.responderComContexto(mensagem, historico, analise.fragmentosRelevantes, preferencias);
        const docsUsados = [...new Set(analise.fragmentosRelevantes.map(f => f.metadados.arquivo_url))];
        conversationManager.registrarDocumentosApresentados(cid, docsUsados);
        conversationManager.adicionarMensagem(cid, 'assistant', resposta, analise.fragmentosRelevantes, { tipo: 'consulta', continuacao: true });
        return res.json(ResponseFormatter.formatChatResponse(cid, resposta, analise.fragmentosRelevantes, { tipo: 'consulta' }));
      }

      // --------------------------------------------------------------- //
      // 6. CONSULTA PADRÃO (busca vetorial)
      // --------------------------------------------------------------- //
      let queryBusca = mensagem;
      if (deteccao.metadados?.usar_contexto_historico) {
        queryBusca = `${deteccao.metadados.topico_contexto} ${mensagem}`;
      }

      const tipoMidia = dialogueManager.detectarTipoMidiaSolicitado(mensagem);
      const docsJaApresentados = conversationManager.getDocumentosApresentados(cid);

      let fragmentosBrutos = await vectorSearch.buscarFragmentosRelevantes(
        queryBusca,
        { tipo: tipoMidia?.tipo, tiposSolicitados: tipoMidia?.filtros },
        20
      );
      fragmentosBrutos = fragmentosBrutos.filter(f => !docsJaApresentados.includes(f.metadados.arquivo_url));

      if (fragmentosBrutos.length === 0) {
        const resposta = `Desculpe, não encontrei materiais relevantes sobre "${mensagem}". Que tal perguntar "o que você pode me ensinar"?`;
        conversationManager.adicionarMensagem(cid, 'assistant', resposta, [], { tipo: 'sem_resultado' });
        return res.json(ResponseFormatter.formatChatResponse(cid, resposta, [], { tipo: 'sem_resultado' }));
      }

      let ranked = smartRanker.rankearPorQualidade(fragmentosBrutos, queryBusca);
      ranked = smartRanker.deduplicarConteudo(ranked);
      ranked = smartRanker.agruparChunksContiguos(ranked);
      const max = preferencias?.limiteFragmentos || 5;
      const finais = smartRanker.selecionarMelhores(ranked, max);

      const threshold = tipoMidia ? 0.40 : (deteccao.metadados?.pos_apresentacao ? 0.30 : 0.65);
      const analise = contextAnalyzer.analisarRelevancia(finais, threshold);

      if (!analise.temConteudoRelevante) {
        const resposta = `Não encontrei conteúdo suficiente sobre "${mensagem}". Posso te ajudar com outro tema!`;
        conversationManager.adicionarMensagem(cid, 'assistant', resposta, [], { tipo: 'sem_resultado' });
        return res.json(ResponseFormatter.formatChatResponse(cid, resposta, [], { tipo: 'sem_resultado' }));
      }

      // Múltiplos documentos → lista de escolha
      const docsAgrupados = contextAnalyzer.agruparPorDocumento(analise.fragmentosRelevantes);
      if (docsAgrupados.length > 1) {
        const opcoes = docsAgrupados.map(doc => ({
          arquivo_url: doc.arquivo_url,
          arquivo_nome: doc.arquivo_nome,
          tipo: doc.tipo,
          fragmentos: doc.fragmentos,
          score_medio: doc.score_medio
        }));
        const topico = intentDetector.extrairTopicoDaMensagem(queryBusca).join(' ') || 'este assunto';
        const resposta = await ai.listarMateriaisParaEscolha(opcoes, topico, historico);

        conversationManager.setMateriaisPendentes(cid, opcoes, { mensagem_original: mensagem, query_usada: queryBusca });
        conversationManager.adicionarMensagem(cid, 'assistant', resposta, [], { tipo: 'lista_materiais', total_opcoes: opcoes.length });

        const opcoesFormatadas = opcoes.map((o, i) => ({
          numero: i + 1,
          nome: o.arquivo_nome,
          tipo: o.tipo
        }));

        return res.json(
          ResponseFormatter.formatChatResponse(cid, resposta, [], { tipo: 'lista_materiais', opcoes: opcoesFormatadas })
        );
      }

      // Resposta direta (único documento)
      const resposta = await ai.responderComContexto(mensagem, historico, analise.fragmentosRelevantes, preferencias);
      const docsUsados = [...new Set(analise.fragmentosRelevantes.map(f => f.metadados.arquivo_url))];
      conversationManager.registrarDocumentosApresentados(cid, docsUsados);
      conversationManager.adicionarMensagem(cid, 'assistant', resposta, analise.fragmentosRelevantes, { tipo: 'consulta' });

      return res.json(
        ResponseFormatter.formatChatResponse(cid, resposta, analise.fragmentosRelevantes, {
          tipo: 'consulta',
          scoreMaximo: analise.scoreMaximo
        })
      );

    } catch (error) {
      console.error('Erro em /chat:', error);
      return res.status(500).json(ResponseFormatter.formatError('Erro interno do servidor'));
    }
  });

  // --------------------------------------------------------------------- //
  // Rotas de gerenciamento de conversa (GET, PUT, DELETE)
  // --------------------------------------------------------------------- //
  router.get('/conversas/:conversationId', (req, res) => {
    try {
      const { conversationId } = req.params;
      const conversa = conversationManager.getConversa(conversationId);
      if (!conversa) return res.status(404).json(ResponseFormatter.formatError('Conversa não encontrada', 404));
      res.json(ResponseFormatter.formatConversationResponse(conversa));
    } catch (err) {
      console.error('Erro ao buscar conversa:', err);
      res.status(500).json(ResponseFormatter.formatError('Erro interno'));
    }
  });

  router.put('/conversas/:conversationId/preferencias', (req, res) => {
    try {
      const { conversationId } = req.params;
      const { preferencias } = req.body;
      if (!preferencias) return res.status(400).json(ResponseFormatter.formatError('Preferências são obrigatórias', 400));
      const atualizado = conversationManager.atualizarPreferencias(conversationId, preferencias);
      if (!atualizado) return res.status(404).json(ResponseFormatter.formatError('Conversa não encontrada', 404));
      const novas = conversationManager.getPreferencias(conversationId);
      res.json({ success: true, preferencias: novas });
    } catch (err) {
      console.error('Erro ao atualizar preferências:', err);
      res.status(500).json(ResponseFormatter.formatError('Erro interno'));
    }
  });

  router.delete('/conversas/:conversationId', (req, res) => {
    try {
      const { conversationId } = req.params;
      const deletado = conversationManager.limparConversa(conversationId);
      if (!deletado) return res.status(404).json(ResponseFormatter.formatError('Conversa não encontrada', 404));
      res.json({ success: true, message: 'Conversa excluída' });
    } catch (err) {
      console.error('Erro ao excluir conversa:', err);
      res.status(500).json(ResponseFormatter.formatError('Erro interno'));
    }
  });

  return router;
}