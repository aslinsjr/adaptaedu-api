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

      if (!currentId || !conversationManager.getConversa(currentId)) {
        currentId = conversationManager.criar();
        
        const boasVindas = `Olá! Posso mostrar os tópicos disponíveis ou explicar conteúdos específicos.

O que gostaria de aprender?`;

        conversationManager.adicionar(currentId, 'assistant', boasVindas, []);
      }

      conversationManager.adicionar(currentId, 'user', mensagem);

      const historico = conversationManager.getHistorico(currentId, 10);
      const topicosDisponiveis = await mongo.getAvailableTopics();

      // Buscar fragmentos relevantes para a mensagem
      const fragmentos = await vectorSearch.buscar(mensagem, {}, 5);
      
      // IA gera resposta diretamente - SEM CLASSIFICAÇÃO OU ORQUESTRAÇÃO
      const resposta = await ai.gerarResposta(mensagem, fragmentos, historico, topicosDisponiveis);

      conversationManager.adicionar(currentId, 'assistant', resposta, fragmentos);

      return res.json(
        ResponseFormatter.formatChatResponse(currentId, resposta, fragmentos, {})
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