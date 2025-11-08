// routes/chatRoutes.js
import express from 'express';
import { ResponseFormatter } from '../utils/responseFormatter.js';

export function createChatRoutes(vectorSearch, ai, conversationManager, mongo) {
  const router = express.Router();

  router.post('/chat', async (req, res) => {
    try {
      const { mensagem, conversationId } = req.body;
      
      if (!mensagem) {
        return res.status(400).json(
          ResponseFormatter.formatError('Mensagem é obrigatória', 400)
        );
      }

      let currentId = conversationId;

      // Criar conversa se não existir
      if (!currentId || !conversationManager.getConversa(currentId)) {
        currentId = conversationManager.criar();
        
        // Adicionar mensagem de boas-vindas
        const boasVindas = `Olá! 👋 Sou o Edu, seu assistente educacional.

Trabalho com materiais didáticos específicos do banco de dados. Posso:

📚 Mostrar quais tópicos tenho disponíveis
💡 Explicar conteúdos usando os materiais
🎯 Adaptar as explicações ao seu ritmo

Pergunte "o que você ensina?" para ver os tópicos disponíveis, ou faça sua pergunta diretamente!`;

        conversationManager.adicionar(currentId, 'assistant', boasVindas, []);
      }

      // Adicionar mensagem do usuário
      conversationManager.adicionar(currentId, 'user', mensagem);

      const historico = conversationManager.getHistorico(currentId, 10);
      
      // Buscar tópicos disponíveis
      const topicosDisponiveis = await mongo.getAvailableTopics();

      // IA orquestra: analisa mensagem e decide ação
      const orquestracao = await ai.orquestrarMensagem(
        mensagem, 
        historico,
        topicosDisponiveis
      );

      let resposta = '';
      let fontes = [];
      let metadata = { acao: orquestracao.acao };

      // Executar ação determinada pela IA
      if (orquestracao.acao === 'casual') {
        resposta = orquestracao.resposta_direta || 
                   await ai.gerarRespostaCasual(mensagem, historico);
        
      } else if (orquestracao.acao === 'descoberta') {
        resposta = orquestracao.resposta_direta || 
                   await ai.listarTopicos(topicosDisponiveis, historico);
        metadata.topicos = topicosDisponiveis.slice(0, 10).map(t => ({
          nome: t.topico,
          quantidade: t.fragmentos
        }));
        
      } else if (orquestracao.acao === 'consulta') {
        // Buscar fragmentos no BD usando parâmetros extraídos pela IA
        fontes = await vectorSearch.buscar(
          orquestracao.busca.query,
          {
            tipo_material: orquestracao.busca.tipo_material,
            tags: orquestracao.busca.tags
          },
          orquestracao.busca.limite
        );

        if (fontes.length === 0) {
          resposta = `Não encontrei materiais sobre "${orquestracao.busca.query}".

Os tópicos disponíveis são: ${topicosDisponiveis.slice(0, 5).map(t => t.topico).join(', ')}.

Sobre qual deles você gostaria de aprender?`;
          
        } else {
          // IA formula resposta com fragmentos
          resposta = await ai.responderComFragmentos(mensagem, fontes, historico);
        }
      }

      // Salvar resposta do assistente
      conversationManager.adicionar(currentId, 'assistant', resposta, fontes);

      return res.json(
        ResponseFormatter.formatChatResponse(currentId, resposta, fontes, metadata)
      );

    } catch (error) {
      console.error('Erro no chat:', error);
      res.status(500).json(ResponseFormatter.formatError(error.message));
    }
  });

  router.get('/conversas/:conversationId', async (req, res) => {
    try {
      const { conversationId } = req.params;
      const conversa = conversationManager.getConversa(conversationId);
      
      if (!conversa) {
        return res.status(404).json(
          ResponseFormatter.formatError('Conversa não encontrada', 404)
        );
      }

      res.json(ResponseFormatter.formatConversationResponse(conversa));
    } catch (error) {
      console.error('Erro ao buscar conversa:', error);
      res.status(500).json(ResponseFormatter.formatError(error.message));
    }
  });

  router.delete('/conversas/:conversationId', async (req, res) => {
    try {
      const { conversationId } = req.params;
      const deletado = conversationManager.limpar(conversationId);
      
      if (!deletado) {
        return res.status(404).json(
          ResponseFormatter.formatError('Conversa não encontrada', 404)
        );
      }

      res.json({ success: true, message: 'Conversa excluída' });
    } catch (error) {
      console.error('Erro ao excluir conversa:', error);
      res.status(500).json(ResponseFormatter.formatError(error.message));
    }
  });

  return router;
}