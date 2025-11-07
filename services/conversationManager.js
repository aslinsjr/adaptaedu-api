// services/conversationManager.js
import { v4 as uuidv4 } from 'uuid';
import { ConversationContext } from './conversationContext.js';

export class ConversationManager {
  constructor() {
    this.conversations = new Map();
    this.contextos = new Map();
  }

  criarConversa(preferencias = null) {
    const conversationId = uuidv4();
    
    this.conversations.set(conversationId, {
      id: conversationId,
      mensagens: [],
      preferencias: preferencias || {
        modoResposta: 'auto',
        profundidade: 'detalhado',
        tiposMaterialPreferidos: [],
        limiteFragmentos: 5
      },
      estado: 'novo',
      onboardingCompleto: false,
      documentos_apresentados: [],
      materiais_pendentes: null,
      criado_em: new Date(),
      atualizado_em: new Date()
    });

    // Criar contexto conversacional
    this.contextos.set(conversationId, new ConversationContext());
    
    return conversationId;
  }

  adicionarMensagem(conversationId, role, content, fontes = [], metadata = {}) {
    let conversa = this.conversations.get(conversationId);
    
    if (!conversa) {
      conversationId = this.criarConversa();
      conversa = this.conversations.get(conversationId);
    }

    const mensagem = {
      role,
      content,
      timestamp: new Date(),
      fontes: role === 'assistant' ? fontes : undefined,
      metadata: { ...metadata }
    };

    conversa.mensagens.push(mensagem);
    conversa.atualizado_em = new Date();

    // Atualizar estado baseado no tipo de mensagem
    if (role === 'assistant') {
      if (metadata.tipo === 'lista_materiais') {
        conversa.estado = 'aguardando_escolha';
      } else if (metadata.tipo === 'engajamento_topico') {
        conversa.estado = 'aguardando_especificacao';
      } else if (metadata.tipo === 'boas_vindas' && metadata.automatica) {
        // Mensagem automática de boas-vindas
        conversa.estado = 'aguardando_primeira_interacao';
      } else if (conversa.estado === 'aguardando_primeira_interacao') {
        // Manter estado se ainda aguardando primeira interação
        conversa.estado = 'aguardando_primeira_interacao';
      } else {
        conversa.estado = 'ativo';
      }
      
      conversa.ultima_foi_apresentacao = metadata.foi_apresentacao || false;
      conversa.tags_apresentacao = metadata.tags_apresentacao || [];
    }

    return conversationId;
  }

  // Novo método para verificar primeira interação real do usuário
  isPrimeiraInteracaoReal(conversationId) {
    const conversa = this.conversations.get(conversationId);
    if (!conversa) return true;
    
    // Contar apenas mensagens do usuário (ignorar mensagens automáticas do assistant)
    const mensagensUsuario = conversa.mensagens.filter(m => m.role === 'user');
    return mensagensUsuario.length === 0;
  }

  // Método para obter última mensagem real do usuário
  getUltimaMensagemUsuario(conversationId) {
    const conversa = this.conversations.get(conversationId);
    if (!conversa) return null;
    
    const mensagensUsuario = conversa.mensagens.filter(m => m.role === 'user');
    return mensagensUsuario[mensagensUsuario.length - 1] || null;
  }

  // Método para verificar se tem mensagem inicial automática
  temMensagemInicial(conversationId) {
    const conversa = this.conversations.get(conversationId);
    if (!conversa) return false;
    
    // Verificar se primeira mensagem é do assistant e automática
    const primeiraMensagem = conversa.mensagens[0];
    return primeiraMensagem && 
           primeiraMensagem.role === 'assistant' && 
           primeiraMensagem.metadata?.automatica === true;
  }

  // Obter contexto completo para detecção de intenções
  getContextoCompleto(conversationId) {
    const conversa = this.conversations.get(conversationId);
    const contexto = this.contextos.get(conversationId);
    
    if (!conversa) {
      return { 
        historico: [], 
        contextoConversacional: null, 
        preferencias: null, 
        estado: 'novo',
        documentosApresentados: []
      };
    }

    return {
      historico: this.getHistoricoRico(conversationId, 8),
      contextoConversacional: contexto ? contexto.getContextoParaDetecao() : null,
      preferencias: conversa.preferencias,
      estado: conversa.estado,
      documentosApresentados: conversa.documentos_apresentados
    };
  }

