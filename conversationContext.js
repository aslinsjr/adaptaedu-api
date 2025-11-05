// services/conversationContext.js
export class ConversationContext {
  constructor() {
    this.topicoAtual = null;
    this.ultimaIntencao = null;
    this.fluxoAtivo = null; // 'apresentacao', 'consulta', 'escolha_material', 'explicacao'
    this.aguardandoResposta = null; // 'escolha_material', 'nivel_conhecimento', 'confirmacao'
    this.documentosMencionados = [];
    this.historicoIntencoes = [];
    this.ultimaResposta = null;
    this.timestamp = new Date();
  }

  atualizarContexto(mensagemUsuario, respostaAssistant, intencao, metadata = {}) {
    this.ultimaIntencao = intencao;
    this.ultimaResposta = respostaAssistant;
    this.timestamp = new Date();
    
    // Detectar mudança de tópico
    if (this.isMudancaTopico(mensagemUsuario) || this.isNovoTopico(mensagemUsuario)) {
      this.topicoAtual = this.extrairTopico(mensagemUsuario) || this.topicoAtual;
      this.fluxoAtivo = 'consulta';
      this.aguardandoResposta = null;
    }
    
    // Gerenciar fluxos baseado na intenção
    this.gerenciarFluxo(intencao, metadata);
    
    // Atualizar histórico de intenções
    this.historicoIntencoes.push({
      intencao,
      mensagem: mensagemUsuario,
      resposta: respostaAssistant,
      timestamp: this.timestamp,
      metadata
    });
    
    // Manter apenas últimas 10 intenções
    if (this.historicoIntencoes.length > 10) {
      this.historicoIntencoes = this.historicoIntencoes.slice(-10);
    }
  }

  gerenciarFluxo(intencao, metadata) {
    switch (intencao) {
      case 'lista_materiais':
        this.aguardandoResposta = 'escolha_material';
        this.fluxoAtivo = 'escolha';
        break;
      case 'engajamento_topico':
        this.fluxoAtivo = 'aguardando_especificacao';
        this.aguardandoResposta = 'detalhes_topico';
        break;
      case 'confirmacao':
        if (this.aguardandoResposta === 'confirmacao') {
          this.aguardandoResposta = null;
          this.fluxoAtivo = 'consulta';
        }
        break;
      case 'consulta':
        this.fluxoAtivo = 'explicacao';
        this.aguardandoResposta = null;
        break;
      case 'nivel_conhecimento':
        this.fluxoAtivo = 'explicacao_adaptada';
        this.aguardandoResposta = null;
        break;
      default:
        if (!this.aguardandoResposta) {
          this.fluxoAtivo = 'conversa';
        }
    }
  }

  isMudancaTopico(mensagem) {
    const lower = mensagem.toLowerCase();
    const palavrasMudanca = [
      'outro', 'diferente', 'mudar', 'agora', 'e sobre', 'mas e', 'e quanto',
      'e se', 'e para', 'e como', 'e por que', 'e porque'
    ];
    return palavrasMudanca.some(palavra => lower.includes(palavra));
  }

  isNovoTopico(mensagem) {
    const lower = mensagem.toLowerCase();
    const palavrasTopico = [
      'quero saber', 'ensina', 'explica', 'fala', 'conta', 'mostra',
      'sobre', 'acerca de', 'a respeito de'
    ];
    return palavrasTopico.some(palavra => lower.includes(palavra)) && 
           !this.isContinuacao(mensagem);
  }

  isContinuacao(mensagem) {
    const lower = mensagem.toLowerCase();
    const palavrasContinuacao = [
      'mais', 'continua', 'prossiga', 'e depois', 'e então', 'e ai',
      'detalhe', 'detalhes', 'exemplo', 'exemplos'
    ];
    return palavrasContinuacao.some(palavra => lower.includes(palavra));
  }

  extrairTopico(mensagem) {
    const lower = mensagem.toLowerCase();
    
    // Remover palavras de transição
    const palavrasTransicao = [
      'e', 'mas', 'porém', 'então', 'ai', 'agora', 'sobre', 'acerca', 'a respeito',
      'quero', 'gostaria', 'pode', 'poderia', 'ensinar', 'explicar', 'falar'
    ];
    
    const palavras = lower.split(/\s+/)
      .filter(palavra => palavra.length > 2 && !palavrasTransicao.includes(palavra))
      .slice(0, 3);
    
    return palavras.length > 0 ? palavras.join(' ') : null;
  }

  getContextoParaDetecao() {
    return {
      topicoAtual: this.topicoAtual,
      ultimaIntencao: this.ultimaIntencao,
      fluxoAtivo: this.fluxoAtivo,
      aguardandoResposta: this.aguardandoResposta,
      historicoRecente: this.historicoIntencoes.slice(-3)
    };
  }

  limparContexto() {
    this.aguardandoResposta = null;
    this.fluxoAtivo = 'conversa';
  }

  isConversaAtiva() {
    // Considerar conversa ativa se houve interação nos últimos 2 minutos
    const doisMinutos = 2 * 60 * 1000;
    return (new Date() - this.timestamp) < doisMinutos;
  }
}