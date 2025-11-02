// services/intentDetector.js
export class IntentDetector {
  constructor() {
    this.intencoes = {
      CASUAL: 'casual',
      DESCOBERTA: 'descoberta',
      CONSULTA: 'consulta',
      ONBOARDING: 'onboarding',
      PREFERENCIA: 'preferencia',
      INTERESSE_TOPICO: 'interesse_topico'
    };

    this.padroesCasuais = [
      /^(oi|olá|ola|hey|hi|hello|bom dia|boa tarde|boa noite|tudo bem|como vai|beleza|e aí)[\s\?\!]*$/i,
      /^(obrigad[oa]|valeu|legal|ok|entendi|certo)[\s\?\!]*$/i
    ];

    this.padroesDescoberta = [
      /\b(o que (você|voce) (pode|sabe|ensina))/i,
      /\b(quais (assuntos|tópicos|topicos|materiais|temas))/i,
      /\b(que materiais (tem|há|ha|existe))/i,
      /\b(mostre|liste|apresente).*(disponível|disponiveis|materiais|assuntos)/i,
      /\b(explore|conhecer|descobrir).*(materiais|conteúdos|conteudos)/i
    ];

    this.padroesPreferencia = [
      /\b(prefiro|gosto de|quero).*(vídeo|video|texto|áudio|audio|imagem)/i,
      /\b(não|nao).*(perguntar|questionar)/i,
      /\b(sempre|pode).*(perguntar|questionar)/i,
      /\b(modo|formato|estilo).*(resumo|completo|detalhado|básico|basico)/i
    ];

    this.palavrasPergunta = [
      'como', 'o que', 'por que', 'porque', 'qual', 'quais', 'quando',
      'onde', 'explique', 'explica', 'ensine', 'ensina', 'mostre', 'mostra',
      'defina', 'define', 'diferença', 'funciona'
    ];
  }

  detectar(mensagem, contexto = {}) {
    const { isPrimeiraInteracao = false, historico = [] } = contexto;

    if (isPrimeiraInteracao) {
      return {
        intencao: this.intencoes.ONBOARDING,
        confianca: 1.0,
        metadados: { razao: 'primeira_interacao' }
      };
    }

    const lower = mensagem.toLowerCase().trim();

    // Casual
    for (const padrao of this.padroesCasuais) {
      if (padrao.test(lower)) {
        return {
          intencao: this.intencoes.CASUAL,
          confianca: 0.95,
          metadados: { razao: 'padrao_casual' }
        };
      }
    }

    // Preferência
    for (const padrao of this.padroesPreferencia) {
      if (padrao.test(lower)) {
        return {
          intencao: this.intencoes.PREFERENCIA,
          confianca: 0.9,
          metadados: { razao: 'mudanca_preferencia' }
        };
      }
    }

    // Descoberta - mas apenas se NÃO mencionar tópico específico
    for (const padrao of this.padroesDescoberta) {
      if (padrao.test(lower)) {
        // Verifica se há termo específico após o padrão
        const temTopicoEspecifico = this.extrairTermoEspecifico(mensagem);
        
        if (!temTopicoEspecifico) {
          return {
            intencao: this.intencoes.DESCOBERTA,
            confianca: 0.85,
            metadados: { razao: 'padrao_descoberta' }
          };
        }
        // Se tem tópico específico, continua para detectar como CONSULTA
        break;
      }
    }

    // Interesse em tópico (mensagem curta sem palavras de pergunta)
    const palavras = mensagem.split(/\s+/);
    const temPalavrasPergunta = this.palavrasPergunta.some(p => lower.includes(p));
    
    if (palavras.length <= 5 && !temPalavrasPergunta) {
      return {
        intencao: this.intencoes.INTERESSE_TOPICO,
        confianca: 0.8,
        metadados: { 
          razao: 'interesse_topico',
          termoBuscado: mensagem.trim()
        }
      };
    }

    // Consulta (padrão)
    return {
      intencao: this.intencoes.CONSULTA,
      confianca: 0.7,
      metadados: { 
        razao: 'padrao_default',
        comprimento: mensagem.split(/\s+/).length 
      }
    };
  }

  extrairTermoEspecifico(mensagem) {
    const lower = mensagem.toLowerCase();
    
    // Remove palavras de pergunta comuns
    const semPergunta = lower
      .replace(/\b(o que|por que|porque|qual|quais|quando|onde|como)\b/gi, '')
      .replace(/\b(você|voce|vc)\b/gi, '')
      .replace(/\b(pode|sabe|ensina|conhece)\b/gi, '')
      .replace(/\b(sobre|acerca)\b/gi, '')
      .trim();

    // Se sobrou conteúdo significativo, há termo específico
    const palavrasRestantes = semPergunta.split(/\s+/).filter(p => p.length > 2);
    return palavrasRestantes.length > 0 ? palavrasRestantes.join(' ') : null;
  }

  isConsultaEducacional(mensagem) {
    const lower = mensagem.toLowerCase();
    
    const palavrasEducacionais = [
      'como', 'o que', 'por que', 'porque', 'explique', 'ensine',
      'aprenda', 'entenda', 'conceito', 'significa', 'funciona',
      'exemplo', 'diferença', 'definição', 'teoria'
    ];

    return palavrasEducacionais.some(palavra => lower.includes(palavra));
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

    const topicos = palavras.filter(p => !stopWords.has(p));
    return topicos.slice(0, 3);
  }

  analisarContextoConversa(historico) {
    if (!historico || historico.length === 0) {
      return { 
        temContexto: false,
        topicoAtual: null,
        nivelEngajamento: 0
      };
    }

    const ultimasMensagens = historico.slice(-4);
    const mensagensUsuario = ultimasMensagens.filter(m => m.role === 'user');
    
    const topicoAtual = mensagensUsuario.length > 0 
      ? this.extrairTopicoDaMensagem(mensagensUsuario[mensagensUsuario.length - 1].content)
      : null;

    return {
      temContexto: true,
      topicoAtual,
      nivelEngajamento: Math.min(historico.length / 10, 1.0),
      ultimasIntencoes: ultimasMensagens.map(m => m.metadata?.tipo).filter(Boolean)
    };
  }
}