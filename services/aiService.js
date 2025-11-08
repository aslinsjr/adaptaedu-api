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
    
    this.personaEdu = `Você é Edu, um assistente educacional que trabalha EXCLUSIVAMENTE com materiais didáticos armazenados.

REGRAS ABSOLUTAS:
- NUNCA responda usando seu conhecimento geral
- SOMENTE explique conteúdos baseados nos fragmentos fornecidos
- Se NÃO houver fragmentos, NUNCA tente responder a pergunta
- Seja direto e didático nas explicações`;
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

  // MODIFICADO: Apenas para saudações casuais
  async conversarLivremente(mensagem, historico = [], contextoSistema = '') {
    const systemPrompt = `${this.personaEdu}

Você está respondendo uma saudação casual. Seja breve, amigável e convide para fazer perguntas sobre os materiais.
NUNCA responda perguntas sobre conteúdo - apenas saudações.`;

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
        generationConfig: { temperature: 0.8, maxOutputTokens: 300 }
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
        return await this._callGrokAPI(messages, 0.8, 300);
      } catch (grokError) {
        console.error('Erro com Grok API:', grokError);
        return 'Oi! Como posso te ajudar com os materiais didáticos hoje?';
      }
    }
  }

  // MODIFICADO: Validação rígida de fragmentos
  async responderComContexto(mensagem, historico = [], fragmentos = [], preferencias = null) {
    // CRÍTICO: Sem fragmentos = sem resposta
    if (!fragmentos || fragmentos.length === 0) {
      throw new Error('Não é possível responder sem fragmentos válidos');
    }

    const systemPrompt = `${this.personaEdu}

VOCÊ ESTÁ RESPONDENDO USANDO MATERIAIS DIDÁTICOS:

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

CONTEÚDO:
${f.conteudo}
└────────────────────────────┘
`;
}).join('\n')}

INSTRUÇÕES CRÍTICAS:
1. Use APENAS as informações dos fragmentos acima
2. NUNCA use seu conhecimento geral
3. Se os fragmentos não respondem completamente, diga isso
4. Cite a fonte: [Nome do documento, pág. X]
5. Seja direto e didático

Responda APENAS baseado nos fragmentos:`;

    const temperatura = preferencias?.profundidade === 'basico' ? 0.5 : 0.7;

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
        throw new Error('Erro ao gerar resposta com materiais');
      }
    }
  }

  async apresentarMateriaisContextual(materiais, contextoHistorico) {
    const listaMateriais = materiais.map((m, i) => ({
      numero: i + 1,
      nome: m.arquivo_nome,
      tipo: this.mapearTipoAmigavel(m.tipo)
    }));

    const prompt = `${this.personaEdu}

Encontrei ${listaMateriais.length} materiais relevantes:

${listaMateriais.map(m => `${m.numero}. ${m.nome} (${m.tipo})`).join('\n')}

Responda de forma direta (máximo 2 frases):
- Mencione que encontrou os materiais
- Pergunte qual o usuário prefere

Exemplo: "Encontrei ${listaMateriais.length} materiais sobre o tema. Qual você quer que eu use para explicar?"`;

    try {
      const result = await this.chatModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 250 }
      });
      
      return result.response.text();
    } catch (error) {
      return `Encontrei ${listaMateriais.length} materiais:\n\n${listaMateriais.map(m => `${m.numero}. ${m.nome} (${m.tipo})`).join('\n')}\n\nQual você prefere?`;
    }
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

  async apresentarTopicos(topicos, tiposMaterial, historico = []) {
    const listaTopicos = topicos.map(t => t.nome).join(', ');
    const tiposDisponiveis = [...new Set(tiposMaterial.map(t => t.tipo))].join(' e ');

    const prompt = `${this.personaEdu}

Materiais disponíveis:

TÓPICOS: ${listaTopicos}
FORMATOS: ${tiposDisponiveis}

Responda brevemente (2-3 frases):
1. Mencione os tópicos disponíveis
2. Mencione os formatos
3. Pergunte qual interessa

Seja direto e amigável.`;

    try {
      const result = await this.chatModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 400 }
      });
      return result.response.text();
    } catch (error) {
      return `Os tópicos disponíveis são: ${listaTopicos}. Tenho material em ${tiposDisponiveis}. Qual tópico te interessa?`;
    }
  }
}