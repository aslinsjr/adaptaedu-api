// services/conversationContext.js
export class ConversationContext {
  constructor() {
    this.topicoAtual = null;
    this.ultimaIntencao = null;
    this.aguardandoResposta = null; // 'escolha_material' ou null
    this.timestamp = new Date();
  }

  atualizarContexto(mensagemUsuario, respostaAssistant, intencao, metadata = {}) {
    this.ultimaIntencao = intencao;
    this.timestamp = new Date();
    
    // Gerenciar fluxo baseado na intenção
    if (intencao === 'escolha_material') {
      this.aguardandoResposta = null; // Escolha feita
    }
    
    if (metadata.aguardando_escolha) {
      this.aguardandoResposta = 'escolha_material';
    }

    // Atualizar tópico se fornecido
    if (metadata.topico) {
      this.topicoAtual = metadata.topico;
    }
  }

  getContextoParaDetecao() {
    return {
      topicoAtual: this.topicoAtual,
      ultimaIntencao: this.ultimaIntencao,
      aguardandoResposta: this.aguardandoResposta
    };
  }

  limparContexto() {
    this.aguardandoResposta = null;
  }
}