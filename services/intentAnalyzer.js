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
      
      // Tentar mapear escolha textual
      const materiaisPendentes = contextoConversacional.materiaisPendentes;
      if (materiaisPendentes) {
        const escolhaTextual = await this.mapearEscolhaTextual(mensagem, materiaisPendentes, historico);
        if (escolhaTextual !== null) {
          return {
            intencao: this.intencoes.ESCOLHA_MATERIAL,
            confianca: 0.95,
            metadados: { escolha: escolhaTextual }
          };
        }
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

  async mapearEscolhaTextual(mensagem, materiaisPendentes, historico) {
    try {
      const opcoes = materiaisPendentes.map((m, i) => ({
        numero: i,
        nome: m.arquivo_nome,
        tipo: m.tipo
      }));

      const prompt = `Usuário escolheu um material. Identifique qual:

OPÇÕES DISPONÍVEIS:
${opcoes.map((o, i) => `${i}: ${o.nome} (${o.tipo})`).join('\n')}

ESCOLHA DO USUÁRIO: "${mensagem}"

Responda APENAS com o número (0-${opcoes.length - 1}) da opção escolhida ou "null" se não identificar.
Exemplos:
- "o livro" → procure qual opção é livro/texto
- "o vídeo" → procure qual opção é vídeo
- "a apresentação" → procure qual opção é apresentação/slides`;

      const resultado = await this.ai.chatModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 10 }
      });

      const resposta = resultado.response.text().trim();
      const numero = parseInt(resposta);
      
      if (!isNaN(numero) && numero >= 0 && numero < opcoes.length) {
        return numero;
      }
    } catch (error) {
      console.error('Erro ao mapear escolha textual:', error);
    }
    
    return null;
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

    // Tentar extrair tópico básico para consulta
    const topicoExtraido = this.extrairTopicoBasico(mensagem);

    // Default: consulta
    return {
      intencao: this.intencoes.CONSULTA,
      confianca: 0.80,
      metadados: { 
        razao: 'pergunta_aprendizado', 
        fallback: true,
        topico_mencionado: topicoExtraido
      }
    };
  }

  extrairTopicoBasico(mensagem) {
    const lower = mensagem.toLowerCase();
    const stopWords = new Set([
      'quero', 'saber', 'sobre', 'me', 'fale', 'explique', 'ensine', 
      'mostre', 'o que', 'é', 'são', 'como', 'quando', 'onde', 'qual'
    ]);

    const palavras = lower
      .replace(/[^\w\sáàâãéèêíïóôõöúçñ]/g, '')
      .split(/\s+/)
      .filter(p => p.length > 2 && !stopWords.has(p));

    return palavras.length > 0 ? palavras.join(' ') : null;
  }
}