  // Histórico enriquecido com metadados para análise contextual
  getHistoricoRico(conversationId, limite = 8) {
    const conversa = this.conversations.get(conversationId);
    if (!conversa) return [];
    
    // Filtrar mensagens automáticas se necessário
    const mensagensFiltradas = conversa.mensagens.filter(m => {
      // Incluir todas exceto mensagens automáticas de boas-vindas no histórico
      if (m.role === 'assistant' && m.metadata?.automatica === true && m.metadata?.tipo === 'boas_vindas') {
        return false;
      }
      return true;
    });
    
    return mensagensFiltradas.slice(-limite).map(m => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      metadata: m.metadata || {},
      fontes: m.fontes || [],
      intencaoDetectada: m.metadata?.intencaoDetectada
    }));
  }

  // Atualizar contexto conversacional após interação
  atualizarContextoConversacional(conversationId, mensagemUsuario, respostaAssistant, intencao, metadata = {}) {
    let contexto = this.contextos.get(conversationId);
    if (!contexto) {
      contexto = new ConversationContext();
      this.contextos.set(conversationId, contexto);
    }
    
    contexto.atualizarContexto(mensagemUsuario, respostaAssistant, intencao, metadata);
    
    // Atualizar estado da conversa baseado no contexto
    const conversa = this.conversations.get(conversationId);
    if (conversa) {
      if (contexto.aguardandoResposta) {
        conversa.estado = `aguardando_${contexto.aguardandoResposta}`;
      } else if (conversa.estado === 'aguardando_primeira_interacao' && mensagemUsuario) {
        conversa.estado = 'ativo';
      } else if (conversa.estado !== 'aguardando_primeira_interacao') {
        conversa.estado = 'ativo';
      }
      conversa.atualizado_em = new Date();
    }
  }

  atualizarPreferencias(conversationId, novasPreferencias) {
    const conversa = this.conversations.get(conversationId);
    
    if (!conversa) {
      return false;
    }

    conversa.preferencias = {
      ...conversa.preferencias,
      ...novasPreferencias,
      atualizadoEm: new Date()
    };

    conversa.atualizado_em = new Date();
    return true;
  }

  marcarOnboardingCompleto(conversationId) {
    const conversa = this.conversations.get(conversationId);
    if (conversa) {
      conversa.onboardingCompleto = true;
      if (conversa.estado === 'aguardando_primeira_interacao') {
        conversa.estado = 'ativo';
      }
    }
  }

  isOnboardingCompleto(conversationId) {
    const conversa = this.conversations.get(conversationId);
    return conversa?.onboardingCompleto || false;
  }

  getEstado(conversationId) {
    const conversa = this.conversations.get(conversationId);
    return conversa?.estado || 'novo';
  }

  setEstado(conversationId, novoEstado) {
    const conversa = this.conversations.get(conversationId);
    if (conversa) {
      conversa.estado = novoEstado;
      conversa.atualizado_em = new Date();
    }
  }

  getPreferencias(conversationId) {
    const conversa = this.conversations.get(conversationId);
    return conversa?.preferencias || null;
  }

  getHistorico(conversationId, limite = 10) {
    const conversa = this.conversations.get(conversationId);
    
    if (!conversa) return [];

    const mensagens = conversa.mensagens.slice(-limite * 2);
    
    return mensagens.map(m => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      fontes: m.fontes,
      metadata: m.metadata
    }));
  }

  getConversa(conversationId) {
    const conversa = this.conversations.get(conversationId);
    
    if (!conversa) return null;

    const contexto = this.contextos.get(conversationId);

    return {
      conversationId: conversa.id,
      mensagens: conversa.mensagens,
      preferencias: conversa.preferencias,
      estado: conversa.estado,
      onboardingCompleto: conversa.onboardingCompleto,
      documentos_apresentados: conversa.documentos_apresentados,
      materiais_pendentes: conversa.materiais_pendentes,
      criado_em: conversa.criado_em,
      atualizado_em: conversa.atualizado_em,
      contextoConversacional: contexto ? contexto.getContextoParaDetecao() : null
    };
  }

  limparConversa(conversationId) {
    this.contextos.delete(conversationId);
    return this.conversations.delete(conversationId);
  }

  limparConversasAntigas(horasMaximo = 24) {
    const agora = new Date();
    const limiteIdade = horasMaximo * 60 * 60 * 1000;

    for (const [id, conversa] of this.conversations.entries()) {
      const idade = agora - conversa.atualizado_em;
      if (idade > limiteIdade) {
        this.conversations.delete(id);
        this.contextos.delete(id);
      }
    }
  }

  isPrimeiraInteracao(conversationId) {
    const conversa = this.conversations.get(conversationId);
    return !conversa || conversa.mensagens.length === 0;
  }

  getDocumentosApresentados(conversationId) {
    const conversa = this.conversations.get(conversationId);
    return conversa?.documentos_apresentados || [];
  }

  registrarDocumentosApresentados(conversationId, arquivos_urls) {
    const conversa = this.conversations.get(conversationId);
    if (!conversa) return;

    for (const url of arquivos_urls) {
      if (!conversa.documentos_apresentados.includes(url)) {
        conversa.documentos_apresentados.push(url);
      }
    }
    
    // Atualizar contexto com documentos mencionados
    const contexto = this.contextos.get(conversationId);
    if (contexto) {
      contexto.documentosMencionados = [...new Set([...contexto.documentosMencionados, ...arquivos_urls])];
    }
    
    conversa.atualizado_em = new Date();
  }

  setMateriaisPendentes(conversationId, opcoes, contexto = {}) {
    const conversa = this.conversations.get(conversationId);
    if (!conversa) return;

    conversa.materiais_pendentes = {
      opcoes,
      contexto,
      criado_em: new Date()
    };
    conversa.estado = 'aguardando_escolha';
    conversa.atualizado_em = new Date();

    // Atualizar contexto
    const contextoConv = this.contextos.get(conversationId);
    if (contextoConv) {
      contextoConv.aguardandoResposta = 'escolha_material';
      contextoConv.fluxoAtivo = 'escolha';
    }
  }

  getMateriaisPendentes(conversationId) {
    const conversa = this.conversations.get(conversationId);
    return conversa?.materiais_pendentes || null;
  }

  limparMateriaisPendentes(conversationId) {
    const conversa = this.conversations.get(conversationId);
    if (!conversa) return;

    conversa.materiais_pendentes = null;
    if (conversa.estado === 'aguardando_escolha') {
      conversa.estado = 'ativo';
    }
    conversa.atualizado_em = new Date();

    // Limpar contexto de espera
    const contexto = this.contextos.get(conversationId);
    if (contexto) {
      contexto.aguardandoResposta = null;
      contexto.fluxoAtivo = 'conversa';
    }
  }

  ultimaRespostaFoiApresentacao(conversationId) {
    const conversa = this.conversations.get(conversationId);
    return conversa?.ultima_foi_apresentacao || false;
  }

  getTagsApresentacao(conversationId) {
    const conversa = this.conversations.get(conversationId);
    return conversa?.tags_apresentacao || [];
  }

  // Método para debug - visualizar contexto
  debugContexto(conversationId) {
    const conversa = this.conversations.get(conversationId);
    const contexto = this.contextos.get(conversationId);
    
    return {
      conversa: conversa ? {
        id: conversa.id,
        estado: conversa.estado,
        totalMensagens: conversa.mensagens.length,
        mensagensUsuario: conversa.mensagens.filter(m => m.role === 'user').length,
        temMensagemInicial: this.temMensagemInicial(conversationId),
        documentosApresentados: conversa.documentos_apresentados.length,
        temMateriaisPendentes: !!conversa.materiais_pendentes,
        atualizado_em: conversa.atualizado_em
      } : null,
      contexto: contexto ? contexto.getContextoParaDetecao() : null
    };
  }

  // Reiniciar contexto (útil para mudanças bruscas de tópico)
  reiniciarContexto(conversationId) {
    const contexto = this.contextos.get(conversationId);
    if (contexto) {
      contexto.limparContexto();
    }
    
    const conversa = this.conversations.get(conversationId);
    if (conversa) {
      if (conversa.estado !== 'aguardando_primeira_interacao') {
        conversa.estado = 'ativo';
      }
      conversa.atualizado_em = new Date();
    }
  }

  // Estatísticas da conversa
  getEstatisticasConversa(conversationId) {
    const conversa = this.conversations.get(conversationId);
    if (!conversa) return null;

    const mensagensUser = conversa.mensagens.filter(m => m.role === 'user').length;
    const mensagensAssistant = conversa.mensagens.filter(m => m.role === 'assistant').length;
    const mensagensAutomaticas = conversa.mensagens.filter(m => 
      m.role === 'assistant' && m.metadata?.automatica === true
    ).length;
    
    const tiposResposta = {};
    
    conversa.mensagens.forEach(m => {
      if (m.role === 'assistant' && m.metadata?.tipo) {
        tiposResposta[m.metadata.tipo] = (tiposResposta[m.metadata.tipo] || 0) + 1;
      }
    });

    return {
      totalMensagens: conversa.mensagens.length,
      mensagensUser,
      mensagensAssistant,
      mensagensAutomaticas,
      documentosUtilizados: conversa.documentos_apresentados.length,
      tiposResposta,
      duracao: new Date() - conversa.criado_em,
      idade: new Date() - conversa.atualizado_em,
      estado: conversa.estado,
      temMensagemInicial: this.temMensagemInicial(conversationId),
      primeiraInteracaoReal: this.isPrimeiraInteracaoReal(conversationId)
    };
  }
}