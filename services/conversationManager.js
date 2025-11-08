// services/conversationManager.js
import { v4 as uuidv4 } from 'uuid';

export class ConversationManager {
  constructor() {
    this.conversations = new Map();
  }

  criar() {
    const id = uuidv4();
    
    this.conversations.set(id, {
      id,
      mensagens: [],
      criado_em: new Date(),
      atualizado_em: new Date()
    });
    
    return id;
  }

  adicionar(conversationId, role, content, fontes = []) {
    let conversa = this.conversations.get(conversationId);
    
    if (!conversa) {
      conversationId = this.criar();
      conversa = this.conversations.get(conversationId);
    }

    conversa.mensagens.push({
      role,
      content,
      fontes: role === 'assistant' ? fontes : undefined,
      timestamp: new Date()
    });

    conversa.atualizado_em = new Date();
    return conversationId;
  }

  getHistorico(conversationId, limite = 10) {
    const conversa = this.conversations.get(conversationId);
    if (!conversa) return [];
    
    return conversa.mensagens.slice(-limite);
  }

  getConversa(conversationId) {
    return this.conversations.get(conversationId) || null;
  }

  limpar(conversationId) {
    return this.conversations.delete(conversationId);
  }

  limparAntigas(horasMaximo = 24) {
    const agora = new Date();
    const limiteIdade = horasMaximo * 60 * 60 * 1000;

    for (const [id, conversa] of this.conversations.entries()) {
      const idade = agora - conversa.atualizado_em;
      if (idade > limiteIdade) {
        this.conversations.delete(id);
      }
    }
  }
}