// services/aiService.js
import { GoogleGenerativeAI } from '@google/generative-ai';

export class AIService {
  constructor(googleApiKey = process.env.GOOGLE_API_KEY, grokApiKey = process.env.GROK_API_KEY) {
    this.genAI = new GoogleGenerativeAI(googleApiKey);
    this.grokApiKey = grokApiKey;
    this.embeddingModel = this.genAI.getGenerativeModel({ model: 'text-embedding-004' });
    this.chatModel = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
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

  async gerarResposta(mensagem, fragmentos = [], historico = [], topicosDisponiveis = []) {
    // Se não há fragmentos, é conversa geral
    if (fragmentos.length === 0) {
      return this._gerarRespostaGeral(mensagem, historico, topicosDisponiveis);
    }
    
    // Se há fragmentos, responder com base neles
    return this._gerarRespostaComFragmentos(mensagem, fragmentos, historico);
  }

  async _gerarRespostaGeral(mensagem, historico = [], topicosDisponiveis = []) {
    const topicosStr = topicosDisponiveis.length > 0 
      ? topicosDisponiveis.slice(0, 6).map(t => t.topico).join(', ')
      : 'nenhum tópico disponível';

    const prompt = `Você é um assistente educacional direto.

TÓPICOS DISPONÍVEIS: ${topicosStr}

Responda à mensagem do usuário de forma natural e concisa (2-3 frases).

Se for pergunta sobre o que pode ensinar, liste alguns tópicos principais.
Caso seja uma saudação, responda brevemente, caso contrário não precisa de saudação na resposta.
Se for pergunta sobre conteúdo, diga que precisa de materiais específicos.

Sempre finalize engajando o usuário.

USUÁRIO: ${mensagem}`;

    try {
      const result = await this.chatModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { 
          temperature: 0.7,
          maxOutputTokens: 500
        }
      });

      return result.response.text();

    } catch (error) {
      console.error('Erro ao gerar resposta geral com Google, tentando Grok:', error);
      
      try {
        const messages = [{ role: 'user', content: prompt }];
        return await this._callGrokAPI(messages, 0.7, 500);
        
      } catch (grokError) {
        console.error('Erro com Grok API:', grokError);
        return `Tenho materiais sobre: ${topicosStr}. O que gostaria de aprender?`;
      }
    }
  }

  async _gerarRespostaComFragmentos(mensagem, fragmentos, historico = []) {
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

    const prompt = `Você é um tutor educacional especialista. Use os seguintes materiais de referência para responder à pergunta do aluno:

${contextoPrepared}

**INSTRUÇÕES:**
1. Sempre baseie sua resposta somente nos materiais fornecidos
2. Caso não haja material informe ao usuário educadamente, e sugira algum dos tópicos disponíveis no material
3. Não precisa de saudação, mas caso haja contexto anterior, procure retomar a conversa
4. Explique o conceito usando SUAS PRÓPRIAS PALAVRAS, de forma clara e acessível
5. Destaque os pontos principais de maneira organizada
6. Mantenha a resposta concisa (3-4 frases no máximo)
7. Relacione o conteúdo com exemplos práticos quando possível
8. Separe blocos de frases e pule linhas para organizar a exibição
9. Ao final, faça uma pergunta reflexiva ou incentive a exploração do tema

PERGUNTA DO ALUNO: ${mensagem}`;

    try {
      const result = await this.chatModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { 
          temperature: 0.7,
          maxOutputTokens: 600
        }
      });

      return result.response.text();

    } catch (error) {
      console.error('Erro ao gerar resposta com fragmentos, tentando Grok:', error);
      
      try {
        const messages = [{ role: 'user', content: prompt }];
        return await this._callGrokAPI(messages, 0.7, 600);
        
      } catch (grokError) {
        console.error('Erro com Grok API:', grokError);
        return 'Desculpe, ocorreu um erro ao processar os materiais. Tente reformular sua pergunta.';
      }
    }
  }
}