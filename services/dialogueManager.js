// services/dialogueManager.js
export class DialogueManager {
  constructor(aiService) {
    this.ai = aiService;
  }

  detectarPreferenciaImplicita(mensagem) {
    const lower = mensagem.toLowerCase();
    const preferencias = {};

    // Tipo de material
    if (lower.match(/\b(vídeo|vídeos|video|videos|assistir|ver)\b/)) {
      preferencias.tiposMaterialPreferidos = ['video'];
    } else if (lower.match(/\b(texto|ler|leitura|artigo|pdf|doc)\b/)) {
      preferencias.tiposMaterialPreferidos = ['texto'];
    } else if (lower.match(/\b(áudio|audio|ouvir|podcast)\b/)) {
      preferencias.tiposMaterialPreferidos = ['audio'];
    } else if (lower.match(/\b(imagem|imagens|image|png|jpg|jpeg|figura|ilustração|ilustracao|visual|foto)\b/)) {
      preferencias.tiposMaterialPreferidos = ['imagem'];
    }

    // Profundidade
    if (lower.match(/\b(básico|basico|simples|iniciante|fácil|facil|resumo)\b/)) {
      preferencias.profundidade = 'basico';
      preferencias.limiteFragmentos = 3;
    } else if (lower.match(/\b(avançado|avancado|técnico|tecnico|profundo|detalhado|completo)\b/)) {
      preferencias.profundidade = 'avancado';
      preferencias.limiteFragmentos = 10;
    }

    return Object.keys(preferencias).length > 0 ? preferencias : null;
  }

  detectarTipoMidiaSolicitado(mensagem) {
    const lower = mensagem.toLowerCase();
    
    // Imagem - mais abrangente
    if (lower.match(/\b(imagem|imagens|image|png|jpg|jpeg|gif|figura|ilustração|ilustracao|foto|desenho|gráfico|grafico)\b/)) {
      return {
        tipo: 'imagem',
        filtros: ['png', 'jpg', 'jpeg', 'gif', 'image', 'imagem']
      };
    }
    
    // Vídeo
    if (lower.match(/\b(vídeo|vídeos|video|videos|mp4|avi|mkv)\b/)) {
      return {
        tipo: 'video',
        filtros: ['video', 'mp4', 'avi', 'mkv']
      };
    }
    
    // Texto
    if (lower.match(/\b(texto|pdf|doc|docx|txt|documento)\b/)) {
      return {
        tipo: 'texto',
        filtros: ['pdf', 'doc', 'docx', 'txt', 'texto']
      };
    }
    
    // Áudio
    if (lower.match(/\b(áudio|audio|mp3|ouvir|podcast)\b/)) {
      return {
        tipo: 'audio',
        filtros: ['audio', 'mp3']
      };
    }
    
    return null;
  }

  async coletarPreferenciasNatural(resposta, contexto) {
    const preferencias = this.detectarPreferenciaImplicita(resposta);
    return preferencias || {};
  }
}