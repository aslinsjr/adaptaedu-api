// routes/chatRoutes.js
import express from 'express';
import { ResponseFormatter } from '../utils/responseFormatter.js';
import { DialogueManager } from '../services/dialogueManager.js';
import { ContextAnalyzer } from '../services/contextAnalyzer.js';
import { IntentDetector } from '../services/intentDetector.js';
import { DiscoveryService } from '../services/discoveryService.js';
import { SmartRanker } from '../services/smartRanker.js';
import { TopicValidator } from '../services/topicValidator.js';

function mapearTiposParaAmigavel(tipos) {
  const mapeamento = {
    'pdf': 'texto', 'docx': 'texto', 'doc': 'texto', 'txt': 'texto',
    'video': 'vídeo', 'mp4': 'vídeo', 'avi': 'vídeo', 'mkv': 'vídeo',
    'imagem': 'imagem', 'image': 'imagem', 'png': 'imagem', 'jpg': 'imagem', 'jpeg': 'imagem', 'gif': 'imagem'
  };
  const tiposAmigaveis = new Set();
  for (const tipo of tipos) {
    const tipoLower = tipo.toLowerCase();
    const tipoAmigavel = mapeamento[tipoLower] || tipoLower;
    tiposAmigaveis.add(tipoAmigavel);
  }
  return Array.from(tiposAmigaveis);
}

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

// FUNÇÃO PARA INICIAR CONVERSA COM SAUDAÇÃO DO EDU
async function iniciarConversaComSaudacao(conversationManager, conversationId, ai) {
  let currentConversationId = conversationId;

  if (!currentConversationId) {
    currentConversationId = conversationManager.criarConversa();
  }

  // Verificar se já tem a mensagem de boas-vindas
  const conversa = conversationManager.getConversa(currentConversationId);
  const temSaudacao = conversa.mensagens.some(msg =>
    msg.role === 'assistant' && msg.metadata?.tipo === 'boas_vindas'
  );

  if (!temSaudacao) {
    const mensagemBoasVindas = `Olá! 👋 Sou o Edu, seu assistente educacional inteligente!

Estou aqui para ajudar você a aprender de forma personalizada e interativa. Posso:

💡 Responder suas dúvidas sobre diversos assuntos
📚 Fornecer materiais didáticos relevantes
🎯 Adaptar as explicações ao seu nível de conhecimento

Como posso te ajudar hoje? Pode fazer qualquer pergunta ou me dizer sobre o que você gostaria de aprender!`;

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

    // Inicializar contexto conversacional
    const contexto = conversationManager.contextos.get(currentConversationId);
    if (contexto) {
      contexto.fluxoAtivo = 'inicial';
      contexto.aguardandoResposta = 'primeira_mensagem';
    }
  }

  return currentConversationId;
}

