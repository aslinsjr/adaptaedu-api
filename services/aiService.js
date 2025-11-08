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

TÓPICOS DISPONÍVEIS NO BANCO:
${listaTopicos}

MENSAGEM DO USUÁRIO: "${mensagem}"

REGRAS DE CONVERSAÇÃO NATURAL:
1. Seja BREVE - máximo 2-3 frases
2. Se tópico NÃO existe, diga claramente e sugira apenas 2-3 relacionados
3. NUNCA liste todos os tópicos - seja seletivo
4. Mantenha continuidade conversacional
5. Se for exercício, CONTEXTUALIZE antes de apresentar

EXEMPLOS CORRETOS:
❌ "Os tópicos disponíveis são: html, css, js, python, java..."
✅ "Não tenho sobre ferro. Tenho programação web e HTML5. Qual te interessa?"

❌ Jogar exercício direto sem contexto
✅ "HTML5 é a base da web. Quer que eu explique conceitos ou prefere exercícios?"

ANALISE e responda com JSON válido:

{
  "acao": "casual" | "descoberta" | "consulta",
  "busca": {
    "query": "string otimizada para busca vetorial (extraia palavras-chave relevantes)",
    "tipo_material": "pdf" | "video" | "imagem" | "audio" | null,
    "tags": ["tag1", "tag2"] ou [],
    "limite": 5
  },
  "resposta_direta": "texto se ação for casual ou descoberta (MÁXIMO 3 FRASES), null se for consulta",
  "explicacao": "breve justificativa da ação escolhida"
}

GUIA DE AÇÕES:
- "casual": saudações, agradecimentos, despedidas → responda diretamente (CURTO)
- "descoberta": "o que você ensina?", "quais tópicos?" → liste apenas 3-5 tópicos mais relevantes
- "consulta": perguntas sobre conteúdo específico → buscar no BD e responder

IMPORTANTE: 
- Responda APENAS com JSON válido, sem markdown
- Se for "consulta", query deve ser otimizada (ex: "fotossíntese plantas" em vez de "me explique sobre fotossíntese")
- Se usuário mencionar tipo de material (vídeo, texto, imagem), preencha tipo_material
- Extraia tags relevantes da mensagem se possível
- resposta_direta deve ser CONCISA e NATURAL`;

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
      
      // Validação básica
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
        
        // Fallback simples
        return {
          acao: 'consulta',
          busca: {
            query: mensagem,
            tipo_material: null,
            tags: [],
            limite: 5
          },
          resposta_direta: null,
          explicacao: 'Fallback por erro em ambas APIs'
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

VOCÊ ESTÁ RESPONDENDO USANDO MATERIAIS DIDÁTICOS:

${contextoPrepared}

INSTRUÇÕES CRÍTICAS:
1. Use APENAS as informações dos fragmentos acima
2. NUNCA use seu conhecimento geral
3. Seja CONCISO - máximo 4-5 frases curtas
4. Se fragmento for exercício/questão, PRIMEIRO explique o conceito em 1-2 frases, DEPOIS apresente
5. Cite a fonte: [Nome do documento, pág. X]
6. Use analogias simples quando possível
7. Termine perguntando se quer mais detalhes

ESTILO:
- Frases curtas e objetivas
- Evite listas longas
- Contextualize antes de apresentar exercícios
- Seja conversacional

Responda APENAS baseado nos fragmentos:`;

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
          maxOutputTokens: 2048
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
        
        return await this._callGrokAPI(messages, 0.7, 2048);
        
      } catch (grokError) {
        console.error('Erro com Grok API:', grokError);
        return 'Desculpe, ocorreu um erro ao processar os materiais. Tente reformular sua pergunta.';
      }
    }
  }

  async gerarRespostaCasual(mensagem, historico = []) {
    const prompt = `${this.personaEdu}

Responda esta saudação de forma BREVE e NATURAL (1-2 frases no máximo).
Seja amigável mas direto. Não liste funcionalidades.

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

    // Selecionar apenas os 5 tópicos mais relevantes (por quantidade de fragmentos)
    const topicosRelevantes = topicos
      .sort((a, b) => (b.fragmentos || 0) - (a.fragmentos || 0))
      .slice(0, 5)
      .map(t => t.nome || t.topico)
      .filter(Boolean)
      .join(', ');

    const prompt = `${this.personaEdu}

Os principais tópicos disponíveis são: ${topicosRelevantes}

Responda em 2 frases:
1. Liste os tópicos de forma natural
2. Pergunte qual interessa

Seja CONCISO e conversacional.`;

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