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
        generationConfig: { temperature, maxOutputTokens: 2048 }
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

  async listarMateriaisParaEscolha(materiais, topico, historico = []) {
    const listaFormatada = materiais.map((m, i) => {
      const tipo = m.tipo.toLowerCase().includes('video') ? 'vídeo' :
                   m.tipo.toLowerCase().includes('pdf') || m.tipo.toLowerCase().includes('doc') ? 'texto' :
                   m.tipo.toLowerCase().includes('image') ? 'imagem' : m.tipo;
      return `${i + 1}. ${m.arquivo_nome} (${tipo})`;
    }).join('\n');

    const prompt = `${this.personaEdu}

O usuário perguntou sobre: ${topico}

OPÇÕES:
${listaFormatada}

Resposta:
1. Reconheça múltiplos materiais
2. Explique brevemente cada um
3. Liste numerada
4. Pergunte qual prefere
5. Fluxo natural

Exemplo: "Sobre ${topico}, tenho dois materiais:
1. Guia HTML (texto) - introdução completa
2. Vídeo Aulas (vídeo) - exemplos práticos
Qual você prefere?"`;

    try {
      const result = await this.chatModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 500 }
      });
      return result.response.text();
    } catch (error) {
      try {
        const messages = [{ role: 'system', content: this.personaEdu }, { role: 'user', content: prompt }];
        return await this._callGrokAPI(messages, 0.7, 500);
      } catch (grokError) {
        return 'Desculpe, estou com dificuldades técnicas.';
      }
    }
  }
}