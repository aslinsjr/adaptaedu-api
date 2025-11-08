// services/aiService.js
import { GoogleGenerativeAI } from '@google/generative-ai';

export class AIService {
  constructor(
    googleApiKey = process.env.GOOGLE_API_KEY,
    grokApiKey = process.env.GROK_API_KEY
  ) {
    this.genAI = new GoogleGenerativeAI(googleApiKey);
    this.grokApiKey = grokApiKey;
    this.embeddingModel = this.genAI.getGenerativeModel({ model: 'text-embedding-004' });
    this.chatModel = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
    
    this.personaEdu = `Você é Edu, um assistente educacional amigável e didático.

CARACTERÍSTICAS DA SUA PERSONALIDADE:
- Comunicativo e entusiasta por ensinar
- Usa linguagem clara, acessível e natural
- Paciente e encorajador com os alunos
- Adapta explicações ao nível de cada pessoa
- Genuinamente interessado em ajudar a aprender
- Mantém conversa fluida sem ser robotizado

IMPORTANTE: NUNCA inicie respostas com saudações como "Olá", "Oi", "Que bom", etc., a menos que seja explicitamente a primeira mensagem de boas-vindas. Vá direto ao ponto de forma natural e conversacional.`;
  }

  async createEmbedding(text) {
    try {
      const result = await this.embeddingModel.embedContent(text);
      return result.embedding.values;
    } catch (error) {
      console.error('Erro ao criar embedding com Google:', error);
      throw new Error('Falha ao criar embedding: ' + error.message);
    }
  }

