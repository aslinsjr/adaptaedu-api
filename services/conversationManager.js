// services/conversationManager.js
import { v4 as uuidv4 } from 'uuid';

export class ConversationManager {
  constructor() {
    this.conversations = new Map();
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
      materiais_pendentes: null, // { opcoes: [], contexto: {} }
      criado_em: new Date(),
      atualizado_em: new Date()
    });
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
      metadata: metadata || {}
    };

    conversa.mensagens.push(mensagem);
    conversa.atualizado_em = new Date();

    return conversationId;
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
      conversa.estado = 'ativo';
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

    return {
      conversationId: conversa.id,
      mensagens: conversa.mensagens,
      preferencias: conversa.preferencias,
      estado: conversa.estado,
      onboardingCompleto: conversa.onboardingCompleto,
      criado_em: conversa.criado_em,
      atualizado_em: conversa.atualizado_em
    };
  }

  limparConversa(conversationId) {
    return this.conversations.delete(conversationId);
  }

  limparConversasAntigas(horasMaximo = 24) {
    const agora = new Date();
    const limiteIdade = horasMaximo * 60 * 60 * 1000;

    for (const [id, conversa] of this.conversations.entries()) {
      const idade = agora - conversa.atualizado_em;
      if (idade > limiteIdade) {
        this.conversations.delete(id);
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
  }

  getMateriaisPendentes(conversationId) {
    const conversa = this.conversations.get(conversationId);
    return conversa?.materiais_pendentes || null;
  }

  limparMateriaisPendentes(conversationId) {
    const conversa = this.conversations.get(conversationId);
    if (!conversa) return;

    conversa.materiais_pendentes = null;
    conversa.estado = 'ativo';
    conversa.atualizado_em = new Date();
  }
}