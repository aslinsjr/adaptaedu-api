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
    const systemPrompt = contextoSistema || `${this.personaEdu}

Responda de forma direta e útil.
Seja natural e conversacional, mas objetivo.`;

    try {
      // Tenta Google Gemini primeiro
      const conversationHistory = historico.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      }));

      const result = await this.chatModel.generateContent({
        contents: [
          ...conversationHistory,
          {
            role: 'user',
            parts: [{ text: `${systemPrompt}\n\nUSUÁRIO: ${mensagem}` }]
          }
        ],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 2048,
        }
      });

      return result.response.text();

    } catch (error) {
      console.error('Erro com Google API, tentando Grok:', error);
      
      try {
        // Fallback para Grok
        const messages = [
          { role: 'system', content: systemPrompt },
          ...historico.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
          })),
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
    const materiaisPorTipo = {};
    
    for (const f of fragmentos) {
      const tipo = f.metadados.tipo.toLowerCase();
      const tipoAmigavel = tipo.includes('pdf') || tipo.includes('doc') || tipo.includes('txt') ? 'texto' : 
                          tipo.includes('video') || tipo.includes('mp4') ? 'vídeo' : 
                          tipo.includes('image') || tipo.includes('png') || tipo.includes('jpg') ? 'imagem' : tipo;
      
      if (!materiaisPorTipo[tipoAmigavel]) {
        materiaisPorTipo[tipoAmigavel] = [];
      }
      materiaisPorTipo[tipoAmigavel].push(f);
    }

    const systemPrompt = `${this.personaEdu}

Você está apresentando materiais didáticos de forma conversacional.

INSTRUÇÕES CRÍTICAS:
1. Comece retomando o TÓPICO da pergunta do usuário (ex: "Tenho os seguintes materiais sobre programação...", "Sobre HTML, tenho...")
2. Apresente os materiais usando este formato:
   - Para texto: "leia este texto para aprender sobre [tópico]"
   - Para vídeo: "assista este vídeo para aprender sobre [tópico]"
   - Para imagem: "veja esta imagem para aprender sobre [tópico]"
3. Se houver múltiplos materiais, conecte-os com "ou se preferir", "também tenho", etc
4. NÃO use bullets (-) ou listas numeradas
5. Escreva em um fluxo natural, como uma conversa
6. NUNCA comece com saudações

Exemplo bom: "Tenho os seguintes materiais sobre programação: assista este vídeo sobre âncoras HTML, ou se preferir leia estes textos sobre desenvolvimento PHP e HTML5."

Exemplo ruim: "Olá! Tenho sim! - Assista este vídeo... - Leia este texto..."

MATERIAIS DISPONÍVEIS:
${fragmentos.map((f, i) => {
  const tipo = f.metadados.tipo.toLowerCase();
  const tipoAmigavel = tipo.includes('pdf') || tipo.includes('doc') || tipo.includes('txt') ? 'texto' : 
                      tipo.includes('video') || tipo.includes('mp4') ? 'vídeo' : 
                      tipo.includes('image') || tipo.includes('png') || tipo.includes('jpg') ? 'imagem' : tipo;
  return `[Material ${i + 1} - ${tipoAmigavel}: ${f.metadados.arquivo_nome}]
${f.conteudo}`;
}).join('\n---\n')}

Responda retomando o tópico da pergunta.`;

    const temperatura = preferencias?.profundidade === 'basico' ? 0.5 : 
                       preferencias?.profundidade === 'avancado' ? 0.8 : 0.7;

    try {
      // Tenta Google Gemini primeiro
      const conversationHistory = historico.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      }));

      const result = await this.chatModel.generateContent({
        contents: [
          ...conversationHistory,
          {
            role: 'user',
            parts: [{ text: `${systemPrompt}\n\nPERGUNTA: ${mensagem}` }]
          }
        ],
        generationConfig: {
          temperature: temperatura,
          maxOutputTokens: 2048,
        }
      });

      return result.response.text();

    } catch (error) {
      console.error('Erro com Google API, tentando Grok:', error);
      
      try {
        // Fallback para Grok
        const messages = [
          { role: 'system', content: systemPrompt },
          ...historico.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
          })),
          { role: 'user', content: `PERGUNTA: ${mensagem}` }
        ];

        return await this._callGrokAPI(messages, temperatura, 2048);

      } catch (grokError) {
        console.error('Erro com Grok API:', grokError);
        return 'Desculpe, estou com dificuldades técnicas no momento. Por favor, tente novamente em instantes.';
      }
    }
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

Exemplo: "Os tópicos disponíveis são [tópicos]. Tenho material em [formatos]. Qual tópico te interessa?"

IMPORTANTE: Vá direto ao ponto, sem saudações.`
  : `Você está apresentando materiais pela primeira vez nesta conversa.

TÓPICOS: ${listaTopicos}
FORMATOS: ${tiposDisponiveis}

Crie uma apresentação conversacional (NÃO use listas ou bullets):
1. Breve introdução
2. Liste os tópicos disponíveis em texto corrido
3. Mencione os formatos de material
4. Pergunte qual tópico interessa

Seja amigável mas conciso. Não use saudações como "Olá" ou "Oi".`}`;

    try {
      // Tenta Google Gemini primeiro
      const result = await this.chatModel.generateContent({
        contents: [{
          role: 'user',
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 500,
        }
      });

      return result.response.text();

    } catch (error) {
      console.error('Erro com Google API, tentando Grok:', error);
      
      try {
        // Fallback para Grok
        const messages = [
          { role: 'system', content: this.personaEdu },
          { role: 'user', content: prompt }
        ];

        return await this._callGrokAPI(messages, 0.7, 500);

      } catch (grokError) {
        console.error('Erro com Grok API:', grokError);
        return 'Desculpe, estou com dificuldades técnicas no momento. Por favor, tente novamente em instantes.';
      }
    }
  }

  async gerarEngajamentoTopico(topico, tiposMaterial, historico = []) {
    const tipos = tiposMaterial.join(' e ');
    
    const prompt = `${this.personaEdu}

O usuário demonstrou interesse no tópico: ${topico}

MATERIAIS DISPONÍVEIS: ${tipos}

Crie uma resposta conversacional (2-3 linhas) que:
1. Reconheça o interesse no tópico de forma natural
2. Pergunte O QUE ESPECIFICAMENTE ele quer aprender sobre o tópico
3. Seja direto e acolhedor
4. NÃO use saudações

Exemplo: "Legal! ${topico} é um ótimo tema. O que especificamente você quer aprender sobre ${topico}?"

NÃO liste subtópicos, apenas pergunte o que ele quer saber.`;

    try {
      // Tenta Google Gemini primeiro
      const result = await this.chatModel.generateContent({
        contents: [{
          role: 'user',
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 300,
        }
      });

      return result.response.text();

    } catch (error) {
      console.error('Erro com Google API, tentando Grok:', error);
      
      try {
        // Fallback para Grok
        const messages = [
          { role: 'system', content: this.personaEdu },
          { role: 'user', content: prompt }
        ];

        return await this._callGrokAPI(messages, 0.8, 300);

      } catch (grokError) {
        console.error('Erro com Grok API:', grokError);
        return 'Desculpe, estou com dificuldades técnicas no momento. Por favor, tente novamente em instantes.';
      }
    }
  }

}