  async _callGrokAPI(messages, temperature = 0.8, maxTokens = 2048) {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.grokApiKey}`
      },
      body: JSON.stringify({
        model: 'grok-4-fast-reasoning',
        messages: messages,
        temperature: temperature,
        max_tokens: maxTokens
      })
    });

    if (!response.ok) {
      throw new Error(`Grok API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  async conversarLivremente(mensagem, historico = [], contextoSistema = '') {
    const systemPrompt = contextoSistema || `${this.personaEdu}\n\nResponda de forma direta, natural e útil.`;

    try {
      const conversationHistory = historico.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      }));

      const result = await this.chatModel.generateContent({
        contents: [
          ...conversationHistory,
          { role: 'user', parts: [{ text: `${systemPrompt}\n\nUSUÁRIO: ${mensagem}` }] }
        ],
        generationConfig: { temperature: 0.8, maxOutputTokens: 2048 }
      });

      return result.response.text();

    } catch (error) {
      console.error('Erro com Google API, tentando Grok:', error);
      try {
        const messages = [
          { role: 'system', content: systemPrompt },
          ...historico.map(msg => ({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content })),
          { role: 'user', content: mensagem }
        ];
        return await this._callGrokAPI(messages, 0.8, 2048);
      } catch (grokError) {
        console.error('Erro com Grok API:', grokError);
        return 'Desculpe, estou com dificuldades técnicas no momento. Por favor, tente novamente em instantes.';
      }
    }
  }

  async responderComContexto(mensagem, historico = [], fragmentos = [], preferencias = null) {
    const systemPrompt = `${this.personaEdu}

Você está respondendo perguntas usando materiais didáticos como fonte de conhecimento.

INSTRUÇÕES CRÍTICAS:
1. EXPLIQUE o conteúdo com suas próprias palavras de forma didática e clara
2. Use os fragmentos abaixo como FONTE DE INFORMAÇÃO para construir sua explicação
3. NÃO apenas liste ou mencione materiais - ENSINE o conteúdo
4. Sempre que usar informação de um fragmento, cite: [Nome do documento, pág. X]
5. Se múltiplos fragmentos, integre as informações em uma explicação coesa
6. Mantenha tom conversacional e natural
7. Adapte a profundidade ao nível do usuário
8. Use exemplos dos materiais quando disponíveis

MATERIAIS DISPONÍVEIS COMO FONTE:
${fragmentos.map((f, i) => {
  const loc = f.metadados.localizacao;
  const tipo = f.metadados.tipo.toLowerCase();
  const tipoAmigavel = tipo.includes('pdf') || tipo.includes('doc') || tipo.includes('txt') ? 'texto' : 
                      tipo.includes('video') || tipo.includes('mp4') ? 'vídeo' : 
                      tipo.includes('image') || tipo.includes('png') || tipo.includes('jpg') ? 'imagem' : tipo;
  
  return `
┌─── Fonte ${i + 1} [${tipoAmigavel}] ───┐
Documento: ${f.metadados.arquivo_nome}
Localização: Página ${loc?.pagina || 'N/A'}${loc?.secao ? `, Seção ${loc.secao}` : ''}
Relevância: ${((f.score_final || f.score) * 100).toFixed(1)}%

CONTEÚDO:
${f.conteudo}
└────────────────────────┘
`;
}).join('\n')}

IMPORTANTE: 
- Extraia a informação dos materiais e explique com clareza
- Cite a fonte após cada informação relevante
- Não diga "o material diz", "segundo o texto" - apenas explique e cite
- Seja didático como um professor explicando o assunto

Responda à pergunta do usuário de forma completa e educativa:`;

    const temperatura = preferencias?.profundidade === 'basico' ? 0.5 : 0.8;

    try {
      const result = await this.chatModel.generateContent({
        contents: [
          ...historico.map(msg => ({ role: msg.role === 'user' ? 'user' : 'model', parts: [{ text: msg.content }] })),
          { role: 'user', parts: [{ text: `${systemPrompt}\n\nPERGUNTA: ${mensagem}` }] }
        ],
        generationConfig: { temperature: temperatura, maxOutputTokens: 2048 }
      });
      return result.response.text();
    } catch (error) {
      console.error('Erro com Google API, tentando Grok:', error);
      try {
        const messages = [
          { role: 'system', content: systemPrompt },
          ...historico.map(msg => ({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content })),
          { role: 'user', content: `PERGUNTA: ${mensagem}` }
        ];
        return await this._callGrokAPI(messages, temperatura, 2048);
      } catch (grokError) {
        return 'Desculpe, estou com dificuldades técnicas no momento.';
      }
    }
  }

  // NOVO: Sistema de templates para apresentação de materiais
  async apresentarMateriaisContextual(materiais, contextoHistorico) {
    // Analisar o histórico para entender o contexto sem repetir
    const contexto = this.analisarContextoParaApresentacao(contextoHistorico);
    
    const listaMateriais = materiais.map((m, i) => ({
      numero: i + 1,
      nome: m.arquivo_nome,
      tipo: this.mapearTipoAmigavel(m.tipo),
      descricao: this.gerarDescricaoContextual(m, contexto)
    }));

    const prompt = `${this.personaEdu}

CONTEXTO: ${contexto.descricao || 'Usuário buscando materiais educativos'}

MATERIAIS ENCONTRADOS:
${listaMateriais.map(m => `${m.numero}. ${m.nome} (${m.tipo}) - ${m.descricao}`).join('\n')}

INSTRUÇÕES CRÍTICAS:
- NÃO repita o que o usuário disse anteriormente
- Comece diretamente com os materiais encontrados
- Use linguagem natural como "Encontrei" ou "Tenho aqui"
- Seja conciso e útil (2-3 frases no máximo)
- Finalize perguntando qual material prefere
- Mantenha tom amigável e encorajador

Exemplo de resposta ideal:
"Encontrei alguns materiais que podem te ajudar:

1. Guia Completo (texto) - explicação detalhada com exemplos
2. Vídeo Aulas (vídeo) - demonstrações práticas

Qual deles te interessa mais para começarmos?"

Sua resposta:`;

    try {
      const result = await this.chatModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { 
          temperature: 0.7, 
          maxOutputTokens: 350,
          topP: 0.9
        }
      });
      
      return this.limparRespostaApresentacao(result.response.text());
    } catch (error) {
      console.error('Erro ao gerar apresentação de materiais:', error);
      // Fallback para template padrão
      return this.gerarRespostaPadraoMateriais(listaMateriais);
    }
  }

  analisarContextoParaApresentacao(historico) {
    if (!historico || historico.length === 0) {
      return { descricao: 'Busca por materiais educativos', area: 'geral' };
    }
    
    // Encontrar a última mensagem do usuário
    const ultimaUser = [...historico].reverse().find(m => m.role === 'user');
    
    if (!ultimaUser) {
      return { descricao: 'Busca por materiais educativos', area: 'geral' };
    }
    
    // Extrair intenção sem repetir a frase exata
    const conteudo = ultimaUser.content.toLowerCase();
    
    if (conteudo.includes('programação') || conteudo.includes('programacao')) {
      return { descricao: 'sobre programação', area: 'tecnologia' };
    }
    if (conteudo.includes('html') || conteudo.includes('css') || conteudo.includes('javascript')) {
      return { descricao: 'de desenvolvimento web', area: 'tecnologia' };
    }
    if (conteudo.includes('matemática') || conteudo.includes('matematica') || conteudo.includes('cálculo')) {
      return { descricao: 'de matemática', area: 'exatas' };
    }
    if (conteudo.includes('aprender') || conteudo.includes('estudar') || conteudo.includes('conhecer')) {
      return { descricao: 'para aprendizado', area: 'educacao' };
    }
    if (conteudo.includes('como fazer') || conteudo.includes('como usar') || conteudo.includes('tutorial')) {
      return { descricao: 'com instruções práticas', area: 'pratica' };
    }
    
    return { descricao: 'educativos relevantes', area: 'geral' };
  }

  gerarDescricaoContextual(material, contexto) {
    const nome = material.arquivo_nome.toLowerCase();
    const tipo = this.mapearTipoAmigavel(material.tipo);
    
    const descricoes = {
      tecnologia: {
        texto: 'explicação técnica detalhada',
        vídeo: 'demonstração de código e práticas',
        imagem: 'diagramas e fluxos técnicos'
      },
      exatas: {
        texto: 'conceitos matemáticos explicados',
        vídeo: 'resolução passo a passo', 
        imagem: 'gráficos e visualizações'
      },
      educacao: {
        texto: 'conteúdo estruturado para estudo',
        vídeo: 'aula didática e exemplos',
        imagem: 'material visual educativo'
      },
      pratica: {
        texto: 'instruções passo a passo',
        vídeo: 'demonstração prática',
        imagem: 'ilustrações de procedimentos'
      },
      geral: {
        texto: 'conteúdo completo e informativo',
        vídeo: 'apresentação visual clara', 
        imagem: 'recurso visual educativo'
      }
    };
    
    const area = contexto.area || 'geral';
    const baseDescricao = descricoes[area][tipo] || 'material educativo de qualidade';
    
    // Adicionar características específicas pelo nome do arquivo
    if (nome.includes('capítulo') || nome.includes('livro') || nome.includes('capitulo')) {
      return baseDescricao + ' com abordagem aprofundada';
    }
    if (nome.includes('dica') || nome.includes('professor') || nome.includes('teacher')) {
      return baseDescricao + ' com orientações práticas';
    }
    if (nome.includes('guia') || nome.includes('tutorial') || nome.includes('manual')) {
      return baseDescricao + ' em formato passo a passo';
    }
    if (nome.includes('exercício') || nome.includes('exercicio') || nome.includes('prática')) {
      return baseDescricao + ' com atividades práticas';
    }
    if (nome.includes('resumo') || nome.includes('sumário') || nome.includes('sumario')) {
      return baseDescricao + ' de forma concisa';
    }
    if (nome.includes('avançado') || nome.includes('avancado') || nome.includes('expert')) {
      return baseDescricao + ' para nível avançado';
    }
    if (nome.includes('básico') || nome.includes('basico') || nome.includes('iniciante')) {
      return baseDescricao + ' para iniciantes';
    }
    
    return baseDescricao;
  }

  mapearTipoAmigavel(tipo) {
    if (!tipo) return 'material';
    
    const tipoLower = tipo.toLowerCase();
    const mapeamento = {
      'pdf': 'texto', 'docx': 'texto', 'doc': 'texto', 'txt': 'texto',
      'video': 'vídeo', 'mp4': 'vídeo', 'avi': 'vídeo', 'mkv': 'vídeo',
      'imagem': 'imagem', 'image': 'imagem', 'png': 'imagem', 'jpg': 'imagem', 'jpeg': 'imagem', 'gif': 'imagem',
      'audio': 'áudio', 'mp3': 'áudio', 'wav': 'áudio'
    };
    return mapeamento[tipoLower] || tipoLower;
  }

  limparRespostaApresentacao(resposta) {
    if (!resposta) return '';
    
    let limpa = resposta.trim();
    
    // Remover padrões comuns de repetição do tópico
    const padroesRepeticao = [
      /^[Ss]obre [^,\n]+,/,
      /^[Cc]om relação [ao] [^,\n]+,/,
      /^[Qq]uanto [ao] [^,\n]+,/,
      /^[Aa] respeito de [^,\n]+,/,
      /^[Pp]ara [^,\n]+,/
    ];
    
    padroesRepeticao.forEach(padrao => {
      const match = limpa.match(padrao);
      if (match) {
        limpa = limpa.replace(padrao, '').trim();
      }
    });
    
    // Garantir que comece com letra maiúscula
    if (limpa.length > 0) {
      limpa = limpa.charAt(0).toUpperCase() + limpa.slice(1);
    }
    
    // Remover saudações desnecessárias no meio da conversa
    const saudacoes = [
      /\b(Olá|Ola|Oi|Hey|Hi|Hello)[,!]\s*/gi,
      /\b(Que bom|Que prazer)[,!]\s*/gi
    ];
    
    saudacoes.forEach(saudacao => {
      limpa = limpa.replace(saudacao, '');
    });
    
    return limpa || this.gerarRespostaPadraoMateriais([]);
  }

  gerarRespostaPadraoMateriais(listaMateriais) {
    if (!listaMateriais || listaMateriais.length === 0) {
      return "Desculpe, não encontrei materiais relevantes no momento.";
    }
    
    const listaFormatada = listaMateriais.map(m => 
      `${m.numero}. ${m.nome} (${m.tipo}) - ${m.descricao}`
    ).join('\n');
    
    return `Encontrei ${listaMateriais.length} materiais que podem te ajudar:\n\n${listaFormatada}\n\nQual deles te interessa mais para começarmos?`;
  }

  async apresentarTopicos(topicos, tiposMaterial, historico = []) {
    const temHistorico = historico.length > 0;
    const listaTopicos = topicos.map(t => t.nome).join(', ');
    const tiposDisponiveis = [...new Set(tiposMaterial.map(t => t.tipo))].join(' e ');

    const prompt = `${this.personaEdu}

${temHistorico 
  ? `Apresente os materiais disponíveis de forma direta.

TÓPICOS: ${listaTopicos}
FORMATOS: ${tiposDisponiveis}

Responda de forma conversacional (NÃO use listas ou bullets) dizendo:
- Quais tópicos estão disponíveis (em texto corrido)
- Quais formatos de material existem
- Pergunte qual tópico interessa

Exemplo: "Os tópicos disponíveis são HTML, CSS e JavaScript. Tenho material em texto e vídeo. Qual tópico te interessa?"`
  : `Você está apresentando materiais pela primeira vez.

TÓPICOS: ${listaTopicos}
FORMATOS: ${tiposDisponiveis}

Crie uma apresentação conversacional:
1. Breve introdução
2. Liste os tópicos disponíveis em texto corrido
3. Mencione os formatos
4. Pergunte qual tópico interessa

Seja amigável mas conciso.`}`;

    try {
      const result = await this.chatModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 500 }
      });
      return result.response.text();
    } catch (error) {
      console.error('Erro com Google API, tentando Grok:', error);
      try {
        const messages = [{ role: 'system', content: this.personaEdu }, { role: 'user', content: prompt }];
        return await this._callGrokAPI(messages, 0.7, 500);
      } catch (grokError) {
        return 'Desculpe, estou com dificuldades técnicas no momento.';
      }
    }
  }

  async gerarEngajamentoTopico(topico, tiposMaterial, historico = []) {
    const tipos = tiposMaterial.join(' e ');
    const prompt = `${this.personaEdu}

O usuário demonstrou interesse no tópico: ${topico}

MATERIAIS: ${tipos}

Resposta curta (2-3 linhas):
1. Reconheça o interesse
2. Pergunte o que especificamente quer aprender
3. Seja acolhedor

Exemplo: "Ótimo! ${topico} é essencial. O que você gostaria de aprender sobre ele?"`;

    try {
      const result = await this.chatModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 300 }
      });
      return result.response.text();
    } catch (error) {
      try {
        const messages = [{ role: 'system', content: this.personaEdu }, { role: 'user', content: prompt }];
        return await this._callGrokAPI(messages, 0.8, 300);
      } catch (grokError) {
        return 'Desculpe, estou com dificuldades técnicas.';
      }
    }
  }

  // MÉTODO LEGADO (mantido para compatibilidade)
  async listarMateriaisParaEscolha(materiais, topico, historico = []) {
    // Usar o novo sistema contextual
    return await this.apresentarMateriaisContextual(materiais, historico);
  }
}