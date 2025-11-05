// services/intentDetector.js
export class IntentDetector {
  constructor() {
    this.intencoes = {
      CASUAL: 'casual',
      DESCOBERTA: 'descoberta',
      CONSULTA: 'consulta',
      PREFERENCIA: 'preferencia',
      INTERESSE_TOPICO: 'interesse_topico',
      CONTINUACAO: 'continuacao',
      CONFIRMACAO: 'confirmacao'
    };

    this.padroesCasuais = [
      /^(oi|olá|ola|hey|hi|hello|bom dia|boa tarde|boa noite|tudo bem|como vai|beleza|e aí)[\s\?\!]*$/i,
      /^(obrigad[oa]|valeu|legal|ok|entendi|certo)[\s\?\!]*$/i,
      /^edu/i
    ];

    this.padroesConfirmacao = [
      /^(sim|claro|ok|beleza|perfeito|ótimo|vamos|com certeza|pode|quero|quero sim|quero ver|quero aprender)/i,
      /^(vamos sim|vamos lá|bora|dale|dale sim)/i
    ];

    this.padroesDescoberta = [
      /\b(o que (você|voce) (pode|sabe|ensina|tem|conhece))\b/i,
      /\b(quais (assuntos|tópicos|topicos|materiais|temas|você tem))\b/i,
      /\b(que materiais (tem|há|ha|existe|disponível))\b/i,
      /\b(mostre|liste|apresente).*(disponível|disponiveis|materiais|assuntos)\b/i,
      /\b(explore|conhecer|descobrir).*(materiais|conteúdos|conteudos)\b/i,
      /\b(ensinar|aprender|estudar)\b.*\b(o que|quais)\b/i
    ];

    this.padroesContinuacao = [
      /^(vamos|continue|prossiga|pode continuar|me explica|explica|conta mais|fala mais)/i,
      /^(legal|ótimo|perfeito|show|beleza|certo|ok|sim),?\s+(vamos|continue|prossiga|começa|começar|me explica)/i,
      /^(vamos lá|bora|pode ir|vai)/i,
      /^(e (aí|ai|agora|então))/i,
      /^(começar|iniciar).*(básico|basico|introdução|iniciante)/i,
      /^(pode|posso).*(começar|iniciar).*(básico|basico)/i
    ];

    this.padroesPreferencia = [
      /\b(prefiro|gosto de|quero).*(vídeo|video|texto|áudio|audio|imagem)\b/i,
      /\b(não|nao).*(perguntar|questionar)\b/i,
      /\b(sempre|pode).*(perguntar|questionar)\b/i,
      /\b(modo|formato|estilo).*(resumo|completo|detalhado|básico|basico)\b/i
    ];

    this.palavrasPergunta = [
      'como', 'o que', 'por que', 'porque', 'qual', 'quais', 'quando',
      'onde', 'explique', 'explica', 'ensine', 'ensina', 'mostre', 'mostra',
      'defina', 'define', 'diferença', 'funciona'
    ];
  }

