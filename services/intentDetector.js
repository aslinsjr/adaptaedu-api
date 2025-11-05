// services/intentDetector.js
export class IntentDetector {
  constructor(db = null) {
    this.db = db;
    this.intencoes = {
      CASUAL: 'casual',
      DESCOBERTA: 'descoberta',
      CONSULTA: 'consulta',
      PREFERENCIA: 'preferencia',
      INTERESSE_TOPICO: 'interesse_topico',
      CONTINUACAO: 'continuacao',
      CONFIRMACAO: 'confirmacao',
      NIVEL_CONHECIMENTO: 'nivel_conhecimento'
    };

    this.topicosConhecidos = new Map();
    this.isInitialized = false;

    this.defaultTopicos = {
      'html': ['html', 'html5', 'páginas web', 'pagina html', 'construir página', 'criar site'],
      'programação': ['programação', 'programar', 'codar', 'código', 'desenvolvimento'],
      'css': ['css', 'estilo', 'estilizar', 'folha de estilo'],
      'javascript': ['javascript', 'js', 'script', 'interatividade']
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

    this.padroesNivelConhecimento = [
      /\b(não|nao).*(conheço|sei|saber|entendo|entender)\b/i,
      /\b(pouco|quase nada|bem pouco|iniciante|começando)\b/i,
      /\b(já sei|conheço|domino|avançado|experiente)\b/i
    ];

    this.padroesDescoberta = [
      /\b(o que (você|voce) (pode|sabe|ensina|tem|conhece))\b/i,
      /\b(quais (assuntos|tópicos|topicos|materiais|temas|você tem))\b/i,
      /\b(que (materias|matérias|assuntos|temas|tópicos) (você|vc) (pode|tem|sabe|ensina|explica))\b/i,
      /\b(quais (materias|matérias) (você|vc) (pode|tem|sabe|ensina|explica))\b/i,
      /\b(que (materiais|conteúdos) (tem|há|ha|existe|disponível))\b/i,
      /\b(mostre|liste|apresente).*(disponível|disponiveis|materiais|assuntos)\b/i,
      /\b(explore|conhecer|descobrir).*(materiais|conteúdos|conteudos)\b/i,
      /\b(ensinar|aprender|estudar)\b.*\b(o que|quais)\b/i,
      /\b(pode|tem|ensina).*(materia|máteria|assunto|tópico)\b/i
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

    this.stopWords = new Set(['de', 'do', 'da', 'em', 'para', 'com', 'um', 'uma', 'o', 'a', 'os', 'as', 'e', 'ou', 'que', 'se']);
  }

  async init() {
    if (this.isInitialized || !this.db) {
      this.topicosConhecidos = new Map(Object.entries(this.defaultTopicos));
      this.isInitialized = true;
      return;
    }

    try {
      const chunks = await this.db.collection('chunks')
        .find({}, { projection: { 'metadados.tags': 1, 'metadados.arquivo_nome': 1, 'metadados.titulo': 1 } })
        .limit(1000)
        .toArray();

      const temp = new Map();

      for (const chunk of chunks) {
        const m = chunk.metadados || {};
        const tags = Array.isArray(m.tags) ? m.tags.map(t => t.toLowerCase()) : [];
        const nome = (m.arquivo_nome || '').toLowerCase().replace(/\.[^.]+$/, '');
        const titulo = (m.titulo || '').toLowerCase();

        const principal = tags[0] || nome.split(/[\s_]+/)[0] || 'geral';

        if (!temp.has(principal)) temp.set(principal, new Set());

        const palavras = [
          ...tags,
          ...nome.split(/[\s_]+/).filter(w => w.length > 2),
          ...titulo.split(/\s+/).filter(w => w.length > 2)
        ];

        const filtradas = palavras
          .filter(w => !this.stopWords.has(w) && w.length > 2)
          .slice(0, 8);

        temp.get(principal).add(...filtradas);
      }

      this.topicosConhecidos = new Map(
        Array.from(temp.entries()).map(([k, v]) => [k, Array.from(v)])
      );

      if (this.topicosConhecidos.size === 0) {
        this.topicosConhecidos = new Map(Object.entries(this.defaultTopicos));
      }

      this.isInitialized = true;
      console.log(`Loaded ${this.topicosConhecidos.size} dynamic topics from MongoDB.`);
    } catch (err) {
      console.error('Failed to load topics from MongoDB:', err);
      this.topicosConhecidos = new Map(Object.entries(this.defaultTopicos));
      this.isInitialized = true;
    }
  }

  detectarTopicoConhecido(msg) {
    if (!this.isInitialized) return null;
    const lower = msg.toLowerCase();
    for (const [topico, palavras] of this.topicosConhecidos) {
      if (palavras.some(p => lower.includes(p))) return topico;
    }
    return null;
  }

  detectar(mensagem, { historico = [] } = {}) {
    const lower = mensagem.toLowerCase().trim();

    for (const p of this.padroesConfirmacao) {
      if (p.test(lower)) {
        const ctx = this.verificarContextoAtivo(historico);
        if (ctx.temContexto && ctx.fragmentosPendentes?.length > 0) {
          return { intencao: this.intencoes.CONFIRMACAO, confianca: 0.97, metadados: { razao: 'confirmacao', fragmentosPendentes: ctx.fragmentosPendentes } };
        }
      }
    }

    for (const p of this.padroesNivelConhecimento) {
      if (p.test(lower)) {
        const ctx = this.verificarContextoAtivo(historico);
        if (ctx.temContexto && ctx.fragmentosPendentes?.length > 0) {
          return { intencao: this.intencoes.NIVEL_CONHECIMENTO, confianca: 0.95, metadados: { razao: 'nivel', topico: ctx.topico } };
        }
      }
    }

    for (const p of this.padroesCasuais) if (p.test(lower)) return { intencao: this.intencoes.CASUAL, confianca: 0.98, metadados: { razao: 'casual' } };

    for (const p of this.padroesDescoberta) if (p.test(lower)) return { intencao: this.intencoes.DESCOBERTA, confianca: 0.96, metadados: { razao: 'descoberta' } };

    const topico = this.detectarTopicoConhecido(lower);
    if (topico) {
      return { intencao: this.intencoes.INTERESSE_TOPICO, confianca: 0.92, metadados: { razao: 'topico_dinamico', termoBuscado: topico } };
    }

    const ctx = this.verificarContextoAtivo(historico);
    for (const p of this.padroesContinuacao) {
      if (p.test(lower) && ctx.temContexto) {
        return { intencao: this.intencoes.CONTINUACAO, confianca: 0.92, metadados: { razao: 'continuacao', topico_contexto: ctx.topico } };
      }
    }

    for (const p of this.padroesPreferencia) if (p.test(lower)) return { intencao: this.intencoes.PREFERENCIA, confianca: 0.9, metadados: { razao: 'preferencia' } };

    const temPergunta = this.palavrasPergunta.some(p => lower.includes(p));
    const palavras = mensagem.split(/\s+/);
    if (palavras.length <= 7 && !temPergunta) {
      return { intencao: this.intencoes.INTERESSE_TOPICO, confianca: 0.8, metadados: { razao: 'generico', termoBuscado: mensagem.trim() } };
    }

    const metadados = { razao: 'padrao', comprimento: palavras.length };
    if (palavras.length <= 6 && ctx.temContexto) {
      metadados.topico_contexto = ctx.topico;
      metadados.usar_contexto_historico = true;
    }
    return { intencao: this.intencoes.CONSULTA, confianca: 0.7, metadados };
  }

  verificarContextoAtivo(historico) {
    if (!historico?.length) return { temContexto: false };
    const recente = historico.slice(-3).find(m => m.role === 'assistant');
    if (!recente) return { temContexto: false };

    const { metadata, fragmentos } = recente;
    const valido = ['consulta', 'engajamento_topico', 'descoberta'].includes(metadata?.tipo);
    if (valido && fragmentos?.length > 0) {
      const topico = metadata?.topico || this.extrairTopicoDeResposta(recente.content);
      return { temContexto: true, topico, tipoResposta: metadata?.tipo, fragmentosPendentes: fragmentos };
    }
    return { temContexto: false };
  }

  extrairTopicoDeResposta(resposta) {
    const padroes = [/sobre ([^.,]+)/i, /tópico[:\s]+([^.,]+)/i, /aprender ([^.,]+)/i];
    for (const p of padroes) {
      const m = resposta.match(p);
      if (m) return m[1].trim().split(/\s+/).slice(0, 3).join(' ');
    }
    return null;
  }
}