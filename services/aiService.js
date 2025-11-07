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

<<<<<<< HEAD
ESTILO DE RESPOSTA:
- Direto e informativo
- Sempre referencie a fonte no formato: "[Nome do Arquivo, Página X]"
- Agrupe informações por fonte quando possível
- Seja natural mas preciso
- Use linguagem acessível e educacional`;

=======
IMPORTANTE: NUNCA inicie respostas com saudações como "Olá", "Oi", "Que bom", etc., a menos que seja explicitamente a primeira mensagem de boas-vindas. Vá direto ao ponto de forma natural e conversacional.`;
>>>>>>> parent of 6ffebff (Ajustes de limite de tópicos)
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

<<<<<<< HEAD
  // GERAR BOAS-VINDAS COM TÓPICOS DISPONÍVEIS
  async gerarBoasVindasComTopicos(topicos, estatisticas) {
    const topicosTexto = topicos.slice(0, 5).map(t => t.nome).join(', ');
    const totalTopicos = estatisticas.total_topicos || topicos.length;
    const totalDocumentos = estatisticas.total_documentos || 0;

    const prompt = `${this.personaEdu}

Você está dando boas-vindas ao usuário e apresentando os tópicos disponíveis.

TÓPICOS PRINCIPAIS: ${topicosTexto}
TOTAL DE TÓPICOS: ${totalTopicos}
TOTAL DE DOCUMENTOS: ${totalDocumentos}

Gere uma mensagem de boas-vindas que:
1. Se apresente como Edu de forma amigável
2. Mencione os principais tópicos disponíveis
3. Explique que pode ajudar com explicações baseadas nesses materiais
4. Convide o usuário a perguntar sobre esses tópicos
5. Seja acolhedor e informativo

Não use markdown, seja natural.`;

    try {
      const result = await this.chatModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { 
          temperature: 0.8, 
          maxOutputTokens: 400 
        }
      });
      
      return result.response.text();
    } catch (error) {
      // Fallback
      return `Olá! 👋 Sou o Edu, seu assistente educacional!

Tenho materiais sobre ${topicosTexto} e mais ${totalTopicos - 5} outros tópicos.

Com base no que tenho disponível, posso te ajudar com explicações, exemplos e tirar dúvidas sobre esses assuntos. O que gostaria de aprender hoje?`;
    }
  }

  // RESPOSTA COM REFERÊNCIAS ESPECÍFICAS AOS MATERIAIS
  async responderComReferenciasEspecificas(mensagem, historico = [], fragmentos = [], preferencias = null) {
    if (!fragmentos || fragmentos.length === 0) {
      return "Desculpe, não encontrei materiais específicos sobre esse assunto na base de conhecimento disponível.";
    }

    // Agrupar fragmentos por arquivo para organização
    const fragmentosPorArquivo = this.agruparFragmentosPorArquivo(fragmentos);
    
    const systemPrompt = `${this.personaEdu}

PERGUNTA DO USUÁRIO: "${mensagem}"

MATERIAIS DE REFERÊNCIA DISPONÍVEIS:
${this.formatarMateriaisParaPrompt(fragmentosPorArquivo)}

REGRAS ESTRITAS:
1. Use APENAS as informações dos materiais acima
2. Sempre cite a fonte no formato: "[Nome do Arquivo, Página X]"
3. Se não souber a página, cite apenas o arquivo: "[Nome do Arquivo]"
4. Agrupe informações por fonte quando possível
5. Seja direto e evite repetições
6. Se os materiais não cobrirem completamente a pergunta, seja honesto sobre as limitações
7. Adapte a profundidade da explicação conforme necessário

${preferencias?.profundidade === 'basico' ? 'Use linguagem simples e conceitos básicos.' : 'Pode incluir detalhes técnicos quando relevante.'}

FORMATO PREFERIDO:
- Responda diretamente à pergunta
- Use frases como: "Nos materiais disponíveis..." ou "Conforme consta em..."
- Cite a fonte ao final de cada informação relevante
- Seja natural mas preciso`;

    try {
      const conversationHistory = historico.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      }));

      const result = await this.chatModel.generateContent({
        contents: [
          ...conversationHistory,
          { role: 'user', parts: [{ text: systemPrompt }] }
        ],
        generationConfig: { 
          temperature: preferencias?.profundidade === 'basico' ? 0.5 : 0.7,
          maxOutputTokens: 2048 
        }
      });

      const resposta = result.response.text();
      return this.validarReferenciasNaResposta(resposta, fragmentosPorArquivo);

    } catch (error) {
      console.error('Erro ao gerar resposta com referências:', error);
      return this.gerarRespostaFallback(fragmentosPorArquivo, mensagem);
    }
  }

  // AGRUPAR FRAGMENTOS POR ARQUIVO
  agruparFragmentosPorArquivo(fragmentos) {
    const agrupados = {};
    
    fragmentos.forEach(fragmento => {
      const nomeArquivo = fragmento.metadados.arquivo_nome;
      if (!agrupados[nomeArquivo]) {
        agrupados[nomeArquivo] = {
          arquivo: nomeArquivo,
          tipo: fragmento.metadados.tipo,
          fragmentos: []
        };
      }
      
      agrupados[nomeArquivo].fragmentos.push({
        conteudo: fragmento.conteudo,
        pagina: fragmento.metadados.localizacao?.pagina,
        secao: fragmento.metadados.localizacao?.secao,
        score: fragmento.score_final || fragmento.score
      });
    });

    return agrupados;
  }

  // FORMATAR MATERIAIS PARA O PROMPT
  formatarMateriaisParaPrompt(fragmentosPorArquivo) {
    return Object.values(fragmentosPorArquivo).map(arquivo => {
      const paginas = [...new Set(arquivo.fragmentos.map(f => f.pagina).filter(p => p))];
      const infoPaginas = paginas.length > 0 ? ` (Páginas: ${paginas.join(', ')})` : '';
      
      return `
ARQUIVO: ${arquivo.arquivo}${infoPaginas}
CONTEÚDO RELEVANTE:
${arquivo.fragmentos.map(f => {
  const infoPagina = f.pagina ? ` [pág. ${f.pagina}]` : '';
  return `• ${f.conteudo}${infoPagina}`;
}).join('\n')}
━━━━━━━━━━━━━━━━`;
    }).join('\n');
  }

  // VALIDAR SE A RESPOSTA CONTÉM REFERÊNCIAS
  validarReferenciasNaResposta(resposta, fragmentosPorArquivo) {
    const nomesArquivos = Object.keys(fragmentosPorArquivo);
    const temReferencias = nomesArquivos.some(nome => resposta.includes(nome));
    
    if (!temReferencias && nomesArquivos.length > 0) {
      // Adicionar referência automaticamente se a IA esqueceu
      const primeiroArquivo = nomesArquivos[0];
      const primeiraPagina = fragmentosPorArquivo[primeiroArquivo].fragmentos[0]?.pagina;
      
      return `${resposta}\n\nFonte: [${primeiroArquivo}${primeiraPagina ? `, pág. ${primeiraPagina}` : ''}]`;
    }
    
    return resposta;
  }

  // RESPOSTA DE FALLBACK
  gerarRespostaFallback(fragmentosPorArquivo, mensagem) {
    const arquivos = Object.keys(fragmentosPorArquivo);
    
    if (arquivos.length === 0) {
      return `Desculpe, não encontrei materiais específicos sobre "${mensagem}" na base de conhecimento disponível.`;
    }

    const principaisArquivos = arquivos.slice(0, 3);
    let resposta = `Encontrei informações relacionadas a "${mensagem}" nos seguintes materiais:\n\n`;

    principaisArquivos.forEach(arquivo => {
      const frags = fragmentosPorArquivo[arquivo].fragmentos;
      const paginas = [...new Set(frags.map(f => f.pagina).filter(p => p))];
      
      resposta += `• ${arquivo}`;
      if (paginas.length > 0) {
        resposta += ` (páginas ${paginas.join(', ')})`;
      }
      resposta += '\n';
    });

    resposta += `\nPosso te explicar mais sobre algum aspecto específico baseado nesses materiais?`;

    return resposta;
  }

  // APRESENTAR TÓPICOS PARA DESCOBERTA
  async apresentarTopicosDescoberta(topicos, estatisticas, historico = []) {
    const topicosTexto = topicos.map(t => t.nome).join(', ');
    const totalTopicos = estatisticas.total_topicos || topicos.length;
    const formatos = estatisticas.tipos_material?.map(t => t.tipo).join(', ') || 'texto, vídeo, imagem';

    const prompt = `${this.personaEdu}

Você está apresentando os tópicos disponíveis para o usuário explorar.

TÓPICOS PRINCIPAIS: ${topicosTexto}
TOTAL DE TÓPICOS: ${totalTopicos}
FORMATOS DISPONÍVEIS: ${formatos}

Apresente esses tópicos de forma convidativa:
1. Mostre entusiasmo pelos materiais disponíveis
2. Liste os tópicos principais de forma natural (não use bullets)
3. Mencione a variedade de formatos
4. Convide o usuário a escolher um tópico
5. Seja acolhedor e encorajador

Exemplo de estrutura:
"Tenho materiais excelentes sobre [tópicos]. São [número] tópicos no total, com conteúdo em [formatos]. Qual desses assuntos te interessa para começarmos?"`;

    try {
      const conversationHistory = historico.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      }));

      const result = await this.chatModel.generateContent({
        contents: [
          ...conversationHistory,
          { role: 'user', parts: [{ text: prompt }] }
        ],
        generationConfig: { 
          temperature: 0.8, 
          maxOutputTokens: 350 
        }
      });
      
      return result.response.text();
    } catch (error) {
      return `Tenho materiais sobre: ${topicosTexto}. \n\nNo total são ${totalTopicos} tópicos disponíveis em formatos como ${formatos}. Qual te interessa para começarmos?`;
    }
  }

  // SUGERIR TÓPICOS DISPONÍVEIS
  async sugerirTopicosDisponiveis(topicos, mensagem, historico = []) {
    const topicosTexto = topicos.slice(0, 8).join(', ');
    
    const prompt = `${this.personaEdu}

O usuário perguntou sobre: "${mensagem}"
No momento, meus materiais cobrem principalmente estes tópicos: ${topicosTexto}

Sugira esses tópicos de forma natural:
- Reconheça o interesse do usuário
- Apresente os tópicos disponíveis
- Convide para explorar um deles
- Seja acolhedor e útil

Não liste como bullets, use texto corrido.`;

    try {
      const conversationHistory = historico.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      }));

      const result = await this.chatModel.generateContent({
        contents: [
          ...conversationHistory,
          { role: 'user', parts: [{ text: prompt }] }
        ],
        generationConfig: { 
          temperature: 0.8, 
          maxOutputTokens: 300 
        }
      });
      
      return result.response.text();
    } catch (error) {
      return `Sobre "${mensagem}", posso te ajudar com: ${topicosTexto}. \n\nQual desses tópicos te interessa mais?`;
    }
  }

  // SUGERIR TÓPICOS RELACIONADOS
  async sugerirTopicosRelacionados(topicos, termoOriginal, historico = []) {
    const topicosTexto = topicos.join(', ');

    const prompt = `${this.personaEdu}

O usuário perguntou sobre "${termoOriginal}" 
Encontrei tópicos relacionados: ${topicosTexto}

Sugira esses tópicos relacionados de forma natural:
- Reconheça que não encontrou exatamente o que procurava
- Apresente os tópicos relacionados
- Pergunte se algum atende à necessidade
- Seja honesto e útil`;

    try {
      const result = await this.chatModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { 
          temperature: 0.7, 
          maxOutputTokens: 250 
        }
      });
      
      return result.response.text();
    } catch (error) {
      return `Sobre "${termoOriginal}", tenho materiais relacionados a: ${topicosTexto}. \n\nAlgum desses tópicos te interessa?`;
    }
  }

  // SUGERIR APROXIMAÇÃO DE TÓPICO
  async sugerirAproximacaoTopico(topicosRelevantes, mensagem, historico = []) {
    const topicosTexto = topicosRelevantes.slice(0, 5).join(', ');
    
    const prompt = `${this.personaEdu}

O usuário perguntou sobre: "${mensagem}"
Encontrei materiais relacionados a: ${topicosTexto}

Sugira esses tópicos relacionados e pergunte se algum deles atende ao interesse do usuário.

Seja útil e direto.`;

    try {
      const result = await this.chatModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { 
          temperature: 0.7, 
          maxOutputTokens: 250 
        }
      });
      
      return result.response.text();
    } catch (error) {
      return `Encontrei materiais sobre: ${topicosTexto}. \n\nAlgum desses tópicos atende sua necessidade?`;
    }
  }

  // APRESENTAR MATERIAIS PARA ESCOLHA
  async apresentarMateriaisContextual(materiais, contextoHistorico) {
    const listaMateriais = materiais.map((m, i) => ({
      numero: i + 1,
      nome: m.arquivo_nome,
      tipo: this.mapearTipoAmigavel(m.tipo),
      fragmentos: m.fragmentos.length
    }));

    const prompt = `${this.personaEdu}

Encontrei múltiplos materiais relevantes. Apresente as opções:

MATERIAIS ENCONTRADOS:
${listaMateriais.map(m => `${m.numero}. ${m.nome} (${m.tipo}) - ${m.fragmentos} fragmentos`).join('\n')}

INSTRUÇÕES:
- Apresente as opções de forma clara
- Diga que o usuário pode escolher qual material prefere
- Seja conciso e útil
- Use números para as opções
- Finalize perguntando a preferência

Exemplo:
"Encontrei alguns materiais que podem te ajudar. Temos [opção 1], [opção 2] ou [opção 3]. Qual você prefere que eu use para te explicar?"`;

    try {
      const result = await this.chatModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { 
          temperature: 0.7, 
          maxOutputTokens: 350 
        }
      });
      
      return result.response.text();
    } catch (error) {
      return `Encontrei ${materiais.length} materiais relevantes:\n\n${
        materiais.map((m, i) => `${i + 1}. ${m.arquivo_nome} (${this.mapearTipoAmigavel(m.tipo)})`).join('\n')
      }\n\nQual você prefere que eu use para te explicar?`;
    }
  }

  // CONVERSAR LIVREMENTE
  async conversarLivremente(mensagem, historico = []) {
    const systemPrompt = `${this.personaEdu}

Responda de forma natural e amigável à mensagem casual do usuário.

Se for uma saudação, responda adequadamente.
Se for um agradecimento, seja educado.
Mantenha o tom conversacional.`;

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
        generationConfig: { 
          temperature: 0.8, 
          maxOutputTokens: 2048 
        }
      });

      return result.response.text();
    } catch (error) {
      return 'Desculpe, estou com dificuldades técnicas no momento. Podemos continuar nossa conversa?';
    }
  }

  // MAPEAR TIPO PARA NOME AMIGÁVEL
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

  // MÉTODO DE FALLBACK PARA GROK
  async _callGrokAPI(messages, temperature = 0.8, maxTokens = 2048) {
    if (!this.grokApiKey) {
      throw new Error('Grok API key não configurada');
    }

    try {
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
=======
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
>>>>>>> parent of 6ffebff (Ajustes de limite de tópicos)

      if (!response.ok) {
        throw new Error(`Grok API error: ${response.status}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      console.error('Erro na API Grok:', error);
      throw error;
    }
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

Você está apresentando materiais didáticos de forma conversacional.

INSTRUÇÕES CRÍTICAS:
1. Comece retomando o TÓPICO da pergunta do usuário
2. Apresente os materiais com: "leia este texto", "assista este vídeo", "veja esta imagem"
3. Se múltiplos, conecte com "ou se preferir", "também tenho"
4. NÃO use bullets ou listas numeradas
5. SEMPRE cite: "[Nome do documento, página X]"
6. Fluxo natural, como conversa

MATERIAIS DISPONÍVEIS:
${fragmentos.map((f, i) => {
  const loc = f.metadados.localizacao;
  const ctx = f.metadados.contexto_documento;
  const tipo = f.metadados.tipo.toLowerCase();
  const tipoAmigavel = tipo.includes('pdf') || tipo.includes('doc') || tipo.includes('txt') ? 'texto' : 
                      tipo.includes('video') || tipo.includes('mp4') ? 'vídeo' : 
                      tipo.includes('image') || tipo.includes('png') || tipo.includes('jpg') ? 'imagem' : tipo;
  
  return `
━━━ Material ${i + 1} ━━━
Documento: ${f.metadados.arquivo_nome}
Localização: Página ${loc?.pagina || 'N/A'}${loc?.secao ? `, Seção ${loc.secao}` : ''}
Relevância: ${((f.score_final || f.score) * 100).toFixed(1)}%
Conteúdo:
${f.conteudo}
━━━━━━━━━━━━━━━━
`;
}).join('\n')}

Responda de forma natural e conversacional.`;

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