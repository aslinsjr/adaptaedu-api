// services/aiService.js
import { GoogleGenerativeAI } from '@google/generative-ai';

export class AIService {
  constructor(apiKey = process.env.GOOGLE_API_KEY) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.embeddingModel = this.genAI.getGenerativeModel({ model: 'text-embedding-004' });
    this.chatModel = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
  }

  async createEmbedding(text) {
    const result = await this.embeddingModel.embedContent(text);
    return result.embedding.values;
  }

  async conversarLivremente(mensagem, historico = [], contextoSistema = '') {
    const conversationHistory = historico.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    const systemPrompt = contextoSistema || `Você é um assistente educacional.
Responda de forma direta e útil.
NÃO adicione saudações ou cumprimentos se já está em conversa.
Seja natural mas objetivo.`;

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

    const systemPrompt = `Você é um assistente educacional que apresenta materiais didáticos de forma conversacional.

INSTRUÇÕES CRÍTICAS:
1. Comece retomando o TÓPICO da pergunta do usuário (ex: "Tenho os seguintes materiais sobre programação...", "Sobre HTML, tenho...")
2. Apresente os materiais usando este formato:
   - Para texto: "leia este texto para aprender sobre [tópico]"
   - Para vídeo: "assista este vídeo para aprender sobre [tópico]"
   - Para imagem: "veja esta imagem para aprender sobre [tópico]"
3. Se houver múltiplos materiais, conecte-os com "ou se preferir", "também tenho", etc
4. NÃO use bullets (-) ou listas numeradas
5. Escreva em um fluxo natural, como uma conversa

Exemplo bom: "Tenho os seguintes materiais sobre programação: assista este vídeo sobre âncoras HTML, ou se preferir leia estes textos sobre desenvolvimento PHP e HTML5."

Exemplo ruim: "Tenho sim! - Assista este vídeo... - Leia este texto..."

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

    const conversationHistory = historico.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    const temperatura = preferencias?.profundidade === 'basico' ? 0.5 : 
                       preferencias?.profundidade === 'avancado' ? 0.8 : 0.7;

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
  }

  async apresentarTopicos(topicos, tiposMaterial, historico = []) {
    const temHistorico = historico.length > 0;
    const listaTopicos = topicos.map(t => t.nome).join(', ');
    const tiposDisponiveis = [...new Set(tiposMaterial.map(t => t.tipo))].join(' e ');

    const prompt = temHistorico 
      ? `Apresente os materiais disponíveis de forma direta, SEM saudações ou cumprimentos.

TÓPICOS: ${listaTopicos}
FORMATOS: ${tiposDisponiveis}

Responda de forma conversacional (NÃO use listas ou bullets) dizendo:
- Quais tópicos estão disponíveis (em texto corrido)
- Quais formatos de material existem
- Pergunte qual tópico interessa

Exemplo: "Os tópicos disponíveis são [tópicos]. Tenho material em [formatos]. Qual tópico te interessa?"

IMPORTANTE: NÃO use saudações como "Olá", "Que bom", etc. Vá direto ao ponto.`
      : `Você está apresentando materiais para alguém pela primeira vez.

TÓPICOS: ${listaTopicos}
FORMATOS: ${tiposDisponiveis}

Crie uma apresentação conversacional (NÃO use listas ou bullets):
1. Breve introdução
2. Liste os tópicos disponíveis em texto corrido
3. Mencione os formatos de material
4. Pergunte qual tópico interessa

Seja amigável mas conciso.`;

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
  }

  async gerarEngajamentoTopico(topico, tiposMaterial, historico = []) {
    const tipos = tiposMaterial.join(' e ');
    
    const prompt = `O usuário demonstrou interesse no tópico: ${topico}

MATERIAIS DISPONÍVEIS: ${tipos}

Crie uma resposta conversacional (2-3 linhas) que:
1. NÃO use saudações
2. Reconheça o interesse no tópico de forma natural
3. Pergunte O QUE ESPECIFICAMENTE ele quer aprender sobre o tópico
4. Seja direto e acolhedor

Exemplo: "Legal! ${topico} é um ótimo tema. O que especificamente você quer aprender sobre ${topico}?"

NÃO liste subtópicos, apenas pergunte o que ele quer saber.`;

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
  }

  async gerarOnboarding(topicosDisponiveis) {
    const prompt = `Você é um assistente educacional iniciando conversa com um novo usuário.

MATERIAIS DISPONÍVEIS:
${topicosDisponiveis.slice(0, 5).map(t => `- ${t.nome}`).join('\n')}

Crie uma mensagem de boas-vindas breve e calorosa que:
1. Se apresente como assistente de estudos
2. Mencione que pode ajudar com diversos assuntos
3. Pergunte o que o usuário gostaria de aprender

Máximo 3 linhas. Seja amigável mas direto.`;

    const result = await this.chatModel.generateContent({
      contents: [{
        role: 'user',
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 300,
      }
    });

    return result.response.text();
  }
}