  detectar(mensagem, contexto = {}) {
    const { historico = [] } = contexto;
    const lower = mensagem.toLowerCase().trim();

    // CONFIRMAÇÃO
    for (const padrao of this.padroesConfirmacao) {
      if (padrao.test(lower)) {
        const contextoAtivo = this.verificarContextoAtivo(historico);
        if (contextoAtivo.temContexto && contextoAtivo.fragmentosPendentes?.length > 0) {
          return {
            intencao: this.intencoes.CONFIRMACAO,
            confianca: 0.97,
            metadados: { razao: 'confirmacao_com_fragmentos', fragmentosPendentes: contextoAtivo.fragmentosPendentes }
          };
        }
      }
    }

    // CASUAL
    for (const padrao of this.padroesCasuais) {
      if (padrao.test(lower)) {
        return { intencao: this.intencoes.CASUAL, confianca: 0.98, metadados: { razao: 'padrao_casual' } };
      }
    }

    // DESCOBERTA
    for (const padrao of this.padroesDescoberta) {
      if (padrao.test(lower)) {
        return { intencao: this.intencoes.DESCOBERTA, confianca: 0.95, metadados: { razao: 'padrao_descoberta' } };
      }
    }

    // CONTINUAÇÃO
    const contextoAtivo = this.verificarContextoAtivo(historico);
    for (const padrao of this.padroesContinuacao) {
      if (padrao.test(lower) && contextoAtivo.temContexto) {
        return {
          intencao: this.intencoes.CONTINUACAO,
          confianca: 0.92,
          metadados: { 
            razao: 'continuacao_contexto',
            topico_contexto: contextoAtivo.topico,
            tipo_anterior: contextoAtivo.tipoResposta
          }
        };
      }
    }

    // PREFERÊNCIA
    for (const padrao of this.padroesPreferencia) {
      if (padrao.test(lower)) {
        return { intencao: this.intencoes.PREFERENCIA, confianca: 0.9, metadados: { razao: 'mudanca_preferencia' } };
      }
    }

    // INTERESSE EM TÓPICO
    const temPalavrasPergunta = this.palavrasPergunta.some(p => lower.includes(p));
    const palavras = mensagem.split(/\s+/);
    if (palavras.length <= 5 && !temPalavrasPergunta) {
      return {
        intencao: this.intencoes.INTERESSE_TOPICO,
        confianca: 0.8,
        metadados: { razao: 'interesse_topico', termoBuscado: mensagem.trim() }
      };
    }

    // CONSULTA PADRÃO
    const metadados = { razao: 'padrao_default', comprimento: palavras.length };
    if (palavras.length <= 6 && contextoAtivo.temContexto) {
      metadados.topico_contexto = contextoAtivo.topico;
      metadados.usar_contexto_historico = true;
    }
    return { intencao: this.intencoes.CONSULTA, confianca: 0.7, metadados };
  }

  verificarContextoAtivo(historico) {
    if (!historico || historico.length === 0) return { temContexto: false };
    const mensagensRecentes = historico.slice(-3);
    const ultimaResposta = mensagensRecentes.find(m => m.role === 'assistant');
    if (!ultimaResposta) return { temContexto: false };

    const tipoResposta = ultimaResposta.metadata?.tipo;
    const topico = ultimaResposta.metadata?.topico;
    const fragmentos = ultimaResposta.fragmentos;

    const temContexto = ['consulta', 'engajamento_topico', 'descoberta'].includes(tipoResposta);
    if (temContexto && fragmentos?.length > 0) {
      const topicoExtraido = topico || this.extrairTopicoDeResposta(ultimaResposta.content);
      return { 
        temContexto: true, 
        topico: topicoExtraido, 
        tipoResposta,
        fragmentosPendentes: fragmentos
      };
    }
    return { temContexto: false };
  }

  extrairTopicoDeResposta(resposta) {
    if (!resposta) return null;
    const padroes = [
      /materiais sobre ([a-záàâãéèêíïóôõöúçñ\s]+)/i,
      /sobre ([a-záàâãéèêíïóôõöúçñ\s]+)/i,
      /tópico[:\s]+([a-záàâãéèêíïóôõöúçñ\s]+)/i,
      /aprender ([a-záàâãéèêíïóôõöúçñ\s]+)/i
    ];
    for (const padrao of padroes) {
      const match = resposta.match(padrao);
      if (match) return match[1].trim().split(/\s+/).slice(0, 3).join(' ');
    }
    return null;
  }

  extrairTopicoDaMensagem(mensagem) {
    const lower = mensagem.toLowerCase();
    const palavras = lower.split(/\s+/).filter(p => p.length > 3);
    const stopWords = new Set([
      'como', 'que', 'para', 'sobre', 'qual', 'quais', 'quando',
      'onde', 'porque', 'quem', 'quanto', 'pela', 'pelo', 'esta',
      'esse', 'essa', 'isso', 'aqui', 'ali', 'mais', 'menos',
      'você', 'voce', 'pode', 'sabe', 'ensina', 'conhece'
    ]);
    return palavras.filter(p => !stopWords.has(p)).slice(0, 3);
  }
}