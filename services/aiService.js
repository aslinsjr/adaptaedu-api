// services/aiService.js
import { GoogleGenerativeAI } from '@google/generative-ai';

export class AIService {
  constructor(googleApiKey = process.env.GOOGLE_API_KEY, grokApiKey = process.env.GROK_API_KEY) {
    this.genAI = new GoogleGenerativeAI(googleApiKey);
    this.grokApiKey = grokApiKey;
    this.embeddingModel = this.genAI.getGenerativeModel({ model: 'text-embedding-004' });
    this.chatModel = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
    
    this.personaEdu = `Você é Edu, um assistente educacional que trabalha EXCLUSIVAMENTE com materiais didáticos armazenados.

REGRAS ABSOLUTAS:
- NUNCA responda usando seu conhecimento geral
- SOMENTE explique conteúdos baseados nos fragmentos fornecidos
- Se NÃO houver fragmentos, NUNCA tente responder a pergunta
- Seja direto e didático nas explicações
- Cite sempre a fonte: [Nome do documento, pág. X]`;
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

  async createEmbedding(text) {
    try {
      const result = await this.embeddingModel.embedContent(text);
      return result.embedding.values;
    } catch (error) {
      console.error('Erro ao criar embedding:', error);
      throw new Error('Falha ao criar embedding: ' + error.message);
    }
  }

  async orquestrarMensagem(mensagem, historico = [], topicosDisponiveis = []) {
    const listaTopicos = topicosDisponiveis.length > 0 
      ? topicosDisponiveis.map(t => t.nome || t.topico).join(', ')
      : 'Nenhum tópico disponível';

    const historicoResumo = historico.slice(-3).map(msg => 
      `${msg.role}: ${msg.content.substring(0, 150)}`
    ).join('\n');

    const prompt = `${this.personaEdu}

HISTÓRICO RECENTE:
${historicoResumo || 'Primeira mensagem'}

TÓPICOS DISPONÍVEIS: ${listaTopicos}

ANALISE: "${mensagem}"

Responda APENAS com JSON:

{
  "acao": "casual" | "descoberta" | "consulta",
  "busca": {
    "query": "termos para busca",
    "tipo_material": null,
    "tags": [],
    "limite": 5
  },
  "resposta_direta": "texto se for casual/descoberta, null se consulta"
}`;

    try {
      const result = await this.chatModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { 
          temperature: 0.3,
          maxOutputTokens: 800
        }
      });

      let responseText = result.response.text().trim();
      responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      const parsed = JSON.parse(responseText);
      
      if (!parsed.acao || !['casual', 'descoberta', 'consulta'].includes(parsed.acao)) {
        parsed.acao = 'consulta';
      }
      
      if (!parsed.busca) {
        parsed.busca = {
          query: mensagem,
          tipo_material: null,
          tags: [],
          limite: 5
        };
      }

      return parsed;

    } catch (error) {
      console.error('Erro na orquestração com Google, tentando Grok:', error);
      
      try {
        const messages = [{ role: 'user', content: prompt }];
        const grokResponse = await this._callGrokAPI(messages, 0.3, 800);
        let cleanResponse = grokResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        
        const parsed = JSON.parse(cleanResponse);
        
        if (!parsed.acao || !['casual', 'descoberta', 'consulta'].includes(parsed.acao)) {
          parsed.acao = 'consulta';
        }
        
        if (!parsed.busca) {
          parsed.busca = {
            query: mensagem,
            tipo_material: null,
            tags: [],
            limite: 5
          };
        }

        return parsed;

      } catch (grokError) {
        console.error('Erro com Grok API:', grokError);
        
        return {
          acao: 'consulta',
          busca: {
            query: mensagem,
            tipo_material: null,
            tags: [],
            limite: 5
          },
          resposta_direta: null
        };
      }
    }
  }

  async responderComFragmentos(mensagem, fragmentos, historico = []) {
    if (!fragmentos || fragmentos.length === 0) {
      return 'Não tenho materiais sobre esse tema no momento. Quer ver os tópicos disponíveis?';
    }

    const contextoPrepared = fragmentos.map((f, i) => {
      const loc = f.metadados?.localizacao;
      
      return `
FONTE ${i + 1}:
Documento: ${f.metadados?.arquivo_nome || 'Desconhecido'}
Página: ${loc?.pagina || 'N/A'}

CONTEÚDO:
${f.conteudo}
`;
    }).join('\n');

    const systemPrompt = `${this.personaEdu}

MATERIAIS:

${contextoPrepared}

INSTRUÇÕES:
- Use APENAS informações dos fragmentos
- Seja DIRETO (máximo 3 frases)
- Destaque o essencial
- Cite fontes brevemente
- FINALIZE com pergunta engajadora

EXEMPLOS DE PERGUNTAS FINAIS:
- "Quer que eu detalhe mais algum ponto?"
- "Te interessa ver exemplos práticos?"
- "Ficou alguma dúvida sobre o conteúdo?"
- "Quer explorar mais algum aspecto?"

Responda de forma CONVERSAcional:`;

    try {
      const result = await this.chatModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nPERGUNTA: ${mensagem}` }] }],
        generationConfig: { 
          temperature: 0.7,
          maxOutputTokens: 512
        }
      });

      return result.response.text();

    } catch (error) {
      console.error('Erro ao gerar resposta com Google, tentando Grok:', error);
      
      try {
        const messages = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `PERGUNTA: ${mensagem}` }
        ];
        
        return await this._callGrokAPI(messages, 0.7, 512);
        
      } catch (grokError) {
        console.error('Erro com Grok API:', grokError);
        return 'Desculpe, ocorreu um erro ao processar os materiais. Tente reformular sua pergunta.';
      }
    }
  }

  async gerarRespostaCasual(mensagem, historico = []) {
    const prompt = `${this.personaEdu}

Responda de forma DIRETA (1-2 frases) e finalize com pergunta engajadora.

USUÁRIO: ${mensagem}`;

    try {
      const result = await this.chatModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { 
          temperature: 0.8,
          maxOutputTokens: 200
        }
      });

      return result.response.text();

    } catch (error) {
      console.error('Erro na resposta casual com Google, tentando Grok:', error);
      
      try {
        const messages = [{ role: 'user', content: prompt }];
        return await this._callGrokAPI(messages, 0.8, 200);
        
      } catch (grokError) {
        console.error('Erro com Grok API:', grokError);
        return 'Como posso te ajudar com os materiais hoje?';
      }
    }
  }

  async listarTopicos(topicos, historico = []) {
    if (!topicos || topicos.length === 0) {
      return 'Sem tópicos disponíveis no momento.';
    }

    const topicosRelevantes = topicos
      .sort((a, b) => (b.fragmentos || 0) - (a.fragmentos || 0))
      .slice(0, 8)
      .map(t => t.nome || t.topico)
      .filter(Boolean)
      .join(', ');

    const prompt = `${this.personaEdu}

Tópicos disponíveis: ${topicosRelevantes}

Responda em 1-2 frases listando os principais e pergunte qual interessa. Seja direto.`;

    try {
      const result = await this.chatModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { 
          temperature: 0.7,
          maxOutputTokens: 150
        }
      });

      return result.response.text();

    } catch (error) {
      console.error('Erro ao listar tópicos com Google, tentando Grok:', error);
      
      try {
        const messages = [{ role: 'user', content: prompt }];
        return await this._callGrokAPI(messages, 0.7, 150);
        
      } catch (grokError) {
        console.error('Erro com Grok API:', grokError);
        return `Tenho materiais sobre: ${topicosRelevantes.split(',').slice(0, 5).join(', ')}. Qual te interessa?`;
      }
    }
  }
}