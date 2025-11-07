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
- Seja natural mas preciso`;
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
    const topicosTexto = topicos.slice(0, 5).join(', ');
    const totalTopicos = estatisticas.total_topicos || topicos.length;
    const totalDocumentos = estatisticas.total_documentos || 0;

    const prompt = `${this.personaEdu}

Você está dando boas-vindas ao usuário e apresentando os tópicos disponíveis.

TÓPICOS PRINCIPAIS: ${topicosTexto}
TOTAL DE TÓPICOS: ${totalTopicos}
TOTAL DE DOCUMENTOS: ${totalDocumentos}

Gere uma mensagem de boas-vindas que:
1. Se apresente como Edu
2. Mencione os principais tópicos disponíveis
3. Convide o usuário a perguntar sobre esses tópicos
4. Seja acolhedor e informativo

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

Com base no que tenho disponível, posso te ajudar com explicações, exemplos e tirar dúvidas. O que gostaria de aprender hoje?`;
    }
  }

  // RESPOSTA COM REFERÊNCIAS ESPECÍFICAS AOS MATERIAIS
  async responderComReferenciasEspecificas(mensagem, historico = [], fragmentos = [], preferencias = null) {
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
          temperature: 0.7, 
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
CONTEÚDO:
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

  // SUGERIR TÓPICOS DISPONÍVEIS
  async sugerirTopicosDisponiveis(topicos, mensagem, historico = []) {
    const topicosTexto = topicos.slice(0, 8).join(', ');
    
    const prompt = `${this.personaEdu}

O usuário perguntou sobre: "${mensagem}"
No momento, meus materiais cobrem principalmente estes tópicos: ${topicosTexto}

Sugira de forma natural que podemos ajudar com esses tópicos e pergunte qual interessa mais.

Seja acolhedor e incentive a exploração dos tópicos disponíveis.`;

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

  // MÉTODO DE FALLBACK PARA GROK (mantido para compatibilidade)
  async _callGrokAPI(messages, temperature = 0.8, maxTokens = 2048) {
    if (!this.grokApiKey) {
      throw new Error('Grok API key não configurada');
    }

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
}