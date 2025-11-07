// routes/chatRoutes.js
import express from 'express';
import { ResponseFormatter } from '../utils/responseFormatter.js';
import { DialogueManager } from '../services/dialogueManager.js';
import { ContextAnalyzer } from '../services/contextAnalyzer.js';
import { IntentDetector } from '../services/intentDetector.js';
<<<<<<< HEAD
import { DialogueManager } from '../services/dialogueManager.js';
=======
import { DiscoveryService } from '../services/discoveryService.js';
import { SmartRanker } from '../services/smartRanker.js';

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
        const tiposAmigaveis = mapearTiposParaAmigavel(topicoInfo.tipos_material);
        resposta = await ai.gerarEngajamentoTopico(topicoInfo.topico, tiposAmigaveis, contextoCompleto.historico);
        metadata.tipo = 'engajamento_topico';
        metadata.topico = topicoInfo.topico;
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
        
        const contextAnalyzer = new ContextAnalyzer();
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
>>>>>>> parent of 6ffebff (Ajustes de limite de tópicos)

export function createChatRoutes(vectorSearch, ai, conversationManager, mongo) {
  const router = express.Router();
  const dialogueManager = new DialogueManager(ai);
  const contextAnalyzer = new ContextAnalyzer();
  const intentDetector = new IntentDetector();
<<<<<<< HEAD
  const dialogueManager = new DialogueManager(ai);
=======
  const discoveryService = new DiscoveryService(mongo);
  const smartRanker = new SmartRanker();
>>>>>>> parent of 6ffebff (Ajustes de limite de tópicos)

  // Armazenar referência ao mongo no conversationManager para uso nas funções
  conversationManager.mongo = mongo;
  conversationManager.vectorSearch = vectorSearch;
  conversationManager.ai = ai;

<<<<<<< HEAD
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
=======
>>>>>>> parent of 6ffebff (Ajustes de limite de tópicos)
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

<<<<<<< HEAD
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
=======
      // Adicionar mensagem do usuário ao histórico
      conversationManager.adicionarMensagem(currentConversationId, 'user', mensagem);

      // DETECTAR INTENÇÃO COM CONTEXTO COMPLETO
      const deteccaoIntencao = intentDetector.detectar(mensagem, contextoCompleto);
>>>>>>> parent of 6ffebff (Ajustes de limite de tópicos)

      // Registrar intenção detectada na mensagem do usuário
      const conversa = conversationManager.getConversa(currentConversationId);
      const ultimaMensagemIndex = conversa.mensagens.length - 1;
      conversa.mensagens[ultimaMensagemIndex].metadata.intencaoDetectada = deteccaoIntencao;

<<<<<<< HEAD
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
=======
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
>>>>>>> parent of 6ffebff (Ajustes de limite de tópicos)
          currentConversationId,
          resposta,
          fragmentos,
          metadata
<<<<<<< HEAD
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
=======
        ));
>>>>>>> parent of 6ffebff (Ajustes de limite de tópicos)
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
      
<<<<<<< HEAD
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
=======
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
>>>>>>> parent of 6ffebff (Ajustes de limite de tópicos)
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

<<<<<<< HEAD
  // ROTAS DE GERENCIAMENTO DE CONVERSA
=======
  // Rotas de gerenciamento
>>>>>>> parent of 6ffebff (Ajustes de limite de tópicos)
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