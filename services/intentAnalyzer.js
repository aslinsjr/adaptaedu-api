// services/intentAnalyzer.js
export class IntentAnalyzer {
  constructor(aiService) {
    this.ai = aiService;
    this.intencoes = {
      CASUAL: 'casual',
      DESCOBERTA: 'descoberta',
      CONSULTA: 'consulta',
      ESCOLHA_MATERIAL: 'escolha_material'
    };
  }

  async analisarComIA(mensagem, contextoCompleto = {}) {
    const { contextoConversacional, historico } = contextoCompleto;

    // Prioridade: escolha pendente
    if (contextoConversacional?.aguardandoResposta === 'escolha_material') {
      const escolha = this.extrairEscolhaNumerica(mensagem);
      if (escolha !== null) {
        return {
          intencao: this.intencoes.ESCOLHA_MATERIAL,
          confianca: 0.98,
          metadados: { escolha }
        };
      }
    }

    try {
      const resultado = await this.ai.analisarIntencao(mensagem, historico, contextoConversacional);
      return resultado;
    } catch (error) {
      console.error('Erro na análise de intenção com IA:', error);
      return this.fallbackRegex(mensagem);
    }
  }

  extrairEscolhaNumerica(mensagem) {
    const lower = mensagem.toLowerCase();
    const match = lower.match(/\b(\d+)\b/);
    if (match) {
      const numero = parseInt(match[1]);
      if (numero >= 1 && numero <= 10) return numero - 1;
    }

    const opcoes = ['primeiro', 'segunda', 'terceiro', 'quarto', 'quinto'];
    for (let i = 0; i < opcoes.length; i++) {
      if (lower.includes(opcoes[i])) return i;
    }

    return null;
  }

  fallbackRegex(mensagem) {
    const lower = mensagem.toLowerCase().trim();

    // Padrões casualis
    const padroesCasuais = [
      /^(oi|olá|ola|hey|hi|hello|e aí|eai)[\s\?\!]*(?:$|\.|!)/i,
      /^(bom dia|boa tarde|boa noite)[\s\?\!]*(?:$|\.|!)/i,
      /^(tudo bem|como vai|beleza|tranquilo)[\s\?\!]*(?:$|\?|\.)/i,
      /^(obrigad[oa]|valeu|thanks|thank you|grato|gratidão)[\s\?\!]*(?:$|\.|!)/i,
      /^(ok|okay|entendi|certo|perfeito|show|legal|massa)[\s\?\!]*(?:$|\.|!)/i,
      /^(tchau|até|falou|bye|adeus)[\s\?\!]*(?:$|\.|!)/i
    ];

    for (const padrao of padroesCasuais) {
      if (padrao.test(lower)) {
        return {
          intencao: this.intencoes.CASUAL,
          confianca: 0.95,
          metadados: { razao: 'saudacao', fallback: true }
        };
      }
    }

    // Padrões descoberta
    const padroesDescoberta = [
      /\b(o que (você|voce|vc|tu) (pode|sabe|ensina|tem|conhece|faz))\b/i,
      /\b(quais (assuntos|tópicos|topicos|materiais|temas|coisas) (você|vc|tu) (tem|sabe|ensina))\b/i,
      /\b(que (materias|matérias|assuntos|temas|conteúdos) (tem|há|ha|existe|disponível))\b/i,
      /\b(mostre|liste|apresente).*(disponível|disponiveis|materiais|assuntos|conteúdo)\b/i
    ];

    for (const padrao of padroesDescoberta) {
      if (padrao.test(lower)) {
        return {
          intencao: this.intencoes.DESCOBERTA,
          confianca: 0.93,
          metadados: { razao: 'exploracao', fallback: true }
        };
      }
    }

    // Default: consulta
    return {
      intencao: this.intencoes.CONSULTA,
      confianca: 0.80,
      metadados: { razao: 'pergunta_aprendizado', fallback: true }
    };
  }
}