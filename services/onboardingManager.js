// services/onboardingManager.js
export class OnboardingManager {
  constructor(aiService, discoveryService) {
    this.ai = aiService;
    this.discovery = discoveryService;
  }

  async iniciarOnboarding(conversationId) {
    const dadosDisponiveis = await this.discovery.listarTopicosDisponiveis();
    const apresentacao = await this.gerarApresentacao(dadosDisponiveis);

    return {
      conversationId,
      mensagem: apresentacao,
      etapa: 'inicial',
      dados_contexto: {
        total_topicos: dadosDisponiveis.resumo.total_topicos,
        tipos_material: dadosDisponiveis.resumo.tipos_material,
        topicos_destaque: dadosDisponiveis.topicos.slice(0, 5).map(t => t.nome)
      }
    };
  }

  async gerarApresentacao(dadosDisponiveis) {
    const topicos = dadosDisponiveis.topicos.slice(0, 5).map(t => t.nome);
    const tipos = dadosDisponiveis.resumo.tipos_material.map(t => t.tipo);

    const prompt = `Você é um assistente educacional iniciando conversa com um novo aluno.

CONTEXTO:
- Você tem ${dadosDisponiveis.resumo.total_topicos} tópicos diferentes para ensinar
- Materiais disponíveis: ${tipos.join(', ')}
- Alguns tópicos populares: ${topicos.join(', ')}

Crie uma saudação calorosa e natural (2-3 linhas) que:
1. Se apresente como assistente de estudos
2. Mencione que pode ajudar com diversos assuntos
3. Pergunte o que o aluno gostaria de aprender
4. Seja acolhedora, não robótica

Não liste tópicos, apenas convide à exploração.`;

    return await this.ai.conversarLivremente(prompt, []);
  }

  async processarPrimeiraResposta(resposta, contexto) {
    const preferenciasDetectadas = this.detectarPreferenciasIniciais(resposta);
    
    return {
      preferencias: preferenciasDetectadas,
      deveContinuar: true,
      proximaAcao: this.definirProximaAcao(resposta)
    };
  }

  detectarPreferenciasIniciais(mensagem) {
    const lower = mensagem.toLowerCase();
    const preferencias = {};

    // Tipo de material preferido
    if (lower.match(/\b(vídeo|vídeos|assistir|ver)\b/)) {
      preferencias.tiposMaterialPreferidos = ['video'];
    } else if (lower.match(/\b(ler|leitura|texto|artigo)\b/)) {
      preferencias.tiposMaterialPreferidos = ['texto'];
    }

    // Nível
    if (lower.match(/\b(iniciante|básico|começando|começo)\b/)) {
      preferencias.profundidade = 'basico';
    } else if (lower.match(/\b(avançado|experiente|profundo)\b/)) {
      preferencias.profundidade = 'avancado';
    }

    // Estilo de aprendizado
    if (lower.match(/\b(resumo|rápido|direto|objetivo)\b/)) {
      preferencias.modoResposta = 'resumo';
      preferencias.limiteFragmentos = 3;
    } else if (lower.match(/\b(detalhado|completo|tudo|profundo)\b/)) {
      preferencias.modoResposta = 'completo';
      preferencias.limiteFragmentos = 10;
    }

    return Object.keys(preferencias).length > 0 ? preferencias : null;
  }

  definirProximaAcao(mensagem) {
    const lower = mensagem.toLowerCase();

    if (lower.match(/\b(quero|gostaria|sobre|aprender|estudar)\b/)) {
      return 'consulta';
    }

    if (lower.match(/\b(o que|quais|mostre|liste)\b/)) {
      return 'descoberta';
    }

    return 'conversa';
  }

  async gerarMensagemEncerramento() {
    return "Perfeito! Estou aqui para ajudar. É só perguntar o que você quiser aprender!";
  }
}