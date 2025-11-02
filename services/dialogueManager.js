// services/dialogueManager.js
export class DialogueManager {
  constructor(aiService) {
    this.ai = aiService;
  }

  detectarPreferenciaImplicita(mensagem) {
    const lower = mensagem.toLowerCase();
    const preferencias = {};

    // Tipo de material
    if (lower.match(/\b(vídeo|vídeos|assistir|ver)\b/)) {
      preferencias.tiposMaterialPreferidos = ['video'];
    } else if (lower.match(/\b(texto|ler|leitura|artigo)\b/)) {
      preferencias.tiposMaterialPreferidos = ['texto'];
    } else if (lower.match(/\b(áudio|ouvir|podcast)\b/)) {
      preferencias.tiposMaterialPreferidos = ['audio'];
    } else if (lower.match(/\b(imagem|imagens|visual)\b/)) {
      preferencias.tiposMaterialPreferidos = ['imagem'];
    }

    // Profundidade
    if (lower.match(/\b(básico|simples|iniciante|fácil|resumo)\b/)) {
      preferencias.profundidade = 'basico';
      preferencias.limiteFragmentos = 3;
    } else if (lower.match(/\b(avançado|técnico|profundo|detalhado|completo)\b/)) {
      preferencias.profundidade = 'avancado';
      preferencias.limiteFragmentos = 10;
    }

    return Object.keys(preferencias).length > 0 ? preferencias : null;
  }

  async coletarPreferenciasNatural(resposta, contexto) {
    const preferencias = this.detectarPreferenciaImplicita(resposta);
    return preferencias || {};
  }
}