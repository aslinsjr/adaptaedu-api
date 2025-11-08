// services/aiService.js
import { GoogleGenerativeAI } from '@google/generative-ai';

export class AIService {
  constructor(googleApiKey = process.env.GOOGLE_API_KEY) {
    this.genAI = new GoogleGenerativeAI(googleApiKey);
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

ANALISE e responda com JSON válido:

{
  "acao": "casual" | "descoberta" | "consulta",
  "busca": {
    "query": "string otimizada para busca vetorial (extraia palavras-chave relevantes)",
    "tipo_material": "pdf" | "video" | "imagem" | "audio" | null,
    "tags": ["tag1", "tag2"] ou [],
    "limite": 5
  },
  "resposta_direta": "texto se ação for casual ou descoberta, null se for consulta",
  "explicacao": "breve justificativa da ação escolhida"
}

GUIA DE AÇÕES:
- "casual": saudações, agradecimentos, despedidas → responda diretamente
- "descoberta": "o que você ensina?", "quais tópicos?" → liste os tópicos disponíveis
- "consulta": perguntas sobre conteúdo específico → buscar no BD e responder

IMPORTANTE: 
- Responda APENAS com JSON válido, sem markdown
- Se for "consulta", query deve ser otimizada (ex: "fotossíntese plantas" em vez de "me explique sobre fotossíntese")
- Se usuário mencionar tipo de material (vídeo, texto, imagem), preencha tipo_material
- Extraia tags relevantes da mensagem se possível`;

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
      console.error('Erro na orquestração:', error);
      
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
        explicacao: 'Fallback por erro na análise'
      };
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
3. Se os fragmentos não respondem completamente, diga isso
4. Cite a fonte: [Nome do documento, pág. X]
5. Seja direto e didático

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
      console.error('Erro ao gerar resposta:', error);
      return 'Desculpe, ocorreu um erro ao processar os materiais. Tente reformular sua pergunta.';
    }
  }

  async gerarRespostaCasual(mensagem, historico = []) {
    const prompt = `${this.personaEdu}

Você está respondendo uma saudação casual. Seja breve, amigável e convide para fazer perguntas sobre os materiais.
NUNCA responda perguntas sobre conteúdo - apenas saudações.

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
      console.error('Erro na resposta casual:', error);
      return 'Olá! Como posso te ajudar com os materiais didáticos hoje?';
    }
  }

  async listarTopicos(topicos, historico = []) {
    if (!topicos || topicos.length === 0) {
      return 'No momento não há tópicos disponíveis no banco de dados.';
    }

    const listaTopicos = topicos
      .map(t => t.nome || t.topico)
      .filter(Boolean)
      .join(', ');

    const prompt = `${this.personaEdu}

Os tópicos disponíveis no banco de dados são: ${listaTopicos}

Responda de forma amigável (2-3 frases):
1. Mencione os tópicos disponíveis
2. Pergunte qual interessa ao usuário

Seja direto e convide à exploração.`;

    try {
      const result = await this.chatModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { 
          temperature: 0.7,
          maxOutputTokens: 400
        }
      });

      return result.response.text();

    } catch (error) {
      console.error('Erro ao listar tópicos:', error);
      return `Os tópicos disponíveis são: ${listaTopicos}. Sobre qual deles você gostaria de aprender?`;
    }
  }
}