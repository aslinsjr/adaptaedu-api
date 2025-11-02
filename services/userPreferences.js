export class UserPreferences {
  constructor() {
    this.preferenciasPadrao = {
      modoResposta: 'auto',
      profundidade: 'detalhado',
      perguntarSempre: true,
      tiposMaterialPreferidos: [],
      formatoPreferido: null,
      limiteFragmentos: 5,
      tipoMidiaPreferido: null
    };
  }

  criar(conversationId) {
    return {
      conversationId,
      ...this.preferenciasPadrao,
      criadoEm: new Date(),
      atualizadoEm: new Date()
    };
  }

  atualizar(preferenciasAtuais, novasPreferencias) {
    const atualizado = {
      ...preferenciasAtuais,
      ...novasPreferencias,
      atualizadoEm: new Date()
    };

    // ValidaÃ§Ã£o
    if (novasPreferencias.modoResposta) {
      const modosValidos = ['auto', 'resumo', 'completo', 'fragmentos'];
      if (!modosValidos.includes(novasPreferencias.modoResposta)) {
        atualizado.modoResposta = 'auto';
      }
    }

    if (novasPreferencias.profundidade) {
      const profundidadesValidas = ['basico', 'detalhado', 'avancado'];
      if (!profundidadesValidas.includes(novasPreferencias.profundidade)) {
        atualizado.profundidade = 'detalhado';
      }
    }

    if (novasPreferencias.limiteFragmentos) {
      atualizado.limiteFragmentos = Math.max(1, Math.min(20, novasPreferencias.limiteFragmentos));
    }

    return atualizado;
  }

  aplicarPreferenciasNaBusca(preferencias, opcoesBusca) {
    const opcoesAjustadas = { ...opcoesBusca };

    // Ajusta limite baseado no modo
    if (preferencias.modoResposta === 'completo') {
      opcoesAjustadas.maxFragmentos = Math.max(opcoesAjustadas.maxFragmentos || 5, 15);
    } else if (preferencias.modoResposta === 'resumo') {
      opcoesAjustadas.maxFragmentos = Math.min(opcoesAjustadas.maxFragmentos || 5, 8);
    } else if (preferencias.modoResposta === 'fragmentos') {
      opcoesAjustadas.maxFragmentos = Math.min(opcoesAjustadas.maxFragmentos || 5, 5);
    }

    // Filtros por tipo preferido
    if (preferencias.tiposMaterialPreferidos?.length > 0 && !opcoesAjustadas.filtros?.tipo) {
      opcoesAjustadas.filtros = opcoesAjustadas.filtros || {};
      opcoesAjustadas.filtros.tipos = preferencias.tiposMaterialPreferidos;
    }

    return opcoesAjustadas;
  }

  interpretarIntencaoUsuario(mensagem, preferenciasAtuais) {
    const lower = mensagem.toLowerCase();
    const novasPreferencias = {};

    // Detecta mudanÃ§a de preferÃªncia explÃ­cita
    if (lower.match(/\b(nÃ£o|nunca|para de) (perguntar|questionar|me perguntar)\b/)) {
      novasPreferencias.perguntarSempre = false;
    }

    if (lower.match(/\b(sempre|pode) (perguntar|questionar|me perguntar)\b/)) {
      novasPreferencias.perguntarSempre = true;
    }

    // Detecta mudanÃ§a de modo
    const modos = {
      resumo: /\b(resumo|resumir|resumido|breve|rÃ¡pido)\b/,
      completo: /\b(completo|tudo|detalhado|aprofundado)\b/,
      fragmentos: /\b(fragmentos|trechos|partes|pedaÃ§os)\b/
    };

    for (const [modo, regex] of Object.entries(modos)) {
      if (lower.match(regex)) {
        novasPreferencias.modoResposta = modo;
        break;
      }
    }

    // Detecta profundidade
    if (lower.match(/\b(bÃ¡sico|simples|fÃ¡cil|iniciante)\b/)) {
      novasPreferencias.profundidade = 'basico';
    } else if (lower.match(/\b(avanÃ§ado|tÃ©cnico|complexo|profundo)\b/)) {
      novasPreferencias.profundidade = 'avancado';
    }

    // Se encontrou mudanÃ§as, atualiza
    if (Object.keys(novasPreferencias).length > 0) {
      return this.atualizar(preferenciasAtuais, novasPreferencias);
    }

    return null;
  }

  extrairPreferenciasDeEscolha(escolhaUsuario, opcoesApresentadas) {
    const preferencias = {};

    // Se usuÃ¡rio escolheu opÃ§Ã£o especÃ­fica, extrai preferÃªncia
    if (escolhaUsuario.opcaoEscolhida && opcoesApresentadas) {
      const opcaoEscolhida = opcoesApresentadas[escolhaUsuario.opcaoEscolhida - 1];
      
      if (opcaoEscolhida) {
        // Mapeia tipo de opÃ§Ã£o para preferÃªncia
        if (opcaoEscolhida.tipo) {
          preferencias.formatoPreferido = opcaoEscolhida.tipo;
        }
        
        if (opcaoEscolhida.modo) {
          preferencias.modoResposta = opcaoEscolhida.modo;
        }
      }
    }

    // Adiciona preferÃªncias extraÃ­das do texto
    if (escolhaUsuario.modoResposta !== 'auto') {
      preferencias.modoResposta = escolhaUsuario.modoResposta;
    }

    if (escolhaUsuario.profundidade) {
      preferencias.profundidade = escolhaUsuario.profundidade;
    }

    if (escolhaUsuario.documentoEspecifico) {
      preferencias.ultimoDocumento = escolhaUsuario.documentoEspecifico;
    }

    if (escolhaUsuario.tipoMidia) {
      preferencias.tipoMidiaPreferido = escolhaUsuario.tipoMidia;
    }

    return preferencias;
  }

  deveAplicarPreferencias(preferencias, contexto) {
    // NÃ£o aplicar se usuÃ¡rio quer sempre ser perguntado
    if (preferencias.perguntarSempre === true && contexto.isPrimeiraInteracao) {
      return false;
    }

    // Aplicar se hÃ¡ preferÃªncias definidas
    return preferencias.modoResposta !== 'auto' || 
           preferencias.tiposMaterialPreferidos?.length > 0;
  }
}