// FUNÇÃO PARA PROCESSAR PRIMEIRA RESPOSTA DO USUÁRIO
async function processarPrimeiraRespostaUsuario(mensagem, conversationId, conversationManager, ai, vectorSearch, contextoCompleto) {
  const intentDetector = new IntentDetector();
  const smartRanker = new SmartRanker();
  const dialogueManager = new DialogueManager(ai);
  const contextAnalyzer = new ContextAnalyzer();

  const deteccaoIntencao = intentDetector.detectar(mensagem, contextoCompleto);

  // Detectar preferências implícitas na primeira mensagem
  const preferenciasDetectadas = dialogueManager.detectarPreferenciaImplicita(mensagem);
  if (preferenciasDetectadas) {
    conversationManager.atualizarPreferencias(conversationId, preferenciasDetectadas);
  }

  let resposta = '';
  let fragmentos = [];
  let metadata = {
    tipo: 'resposta',
    primeira_resposta: true,
    intencaoDetectada: deteccaoIntencao.intencao
  };

  // PROCESSAR BASEADO NA INTENÇÃO DETECTADA
  switch (deteccaoIntencao.intencao) {
    case 'casual':
      resposta = await ai.conversarLivremente(
        mensagem,
        contextoCompleto.historico,
        `${ai.personaEdu}\n\nO usuário acabou de responder à sua saudação inicial. Responda de forma natural e convide para fazer perguntas específicas.`
      );
      metadata.tipo = 'engajamento';
      break;

    case 'descoberta':
      const discoveryService = new DiscoveryService(conversationManager.mongo);
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

      resposta = await ai.apresentarTopicos(topicosComTiposAmigaveis, tiposMaterialAmigaveis, contextoCompleto.historico);
      metadata.tipo = 'descoberta';
      metadata.topicos = apresentacao.destaques;
      break;

    case 'interesse_topico':
      const termoBuscado = deteccaoIntencao.metadados.termoBuscado;
      const discovery = new DiscoveryService(conversationManager.mongo);
      const topicoInfo = await discovery.verificarSeEhTopicoConhecido(termoBuscado);

      if (topicoInfo && topicoInfo.encontrado) {
        // Buscar conteúdo introdutório sobre o tópico
        const queryIntroducao = `${topicoInfo.topico} introdução apresentação conceitos básicos o que é`;
        
        let fragmentosBrutos = await vectorSearch.buscarFragmentosRelevantes(
          queryIntroducao,
          {},
          15
        );

        if (fragmentosBrutos.length > 0) {
          // Priorizar conteúdo introdutório
          let fragmentosRankeados = smartRanker.rankearPorQualidade(fragmentosBrutos, queryIntroducao);
          
          // Filtrar e priorizar conteúdo de apresentação
          const fragmentosApresentacao = fragmentosRankeados.filter(f => 
            contextAnalyzer.isConteudoApresentacao(f)
          );
          
          const fragmentosExplicativos = fragmentosRankeados.filter(f => 
            !contextAnalyzer.isConteudoApresentacao(f)
          );

          // Mesclar: apresentação primeiro, depois explicativos
          fragmentosRankeados = [...fragmentosApresentacao, ...fragmentosExplicativos];
          fragmentosRankeados = smartRanker.deduplicarConteudo(fragmentosRankeados);
          fragmentos = smartRanker.selecionarMelhores(fragmentosRankeados, 5);

          const analiseRelevancia = contextAnalyzer.analisarRelevancia(fragmentos, 0.5);

          if (analiseRelevancia.temConteudoRelevante) {
            // Gerar explicação inicial com os fragmentos
            const promptIntroducao = `Apresente uma introdução clara e didática sobre ${topicoInfo.topico}. Comece explicando o que é, para que serve e sua importância. Ao final, pergunte se o usuário quer se aprofundar em algum aspecto específico.`;
            
            resposta = await ai.responderComContexto(
              promptIntroducao,
              contextoCompleto.historico,
              analiseRelevancia.fragmentosRelevantes,
              conversationManager.getPreferencias(conversationId)
            );
            
            metadata.tipo = 'consulta';
            metadata.topico = topicoInfo.topico;
            metadata.introducao = true;
            fragmentos = analiseRelevancia.fragmentosRelevantes;
          } else {
            // Fallback: engajamento se não houver conteúdo relevante
            const tiposAmigaveis = mapearTiposParaAmigavel(topicoInfo.tipos_material);
            resposta = await ai.gerarEngajamentoTopico(topicoInfo.topico, tiposAmigaveis, contextoCompleto.historico);
            metadata.tipo = 'engajamento_topico';
            metadata.topico = topicoInfo.topico;
          }
        } else {
          // Sem fragmentos: engajamento padrão
          const tiposAmigaveis = mapearTiposParaAmigavel(topicoInfo.tipos_material);
          resposta = await ai.gerarEngajamentoTopico(topicoInfo.topico, tiposAmigaveis, contextoCompleto.historico);
          metadata.tipo = 'engajamento_topico';
          metadata.topico = topicoInfo.topico;
        }
      } else {
        resposta = `Interessante! Você quer aprender sobre "${termoBuscado}". Vou buscar materiais sobre isso para você. O que especificamente gostaria de saber?`;
        metadata.tipo = 'consulta';
      }
      break;

    default:
      // CONSULTA NORMAL - Buscar materiais relevantes
      const tipoMidiaSolicitado = dialogueManager.detectarTipoMidiaSolicitado(mensagem);

      let fragmentosBrutos = await vectorSearch.buscarFragmentosRelevantes(
        mensagem,
        { tipo: tipoMidiaSolicitado?.tipo, tiposSolicitados: tipoMidiaSolicitado?.filtros },
        15
      );

      if (fragmentosBrutos.length > 0) {
        let fragmentosRankeados = smartRanker.rankearPorQualidade(fragmentosBrutos, mensagem);
        fragmentosRankeados = smartRanker.deduplicarConteudo(fragmentosRankeados);
        fragmentos = smartRanker.selecionarMelhores(fragmentosRankeados, 5);

        const analiseRelevancia = contextAnalyzer.analisarRelevancia(fragmentos, 0.6);

        if (analiseRelevancia.temConteudoRelevante) {
          resposta = await ai.responderComContexto(
            mensagem,
            contextoCompleto.historico,
            analiseRelevancia.fragmentosRelevantes,
            conversationManager.getPreferencias(conversationId)
          );
          metadata.tipo = 'consulta';
          fragmentos = analiseRelevancia.fragmentosRelevantes;
        } else {
          resposta = `Perfeito! Você quer saber sobre "${mensagem}". Encontrei alguns materiais, mas preciso entender melhor o que exatamente você gostaria de aprender. Pode me dar mais detalhes?`;
          metadata.tipo = 'esclarecimento';
        }
      } else {
        resposta = `Entendi seu interesse em "${mensagem}"! No momento não encontrei materiais específicos sobre isso, mas posso te ajudar com outros tópicos. Que tal explorar o que está disponível?`;
        metadata.tipo = 'sem_resultado';
      }
      break;
  }

  return { resposta, fragmentos, metadata };
}

