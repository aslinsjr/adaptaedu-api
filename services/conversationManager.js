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
        limiteFragmentos: 5
      },
      documentos_apresentados: [],
      materiais_pendentes: null,
      criado_em: new Date(),
      atualizado_em: new Date()
    });

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

    return conversationId;
  }

  getContextoCompleto(conversationId) {
    const conversa = this.conversations.get(conversationId);
    const contexto = this.contextos.get(conversationId);
    
    if (!conversa) {
      return { 
        historico: [], 
        contextoConversacional: null, 
        preferencias: null,
        documentosApresentados: []
      };
    }

    return {
      historico: conversa.mensagens.slice(-10),
      contextoConversacional: contexto ? contexto.getContextoParaDetecao() : null,
      preferencias: conversa.preferencias,
      documentosApresentados: conversa.documentos_apresentados
    };
  }

  atualizarContextoConversacional(conversationId, mensagemUsuario, respostaAssistant, intencao, metadata = {}) {
    let contexto = this.contextos.get(conversationId);
    if (!contexto) {
      contexto = new ConversationContext();
      this.contextos.set(conversationId, contexto);
    }
    
    contexto.atualizarContexto(mensagemUsuario, respostaAssistant, intencao, metadata);
  }

  getPreferencias(conversationId) {
    const conversa = this.conversations.get(conversationId);
    return conversa?.preferencias || null;
  }

  getConversa(conversationId) {
    const conversa = this.conversations.get(conversationId);
    if (!conversa) return null;

    const contexto = this.contextos.get(conversationId);

    return {
      conversationId: conversa.id,
      mensagens: conversa.mensagens,
      preferencias: conversa.preferencias,
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
    conversa.atualizado_em = new Date();

    const contextoConv = this.contextos.get(conversationId);
    if (contextoConv) {
      contextoConv.aguardandoResposta = 'escolha_material';
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
    conversa.atualizado_em = new Date();

    const contexto = this.contextos.get(conversationId);
    if (contexto) {
      contexto.aguardandoResposta = null;
    }
  }

  atualizarPreferencias(conversationId, novasPreferencias) {
    const conversa = this.conversations.get(conversationId);
    if (!conversa) return false;

    conversa.preferencias = {
      ...conversa.preferencias,
      ...novasPreferencias
    };

    conversa.atualizado_em = new Date();
    return true;
  }
}