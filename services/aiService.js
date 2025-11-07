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
    
    this.personaEdu = `Você é Edu, um assistente educacional especializado nos materiais disponíveis.

PRINCÍPIO FUNDAMENTAL:
- Toda informação deve vir EXCLUSIVAMENTE dos materiais de referência fornecidos
- Nunca invente informações fora do contexto fornecido
- Sempre cite a fonte específica (arquivo e página quando disponível)

ESTILO DE RESPOSTA:
- Direto e informativo
- Sempre referencie a fonte no formato: "[Nome do Arquivo, Página X]"
- Agrupe informações por fonte quando possível
- Seja natural mas preciso
- Use linguagem acessível e educacional`;

  }

  async createEmbedding(text) {
    try {
      const result = await this.embeddingModel.embedContent(text);
      return result.embedding.values;
    } catch (error) {
      console.error('Erro ao criar embedding:', error);
      throw new Error('Falha ao criar embedding: ' + error.message);
    }
  }

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
}