export function createChatRoutes(vectorSearch, ai, conversationManager, mongo) {
  const router = express.Router();
  const dialogueManager = new DialogueManager(ai);
  const contextAnalyzer = new ContextAnalyzer();
  const intentDetector = new IntentDetector();
  const discoveryService = new DiscoveryService(mongo);
  const smartRanker = new SmartRanker();

  // Armazenar referência ao mongo no conversationManager para uso nas funções
  conversationManager.mongo = mongo;
  conversationManager.vectorSearch = vectorSearch;
  conversationManager.ai = ai;

  router.post('/chat', async (req, res) => {
    let currentConversationId;

    try {
      const { mensagem, conversationId } = req.body;
      if (!mensagem) return res.status(400).json(ResponseFormatter.formatError('Mensagem é obrigatória', 400));

      currentConversationId = conversationId;
      let preferencias = null;

      // INICIAR CONVERSA COM SAUDAÇÃO DO EDU (se necessário)
      currentConversationId = await iniciarConversaComSaudacao(conversationManager, currentConversationId, ai);
      preferencias = conversationManager.getPreferencias(currentConversationId);

      // OBTER CONTEXTO COMPLETO
      const contextoCompleto = conversationManager.getContextoCompleto(currentConversationId);

      // VERIFICAR SE É PRIMEIRA MENSAGEM DO USUÁRIO
      const mensagensUsuario = contextoCompleto.historico.filter(msg => msg.role === 'user');
      const isPrimeiraMensagemUsuario = mensagensUsuario.length === 0;

      // --- Tratamento de escolha de material pendente ---
      const materiaisPendentes = conversationManager.getMateriaisPendentes(currentConversationId);
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
            { tipo: 'consulta', material_escolhido: materialEscolhido.arquivo_nome }
          );

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
            { tipo: 'consulta', escolha_processada: true }
          ));
        } else {
          conversationManager.limparMateriaisPendentes(currentConversationId);
        }
      }

      // Adicionar mensagem do usuário ao histórico
      conversationManager.adicionarMensagem(currentConversationId, 'user', mensagem);

      // DETECTAR INTENÇÃO COM CONTEXTO COMPLETO
      const deteccaoIntencao = intentDetector.detectar(mensagem, contextoCompleto);

      const topicValidator = new TopicValidator(mongo, discoveryService);
      const validacao = await topicValidator.validarExistenciaConteudo(
        mensagem,
        deteccaoIntencao.intencao
      );

      // Se não tem conteúdo → responder com sugestões
      if (!validacao.temConteudo && !validacao.bypass) {
        const resposta = await ai.conversarLivremente(
          mensagem,
          contextoCompleto.historico,
          `${ai.personaEdu}

O usuário perguntou: "${mensagem}"

Você não tem conteúdo específico sobre isso no banco de dados.

Tópicos disponíveis: ${validacao.sugestoes.join(', ')}

Responda de forma amigável e natural:
1. Informe que não tem esse conteúdo específico
2. Sugira os tópicos disponíveis
3. Pergunte qual interessa`
        );

        conversationManager.adicionarMensagem(
          currentConversationId,
          'assistant',
          resposta,
          [],
          {
            tipo: 'sem_conteudo',
            sugestoes: validacao.sugestoes,
            intencaoDetectada: deteccaoIntencao.intencao
          }
        );

        return res.json(ResponseFormatter.formatChatResponse(
          currentConversationId,
          resposta,
          [],
          { tipo: 'sem_conteudo', sugestoes: validacao.sugestoes }
        ));
      }

      // Registrar intenção detectada na mensagem do usuário
      const conversa = conversationManager.getConversa(currentConversationId);
      const ultimaMensagemIndex = conversa.mensagens.length - 1;
      conversa.mensagens[ultimaMensagemIndex].metadata.intencaoDetectada = deteccaoIntencao;

      // PROCESSAMENTO ESPECIAL PARA PRIMEIRA RESPOSTA DO USUÁRIO
      if (isPrimeiraMensagemUsuario) {
        const processamento = await processarPrimeiraRespostaUsuario(
          mensagem,
          currentConversationId,
          conversationManager,
          ai,
          vectorSearch,
          contextoCompleto
        );

        const { resposta, fragmentos, metadata } = processamento;

        const documentosUsados = [...new Set(fragmentos.map(f => f.metadados.arquivo_url))];
        if (documentosUsados.length > 0) {
          conversationManager.registrarDocumentosApresentados(currentConversationId, documentosUsados);
        }

        conversationManager.atualizarContextoConversacional(
          currentConversationId,
          mensagem,
          resposta,
          deteccaoIntencao.intencao,
          metadata
        );

        conversationManager.adicionarMensagem(
          currentConversationId,
          'assistant',
          resposta,
          fragmentos,
          metadata
        );

        return res.json(ResponseFormatter.formatChatResponse(
          currentConversationId,
          resposta,
          fragmentos,
          metadata
        ));
      }

      // CONFIRMAÇÃO COM CONTEXTO
      if (deteccaoIntencao.intencao === 'confirmacao') {
        const contextoAtivo = contextoCompleto.contextoConversacional;
        if (contextoAtivo?.aguardandoResposta === 'confirmacao') {
          const fragmentos = contextoAtivo.fragmentosPendentes || [];
          const resposta = await ai.responderComContexto(
            mensagem,
            contextoCompleto.historico,
            fragmentos,
            preferencias
          );

          const documentosUsados = [...new Set(fragmentos.map(f => f.metadados.arquivo_url))];
          conversationManager.registrarDocumentosApresentados(currentConversationId, documentosUsados);

          conversationManager.atualizarContextoConversacional(
            currentConversationId,
            mensagem,
            resposta,
            'confirmacao',
            { tipo: 'consulta', continuacao_confirmada: true }
          );

          conversationManager.adicionarMensagem(
            currentConversationId,
            'assistant',
            resposta,
            fragmentos,
            {
              tipo: 'consulta',
              continuacao_confirmada: true,
              intencaoDetectada: 'confirmacao'
            }
          );

          return res.json(ResponseFormatter.formatChatResponse(
            currentConversationId,
            resposta,
            fragmentos,
            { tipo: 'consulta', continuacao_confirmada: true }
          ));
        }
      }

      // FOLLOW-UP E REEXPLICAÇÃO
      if (deteccaoIntencao.intencao === 'follow_up' || deteccaoIntencao.intencao === 'reexplicacao') {
        const contextoAtivo = contextoCompleto.contextoConversacional;
        if (contextoAtivo?.topicoAtual) {
          // Buscar mais materiais ou reexplicar
          const queryBusca = `${contextoAtivo.topicoAtual} ${mensagem}`;
          const documentosApresentados = conversationManager.getDocumentosApresentados(currentConversationId);

          let fragmentosBrutos = await vectorSearch.buscarFragmentosRelevantes(queryBusca, {}, 15);
          fragmentosBrutos = fragmentosBrutos.filter(f => !documentosApresentados.includes(f.metadados.arquivo_url));

          if (fragmentosBrutos.length > 0) {
            let fragmentosRankeados = smartRanker.rankearPorQualidade(fragmentosBrutos, queryBusca);
            fragmentosRankeados = smartRanker.deduplicarConteudo(fragmentosRankeados);
            const fragmentosFinais = smartRanker.selecionarMelhores(fragmentosRankeados, 3);

            const resposta = await ai.responderComContexto(
              `Explique de forma ${deteccaoIntencao.intencao === 'reexplicacao' ? 'mais simples e clara' : 'detalhada com exemplos'} sobre ${contextoAtivo.topicoAtual}: ${mensagem}`,
              contextoCompleto.historico,
              fragmentosFinais,
              { ...preferencias, profundidade: deteccaoIntencao.intencao === 'reexplicacao' ? 'basico' : 'detalhado' }
            );

            const documentosUsados = [...new Set(fragmentosFinais.map(f => f.metadados.arquivo_url))];
            conversationManager.registrarDocumentosApresentados(currentConversationId, documentosUsados);

            conversationManager.atualizarContextoConversacional(
              currentConversationId,
              mensagem,
              resposta,
              deteccaoIntencao.intencao,
              { tipo: 'consulta', follow_up: true }
            );

            conversationManager.adicionarMensagem(
              currentConversationId,
              'assistant',
              resposta,
              fragmentosFinais,
              {
                tipo: 'consulta',
                follow_up: true,
                intencaoDetectada: deteccaoIntencao.intencao
              }
            );

            return res.json(ResponseFormatter.formatChatResponse(
              currentConversationId,
              resposta,
              fragmentosFinais,
              { tipo: 'consulta', follow_up: true }
            ));
          }
        }
      }

      // NÍVEL DE CONHECIMENTO COM CONTEXTO
      if (deteccaoIntencao.intencao === 'nivel_conhecimento') {
        const contextoAtivo = contextoCompleto.contextoConversacional;
        if (contextoAtivo?.topicoAtual) {
          const nivel = mensagem.toLowerCase().includes('não') || mensagem.toLowerCase().includes('pouco') ? 'basico' : 'intermediario';
          const preferenciasAtualizadas = { ...preferencias, profundidade: nivel };
          conversationManager.atualizarPreferencias(currentConversationId, preferenciasAtualizadas);

          // Buscar materiais adequados ao nível
          const queryBusca = `${contextoAtivo.topicoAtual} ${nivel === 'basico' ? 'introdução básico iniciante' : 'avançado técnico'}`;
          const documentosApresentados = conversationManager.getDocumentosApresentados(currentConversationId);

          let fragmentosBrutos = await vectorSearch.buscarFragmentosRelevantes(queryBusca, {}, 15);
          fragmentosBrutos = fragmentosBrutos.filter(f => !documentosApresentados.includes(f.metadados.arquivo_url));

          if (fragmentosBrutos.length > 0) {
            let fragmentosRankeados = smartRanker.rankearPorQualidade(fragmentosBrutos, queryBusca);
            fragmentosRankeados = smartRanker.deduplicarConteudo(fragmentosRankeados);
            const fragmentosFinais = smartRanker.selecionarMelhores(fragmentosRankeados, preferenciasAtualizadas.limiteFragmentos || 5);

            const resposta = await ai.responderComContexto(
              `Explicar sobre ${contextoAtivo.topicoAtual} para nível ${nivel}`,
              contextoCompleto.historico,
              fragmentosFinais,
              preferenciasAtualizadas
            );

            const documentosUsados = [...new Set(fragmentosFinais.map(f => f.metadados.arquivo_url))];
            conversationManager.registrarDocumentosApresentados(currentConversationId, documentosUsados);

            conversationManager.atualizarContextoConversacional(
              currentConversationId,
              mensagem,
              resposta,
              'nivel_conhecimento',
              { tipo: 'consulta', nivel_adaptado: nivel }
            );

            conversationManager.adicionarMensagem(
              currentConversationId,
              'assistant',
              resposta,
              fragmentosFinais,
              {
                tipo: 'consulta',
                nivel_adaptado: nivel,
                intencaoDetectada: 'nivel_conhecimento'
              }
            );

            return res.json(ResponseFormatter.formatChatResponse(
              currentConversationId,
              resposta,
              fragmentosFinais,
              { tipo: 'consulta', nivel_adaptado: nivel }
            ));
          }
        }
      }

      // CASUAL
      if (deteccaoIntencao.intencao === 'casual') {
        const resposta = await ai.conversarLivremente(
          mensagem,
          contextoCompleto.historico,
          `${ai.personaEdu}\n\nResponda de forma amigável e natural. Mantenha o contexto da conversa anterior se relevante.`
        );

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
          {
            tipo: 'casual',
            intencaoDetectada: 'casual'
          }
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

        const resposta = await ai.apresentarTopicos(topicosComTiposAmigaveis, tiposMaterialAmigaveis, contextoCompleto.historico);

        conversationManager.atualizarContextoConversacional(
          currentConversationId,
          mensagem,
          resposta,
          'descoberta',
          {
            tipo: 'descoberta',
            topicos: apresentacao.destaques,
            categorias: apresentacao.categorias
          }
        );

        conversationManager.adicionarMensagem(
          currentConversationId,
          'assistant',
          resposta,
          [],
          {
            tipo: 'descoberta',
            topicos: apresentacao.destaques,
            categorias: apresentacao.categorias,
            intencaoDetectada: 'descoberta'
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
          const resposta = await ai.gerarEngajamentoTopico(topicoInfo.topico, tiposAmigaveis, contextoCompleto.historico);

          conversationManager.atualizarContextoConversacional(
            currentConversationId,
            mensagem,
            resposta,
            'interesse_topico',
            {
              tipo: 'engajamento_topico',
              topico: topicoInfo.topico
            }
          );

          conversationManager.adicionarMensagem(
            currentConversationId,
            'assistant',
            resposta,
            [],
            {
              tipo: 'engajamento_topico',
              topico: topicoInfo.topico,
              intencaoDetectada: 'interesse_topico'
            }
          );

          return res.json(ResponseFormatter.formatChatResponse(
            currentConversationId,
            resposta,
            [],
            { tipo: 'engajamento_topico' }
          ));
        }
      }

      // CONTINUAÇÃO COM CONTEXTO
      if (deteccaoIntencao.intencao === 'continuacao') {
        const topicoContexto = deteccaoIntencao.metadados.topico_contexto || contextoCompleto.contextoConversacional?.topicoAtual || '';
        const queryBusca = `${topicoContexto} ${mensagem} continuacao`;
        const documentosApresentados = conversationManager.getDocumentosApresentados(currentConversationId);

        let fragmentosBrutos = await vectorSearch.buscarFragmentosRelevantes(queryBusca, {}, 20);
        fragmentosBrutos = fragmentosBrutos.filter(f => !documentosApresentados.includes(f.metadados.arquivo_url));

        if (fragmentosBrutos.length === 0) {
          const resposta = `Desculpe, não encontrei mais materiais sobre ${topicoContexto}. Posso te ajudar com outro tópico?`;

          conversationManager.atualizarContextoConversacional(
            currentConversationId,
            mensagem,
            resposta,
            'continuacao',
            { tipo: 'sem_resultado' }
          );

          conversationManager.adicionarMensagem(
            currentConversationId,
            'assistant',
            resposta,
            [],
            {
              tipo: 'sem_resultado',
              intencaoDetectada: 'continuacao'
            }
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
        const analiseRelevancia = contextAnalyzer.analisarRelevancia(fragmentosFinais, 0.55);

        if (!analiseRelevancia.temConteudoRelevante) {
          const resposta = `Não encontrei mais conteúdo sobre ${topicoContexto}. Que tal outro tema?`;

          conversationManager.atualizarContextoConversacional(
            currentConversationId,
            mensagem,
            resposta,
            'continuacao',
            { tipo: 'sem_resultado' }
          );

          conversationManager.adicionarMensagem(
            currentConversationId,
            'assistant',
            resposta,
            [],
            {
              tipo: 'sem_resultado',
              intencaoDetectada: 'continuacao'
            }
          );

          return res.json(ResponseFormatter.formatChatResponse(
            currentConversationId,
            resposta,
            [],
            { tipo: 'sem_resultado' }
          ));
        }

        const resposta = await ai.responderComContexto(
          `Continuar sobre ${topicoContexto}: ${mensagem}`,
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
          'continuacao',
          { tipo: 'consulta', continuacao: true }
        );

        conversationManager.adicionarMensagem(
          currentConversationId,
          'assistant',
          resposta,
          analiseRelevancia.fragmentosRelevantes,
          {
            tipo: 'consulta',
            continuacao: true,
            intencaoDetectada: 'continuacao'
          }
        );

        return res.json(ResponseFormatter.formatChatResponse(
          currentConversationId,
          resposta,
          analiseRelevancia.fragmentosRelevantes,
          { tipo: 'consulta', continuacao: true }
        ));
      }

      // --- CONSULTA NORMAL COM CONTEXTO ---
      let queryBusca = mensagem;
      const contextoConv = contextoCompleto.contextoConversacional;

      // Usar contexto do tópico atual se relevante
      if (contextoConv?.topicoAtual && deteccaoIntencao.metadados.usar_contexto_historico) {
        queryBusca = `${contextoConv.topicoAtual} ${mensagem}`;
      }

      const tipoMidiaSolicitado = dialogueManager.detectarTipoMidiaSolicitado(mensagem);
      const documentosApresentados = conversationManager.getDocumentosApresentados(currentConversationId);

      let fragmentosBrutos = await vectorSearch.buscarFragmentosRelevantes(
        queryBusca,
        { tipo: tipoMidiaSolicitado?.tipo, tiposSolicitados: tipoMidiaSolicitado?.filtros },
        20
      );

      fragmentosBrutos = fragmentosBrutos.filter(f => !documentosApresentados.includes(f.metadados.arquivo_url));

      if (fragmentosBrutos.length === 0) {
        const resposta = `Desculpe, não encontrei materiais relevantes sobre "${mensagem}". Que tal perguntar "o que você pode me ensinar"?`;

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
          {
            tipo: 'sem_resultado',
            intencaoDetectada: 'consulta'
          }
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

      const analiseRelevancia = contextAnalyzer.analisarRelevancia(fragmentosFinais, thresholdRelevancia);

      if (!analiseRelevancia.temConteudoRelevante) {
        const resposta = `Não encontrei conteúdo suficiente sobre "${mensagem}". Posso te ajudar com outro tema!`;

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
          {
            tipo: 'sem_resultado',
            intencaoDetectada: 'consulta'
          }
        );

        return res.json(ResponseFormatter.formatChatResponse(
          currentConversationId,
          resposta,
          [],
          { tipo: 'sem_resultado' }
        ));
      }

      const documentosAgrupados = contextAnalyzer.agruparPorDocumento(analiseRelevancia.fragmentosRelevantes);

      // Oferecer escolha se múltiplos documentos relevantes
      if (documentosAgrupados.length > 1 && !contextoConv?.aguardandoResposta) {
        const opcoes = documentosAgrupados.map(doc => ({
          arquivo_url: doc.arquivo_url,
          arquivo_nome: doc.arquivo_nome,
          tipo: doc.tipo,
          fragmentos: doc.fragmentos,
          score_medio: doc.score_medio
        }));

        const resposta = await ai.apresentarMateriaisContextual(opcoes, contextoCompleto.historico);

        conversationManager.setMateriaisPendentes(currentConversationId, opcoes, {
          mensagem_original: mensagem,
          query_usada: queryBusca
        });

        conversationManager.atualizarContextoConversacional(
          currentConversationId,
          mensagem,
          resposta,
          'lista_materiais',
          { tipo: 'lista_materiais', total_opcoes: opcoes.length }
        );

        conversationManager.adicionarMensagem(
          currentConversationId,
          'assistant',
          resposta,
          [],
          {
            tipo: 'lista_materiais',
            total_opcoes: opcoes.length,
            intencaoDetectada: 'lista_materiais'
          }
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

      // Resposta direta com único documento
      const resposta = await ai.responderComContexto(
        mensagem,
        contextoCompleto.historico,
        analiseRelevancia.fragmentosRelevantes,
        preferencias
      );

      const documentosUsados = [...new Set(analiseRelevancia.fragmentosRelevantes.map(f => f.metadados.arquivo_url))];
      conversationManager.registrarDocumentosApresentados(currentConversationId, documentosUsados);

      // ATUALIZAR CONTEXTO - Registrar tópico atual
      const topicoDetectado = intentDetector.extrairTopicoDaMensagem(mensagem).join(' ') ||
        contextoConv?.topicoAtual ||
        intentDetector.extrairTopicoDeResposta(resposta);

      conversationManager.atualizarContextoConversacional(
        currentConversationId,
        mensagem,
        resposta,
        'consulta',
        {
          tipo: 'consulta',
          topico: topicoDetectado
        }
      );

      conversationManager.adicionarMensagem(
        currentConversationId,
        'assistant',
        resposta,
        analiseRelevancia.fragmentosRelevantes,
        {
          tipo: 'consulta',
          topico: topicoDetectado,
          intencaoDetectada: 'consulta'
        }
      );

      return res.json(ResponseFormatter.formatChatResponse(
        currentConversationId,
        resposta,
        analiseRelevancia.fragmentosRelevantes,
        {
          tipo: 'consulta',
          scoreMaximo: analiseRelevancia.scoreMaximo,
          topico: topicoDetectado
        }
      ));

    } catch (error) {
      console.error('Erro no chat:', error);

      if (currentConversationId) {
        conversationManager.atualizarContextoConversacional(
          currentConversationId,
          mensagem,
          'Desculpe, ocorreu um erro.',
          'erro',
          { tipo: 'erro' }
        );
      }

      res.status(500).json(ResponseFormatter.formatError(error.message));
    }
  });

  // Rotas de gerenciamento
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