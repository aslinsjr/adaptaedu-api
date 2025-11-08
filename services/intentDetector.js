// services/intentDetector.js
export class IntentDetector {
  constructor() {
    this.intencoes = {
      CASUAL: 'casual',
      DESCOBERTA: 'descoberta',
      CONSULTA: 'consulta',
      ESCOLHA_MATERIAL: 'escolha_material'
    };

    this.padroesCasuais = [
      /^(oi|olá|ola|hey|hi|hello|e aí|eai)[\s\?\!]*(?:$|\.|!)/i,
      /^(bom dia|boa tarde|boa noite)[\s\?\!]*(?:$|\.|!)/i,
      /^(tudo bem|como vai|beleza|tranquilo)[\s\?\!]*(?:$|\?|\.)/i,
      /^(obrigad[oa]|valeu|thanks|thank you|grato|gratidão)[\s\?\!]*(?:$|\.|!)/i,
      /^(ok|okay|entendi|certo|perfeito|show|legal|massa)[\s\?\!]*(?:$|\.|!)/i,
      /^(tchau|até|falou|bye|adeus)[\s\?\!]*(?:$|\.|!)/i
    ];

    this.padroesDescoberta = [
      /\b(o que (você|voce|vc|tu) (pode|sabe|ensina|tem|conhece|faz))\b/i,
      /\b(quais (assuntos|tópicos|topicos|materiais|temas|coisas) (você|vc|tu) (tem|sabe|ensina))\b/i,
      /\b(que (materias|matérias|assuntos|temas|conteúdos) (tem|há|ha|existe|disponível))\b/i,
      /\b(mostre|liste|apresente).*(disponível|disponiveis|materiais|assuntos|conteúdo)\b/i,
      /\b(explore|conhecer|descobrir).*(materiais|conteúdos|conteudos|assuntos)\b/i,
      /\b(quero ver|me mostra|tem o que)\b/i
    ];
  }

  detectar(mensagem, contextoCompleto = {}) {
    const { contextoConversacional } = contextoCompleto;
    const lower = mensagem.toLowerCase().trim();

    // 1. ESCOLHA DE MATERIAL (prioridade máxima quando aguardando)
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

    // 2. CASUAL (saudações, agradecimentos)
    for (const padrao of this.padroesCasuais) {
      if (padrao.test(lower)) {
        return {
          intencao: this.intencoes.CASUAL,
          confianca: 0.95,
          metadados: { razao: 'saudacao' }
        };
      }
    }

    // 3. DESCOBERTA (exploração de tópicos disponíveis)
    for (const padrao of this.padroesDescoberta) {
      if (padrao.test(lower)) {
        return {
          intencao: this.intencoes.DESCOBERTA,
          confianca: 0.93,
          metadados: { razao: 'exploracao' }
        };
      }
    }

    // 4. CONSULTA (padrão - qualquer pergunta)
    return {
      intencao: this.intencoes.CONSULTA,
      confianca: 0.80,
      metadados: { razao: 'pergunta_aprendizado' }
    };
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
}