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
      CONFIRMACAO: 'confirmacao',
      NIVEL_CONHECIMENTO: 'nivel_conhecimento',
      FOLLOW_UP: 'follow_up',
      REEXPLICACAO: 'reexplicacao',
      ESCOLHA_MATERIAL: 'escolha_material',
      DETALHAMENTO: 'detalhamento'
    };

    this.padroesCasuais = [
      /^(oi|olá|ola|hey|hi|hello|e aí|eai)[\s\?\!]*(?:$|\.|!)/i,
      /^(bom dia|boa tarde|boa noite)[\s\?\!]*(?:$|\.|!)/i,
      /^(tudo bem|como vai|beleza|tranquilo)[\s\?\!]*(?:$|\?|\.)/i,
      /^(obrigad[oa]|valeu|thanks|thank you|grato|gratidão)[\s\?\!]*(?:$|\.|!)/i,
      /^(ok|okay|entendi|certo|perfeito|show|legal|masssa)[\s\?\!]*(?:$|\.|!)/i
    ];

    this.padroesConfirmacao = [
      /^(sim|claro|com certeza|certamente|óbvio|lógico|naturalmente)/i,
      /^(pode|pode sim|pode ir|pode ser|pode continuar)/i,
      /^(quero|quero sim|quero ver|quero saber|quero aprender)/i,
      /^(vamos|vamos sim|vamos lá|bora|dale|vai)/i,
      /^(isso|isso mesmo|exatamente|correto|cert[oa])/i
    ];

    this.padroesNivelConhecimento = [
      /\b(não|nao|nunca|zero).*(conheço|sei|saber|entendo|entender|vi|estudei)/i,
      /\b(pouco|quase nada|bem pouco|iniciante|começando|início|básico)/i,
      /\b(já sei|conheço|domino|avançado|experiente|sei bem|entendo bem)/i,
      /\b(me explica|explica|ensina).*(como se|para leigos|para iniciantes)/i
    ];

    this.padroesDescoberta = [
      /\b(o que (você|voce|vc|tu) (pode|sabe|ensina|tem|conhece|faz))\b/i,
      /\b(quais (assuntos|tópicos|topicos|materiais|temas|coisas) (você|vc|tu) (tem|sabe|ensina))\b/i,
      /\b(que (materias|matérias|assuntos|temas|conteúdos) (tem|há|ha|existe|disponível))\b/i,
      /\b(mostre|liste|apresente).*(disponível|disponiveis|materiais|assuntos|conteúdo)\b/i,
      /\b(explore|conhecer|descobrir).*(materiais|conteúdos|conteudos|assuntos)\b/i,
      /\b(ensinar|aprender|estudar)\b.*\b(o que|quais|que)\b/i
    ];

    this.padroesContinuacao = [
      /^(vamos|continue|prossiga|pode continuar|segue|anda)/i,
      /^(e (aí|ai|agora|então|depois|como fica))(\s|$)/i,
      /^(conta|conta mais|fala|fala mais|diz|diz mais)/i,
      /^(mais|mais detalhes|mais informações|mais coisa)/i,
      /^(e (sobre|acerca|a respeito)|e (para|por|como|quando|onde))/i
    ];

    this.padroesFollowUp = [
      /\b(como assim|o que quer dizer|não entendi|não compreendi)\b/i,
      /\b(pode|poderia).*(explicar|esclarecer|detalhar).*(melhor|mais)\b/i,
      /\b(tem|tem algum|tem mais).*(exemplo|exemplos|caso)\b/i,
      /\b(e|mas|porém|só que).*(como|porque|por que|quando|onde)\b/i,
      /\b(funciona|serve|aplica).*(em|para|com)\b/i,
      /\b(qual|quais).*(a diferença|as diferenças|diferença)\b/i
    ];

    this.padroesReexplicacao = [
      /\b(não entendi|não compreendi|não captei|não peguei)\b/i,
      /\b(explique|esclareça|detalhe).*(de novo|novamente|outra vez)\b/i,
      /\b(repete|repetir|diz de novo|fala de novo)\b/i,
      /\b(mais (devagar|lento|calmo|simples|fácil))\b/i,
      /\b(mais (claro|detalhado|explicado))\b/i
    ];

    this.palavrasPergunta = [
      'como', 'o que', 'por que', 'porque', 'qual', 'quais', 'quando',
      'onde', 'quem', 'porquê', 'explique', 'explica', 'ensine', 'ensina',
      'mostre', 'mostra', 'defina', 'define', 'diferença', 'funciona'
    ];

    this.topicosConhecidos = {
      'html': ['html', 'html5', 'páginas web', 'pagina html', 'construir página', 'criar site', 'hypertext'],
      'css': ['css', 'estilo', 'estilizar', 'folha de estilo', 'cascading', 'design'],
      'javascript': ['javascript', 'js', 'script', 'interatividade', 'programação web', 'ecmascript'],
      'programação': ['programação', 'programar', 'codar', 'código', 'desenvolvimento', 'coding']
    };
  }

  detectar(mensagem, contextoCompleto = {}) {
    const { historico = [], contextoConversacional } = contextoCompleto;
    const lower = mensagem.toLowerCase().trim();

    // 1. VERIFICAR CONTINUAÇÃO DE FLUXO EXISTENTE
    if (contextoConversacional) {
      const intencaoContinuacao = this.detectarContinuacaoFluxo(mensagem, contextoConversacional);
      if (intencaoContinuacao && intencaoContinuacao.confianca > 0.7) {
        return intencaoContinuacao;
      }
    }

    // 2. ANÁLISE CONVERSACIONAL CONTEXTUAL
    const analiseConversacional = this.analisarContextoConversacional(mensagem, historico, contextoConversacional);
    if (analiseConversacional.confianca > 0.8) {
      return analiseConversacional;
    }

    // 3. DETECÇÃO POR PADRÕES TRADICIONAIS (com melhorias)
    
    // CONFIRMAÇÃO
    for (const padrao of this.padroesConfirmacao) {
      if (padrao.test(lower)) {
        return {
          intencao: this.intencoes.CONFIRMACAO,
          confianca: 0.95,
          metadados: { razao: 'confirmacao_explicita' }
        };
      }
    }

    // NÍVEL CONHECIMENTO
    for (const padrao of this.padroesNivelConhecimento) {
      if (padrao.test(lower)) {
        return {
          intencao: this.intencoes.NIVEL_CONHECIMENTO,
          confianca: 0.92,
          metadados: { razao: 'declaracao_nivel_conhecimento' }
        };
      }
    }

    // CASUAL
    for (const padrao of this.padroesCasuais) {
      if (padrao.test(lower)) {
        return { 
          intencao: this.intencoes.CASUAL, 
          confianca: 0.96, 
          metadados: { razao: 'padrao_casual' } 
        };
      }
    }

    // FOLLOW-UP/REEXPLICAÇÃO
    for (const padrao of this.padroesFollowUp) {
      if (padrao.test(lower)) {
        return {
          intencao: this.intencoes.FOLLOW_UP,
          confianca: 0.88,
          metadados: { razao: 'pedido_esclarecimento' }
        };
      }
    }

    for (const padrao of this.padroesReexplicacao) {
      if (padrao.test(lower)) {
        return {
          intencao: this.intencoes.REEXPLICACAO,
          confianca: 0.90,
          metadados: { razao: 'pedido_reexplicacao' }
        };
      }
    }

    // CONTINUAÇÃO
    for (const padrao of this.padroesContinuacao) {
      if (padrao.test(lower)) {
        return {
          intencao: this.intencoes.CONTINUACAO,
          confianca: 0.85,
          metadados: { razao: 'solicitacao_continuacao' }
        };
      }
    }

    // DESCOBERTA
    for (const padrao of this.padroesDescoberta) {
      if (padrao.test(lower)) {
        return { 
          intencao: this.intencoes.DESCOBERTA, 
          confianca: 0.94, 
          metadados: { razao: 'pedido_descoberta' } 
        };
      }
    }

    // INTERESSE EM TÓPICO ESPECÍFICO
    const topicoDetectado = this.detectarTopicoConhecido(lower);
    if (topicoDetectado) {
      return {
        intencao: this.intencoes.INTERESSE_TOPICO,
        confianca: 0.89,
        metadados: { 
          razao: 'topico_conhecido_detectado', 
          termoBuscado: topicoDetectado
        }
      };
    }

    // CONSULTA PADRÃO (com contexto melhorado)
    const palavras = mensagem.split(/\s+/);
    const temPalavrasPergunta = this.palavrasPergunta.some(p => lower.includes(p));
    
    const metadados = { 
      razao: 'consulta_padrao', 
      comprimento: palavras.length,
      temPalavrasPergunta 
    };

    if (contextoConversacional?.topicoAtual && palavras.length <= 8) {
      metadados.topico_contexto = contextoConversacional.topicoAtual;
      metadados.usar_contexto_historico = true;
    }

    return { 
      intencao: this.intencoes.CONSULTA, 
      confianca: 0.75, 
      metadados 
    };
  }

  detectarContinuacaoFluxo(mensagem, contexto) {
    const lower = mensagem.toLowerCase();
    
    // Escolha de material pendente
    if (contexto.aguardandoResposta === 'escolha_material') {
      const escolha = this.extrairEscolhaNumerica(mensagem);
      if (escolha !== null) {
        return {
          intencao: this.intencoes.ESCOLHA_MATERIAL,
          confianca: 0.97,
          metadados: { 
            escolha,
            fluxo: 'continuacao_escolha_material',
            topico: contexto.topicoAtual
          }
        };
      }
      
      // Fallback: se não é número mas parece escolha
      if (this.pareceEscolhaQualitativa(lower)) {
        return {
          intencao: this.intencoes.ESCOLHA_MATERIAL,
          confianca: 0.82,
          metadados: { 
            escolha_qualitativa: true,
            fluxo: 'continuacao_escolha_material'
          }
        };
      }
    }
    
    // Follow-up natural após explicação
    if (contexto.fluxoAtivo === 'explicacao' && this.isFollowUpNatural(lower)) {
      return {
        intencao: this.intencoes.FOLLOW_UP,
        confianca: 0.86,
        metadados: { 
          fluxo: 'aprofundamento_pos_explicacao',
          topico: contexto.topicoAtual
        }
      };
    }
    
    // Aguardando especificação de tópico
    if (contexto.aguardandoResposta === 'detalhes_topico' && 
        this.isEspecificacaoTopico(lower)) {
      return {
        intencao: this.intencoes.CONSULTA,
        confianca: 0.88,
        metadados: { 
          fluxo: 'especificacao_topico',
          topico_contexto: contexto.topicoAtual
        }
      };
    }
    
    return null;
  }

  analisarContextoConversacional(mensagem, historico, contextoConversacional) {
    if (historico.length === 0) return { confianca: 0 };
    
    const ultimaResposta = historico[historico.length - 1];
    const ultimoConteudo = ultimaResposta.content.toLowerCase();
    const lower = mensagem.toLowerCase();
    
    // Detectar follow-up baseado no conteúdo anterior
    if (this.isFollowUpContextual(lower, ultimoConteudo)) {
      return {
        intencao: this.intencoes.FOLLOW_UP,
        confianca: 0.91,
        metadados: { 
          tipo: 'detalhamento_contextual',
          relacionado_a: contextoConversacional?.topicoAtual
        }
      };
    }
    
    // Detectar confusão após explicação complexa
    if (this.isSinalConfusao(lower, ultimoConteudo)) {
      return {
        intencao: this.intencoes.REEXPLICACAO,
        confianca: 0.87,
        metadados: { razao: 'sinal_confusao_detectado' }
      };
    }
    
    return { confianca: 0 };
  }

  extrairEscolhaNumerica(mensagem) {
    const lower = mensagem.toLowerCase();
    const match = lower.match(/\b(\d+)\b/);
    if (match) {
      const numero = parseInt(match[1]);
      if (numero >= 1 && numero <= 10) return numero - 1;
    }
    
    const opcoes = ['primeiro', 'segundo', 'terceiro', 'quarto', 'quinto', 'sexto'];
    for (let i = 0; i < opcoes.length; i++) {
      if (lower.includes(opcoes[i])) return i;
    }
    
    return null;
  }

  pareceEscolhaQualitativa(mensagem) {
    const padroes = [
      /\b(esse|aquele|o|a)\s+(mesmo|primeiro|segundo|texto|v[ií]deo|imagem)\b/i,
      /\b(quero|prefiro|gosto).*(texto|v[ií]deo|imagem|pdf|documento)\b/i,
      /\b(o|a)\s+(de|do|da)\s+(texto|v[ií]deo|imagem)/i
    ];
    return padroes.some(padrao => padrao.test(mensagem));
  }

  isFollowUpNatural(mensagem) {
    const padroes = [
      /\b(e|mas|só que|só).*(como|porque|por que|funciona|serve)\b/i,
      /\b(tem|tem algum).*(exemplo|caso|aplicação)\b/i,
      /\b(e se|e quando|e onde|e como|e por que)\b/i,
      /\b(qual|quais).*(a diferença|vantagem|benefício)\b/i
    ];
    return padroes.some(padrao => padrao.test(mensagem));
  }

  isEspecificacaoTopico(mensagem) {
    return mensagem.length > 5 && 
           !this.padroesCasuais.some(p => p.test(mensagem)) &&
           !this.padroesConfirmacao.some(p => p.test(mensagem));
  }

  isFollowUpContextual(mensagemAtual, ultimaResposta) {
    const palavrasResposta = ultimaResposta.split(/\s+/);
    const palavrasComuns = palavrasResposta.filter(palavra => 
      palavra.length > 4 && mensagemAtual.includes(palavra)
    );
    
    const temTermosFollowUp = this.padroesFollowUp.some(p => p.test(mensagemAtual));
    
    return palavrasComuns.length >= 1 && temTermosFollowUp;
  }

  isSinalConfusao(mensagemAtual, ultimaResposta) {
    const sinais = [
      'não entendi', 'não compreendi', 'como assim', 'o que é', 
      'pode repetir', 'explique melhor', 'mais simples'
    ];
    
    const respostaComplexa = ultimaResposta.split(/\s+/).length > 30;
    
    return sinais.some(sinal => mensagemAtual.includes(sinal)) && respostaComplexa;
  }

  detectarTopicoConhecido(mensagem) {
    for (const [topico, palavrasChave] of Object.entries(this.topicosConhecidos)) {
      for (const palavra of palavrasChave) {
        if (mensagem.includes(palavra)) {
          return topico;
        }
      }
    }
    return null;
  }

  verificarContextoAtivo(historico) {
    if (!historico || historico.length === 0) return { temContexto: false };
    
    const mensagensRecentes = historico.slice(-3);
    const ultimaResposta = mensagensRecentes.find(m => m.role === 'assistant');
    if (!ultimaResposta) return { temContexto: false };

    const tipoResposta = ultimaResposta.metadata?.tipo;
    const topico = ultimaResposta.metadata?.topico;
    const fragmentos = ultimaResposta.fragmentos;

    const temContexto = ['consulta', 'engajamento_topico', 'descoberta', 'lista_materiais'].includes(tipoResposta);
    
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
      /materiais? sobre ([^,.!?]+)/i,
      /sobre ([^,.!?]+)/i,
      /tópico[:\s]+([^,.!?]+)/i,
      /aprender ([^,.!?]+)/i,
      /assunto[:\s]+([^,.!?]+)/i
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