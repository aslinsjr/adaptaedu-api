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

ANALISE esta mensagem: "${mensagem}"

DECIDA a ação apropriada baseada no contexto completo da conversa.

Responda APENAS com JSON válido:

{
  "acao": "casual" | "descoberta" | "consulta",
  "busca": {
    "query": "termos otimizados para busca",
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
    return 'Não encontrei materiais relevantes sobre esse tema. Tente perguntar "o que você ensina?" para ver os tópicos disponíveis.';
  }

  const contextoPrepared = fragmentos.map((f, i) => {
    const loc = f.metadados?.localizacao;
    const tipo = f.metadados?.tipo || 'material';
    
    return `
┌─── Fonte ${i + 1} [${tipo}] ───┐
Documento: ${f.metadados?.arquivo_nome || 'Desconhecido'}
Localização: Pág. ${loc?.pagina || 'N/A'}${loc?.secao ? `, Seção ${loc.secao}` : ''}

CONTEÚDO:
${f.conteudo}
└────────────────────────────────┘
`;
  }).join('\n');

  const systemPrompt = `${this.personaEdu}

MATERIAIS DISPONÍVEIS:

${contextoPrepared}

INSTRUÇÕES PARA RESPOSTA:
1. Use APENAS as informações dos fragmentos acima
2. Seja CONCISO - máximo 3-4 frases principais
3. Destaque apenas os pontos mais relevantes
4. Cite as fontes no final
5. SEMPRE finalize com uma pergunta engajadora sobre o conteúdo

FORMATO DA RESPOSTA:
- 2-3 frases explicando o conceito principal
- 1-2 frases com exemplos ou aplicações práticas
- Citação das fontes
- Pergunta final para engajar o usuário

EXEMPLOS DE PERGUNTAS FINAIS:
- "Fez sentido? Quer que eu detalhe algum ponto específico?"
- "Entendeu a ideia? Posso mostrar exemplos práticos?"
- "Como está seu entendimento? Quer explorar mais algum aspecto?"
- "Te interessa ver aplicações práticas ou prefere mais teoria?"

Use APENAS as informações dos fragmentos.`;

  try {
    const historicoFormatado = historico.slice(-5).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    const result = await this.chatModel.generateContent({
      contents: [
        ...historicoFormatado,
        { role: 'user', parts: [{ text: `${systemPrompt}\n\nPERGUNTA: ${mensagem}` }] }
      ],
      generationConfig: { 
        temperature: 0.7,
        maxOutputTokens: 1024
      }
    });

    return result.response.text();

  } catch (error) {
    console.error('Erro ao gerar resposta com Google, tentando Grok:', error);
    
    try {
      const messages = [
        { role: 'system', content: systemPrompt },
        ...historico.slice(-5).map(msg => ({ 
          role: msg.role === 'user' ? 'user' : 'assistant', 
          content: msg.content 
        })),
        { role: 'user', content: `PERGUNTA: ${mensagem}` }
      ];
      
      return await this._callGrokAPI(messages, 0.7, 1024);
      
    } catch (grokError) {
      console.error('Erro com Grok API:', grokError);
      return 'Desculpe, ocorreu um erro ao processar os materiais. Tente reformular sua pergunta.';
    }
  }
}

  async gerarRespostaCasual(mensagem, historico = []) {
    const prompt = `${this.personaEdu}

Responda esta mensagem de forma breve e natural (1-2 frases).

USUÁRIO: ${mensagem}`;

    try {
      const historicoFormatado = historico.slice(-3).map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      }));

      const result = await this.chatModel.generateContent({
        contents: [
          ...historicoFormatado,
          { role: 'user', parts: [{ text: prompt }] }
        ],
        generationConfig: { 
          temperature: 0.8,
          maxOutputTokens: 300
        }
      });

      return result.response.text();

    } catch (error) {
      console.error('Erro na resposta casual com Google, tentando Grok:', error);
      
      try {
        const messages = [
          { role: 'system', content: prompt },
          ...historico.slice(-3).map(msg => ({ 
            role: msg.role === 'user' ? 'user' : 'assistant', 
            content: msg.content 
          })),
          { role: 'user', content: mensagem }
        ];
        
        return await this._callGrokAPI(messages, 0.8, 300);
        
      } catch (grokError) {
        console.error('Erro com Grok API:', grokError);
        return 'Olá! Como posso te ajudar com os materiais didáticos hoje?';
      }
    }
  }

  async listarTopicos(topicos, historico = []) {
    if (!topicos || topicos.length === 0) {
      return 'No momento não há tópicos disponíveis no banco de dados.';
    }

    const topicosRelevantes = topicos
      .sort((a, b) => (b.fragmentos || 0) - (a.fragmentos || 0))
      .slice(0, 5)
      .map(t => t.nome || t.topico)
      .filter(Boolean)
      .join(', ');

    const prompt = `${this.personaEdu}

Os principais tópicos disponíveis são: ${topicosRelevantes}

Responda em 2 frases listando os tópicos de forma natural e pergunte qual interessa.`;

    try {
      const result = await this.chatModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { 
          temperature: 0.7,
          maxOutputTokens: 200
        }
      });

      return result.response.text();

    } catch (error) {
      console.error('Erro ao listar tópicos com Google, tentando Grok:', error);
      
      try {
        const messages = [{ role: 'user', content: prompt }];
        return await this._callGrokAPI(messages, 0.7, 200);
        
      } catch (grokError) {
        console.error('Erro com Grok API:', grokError);
        return `Tenho materiais sobre: ${topicosRelevantes}. Qual te interessa?`;
      }
    }
  }
}