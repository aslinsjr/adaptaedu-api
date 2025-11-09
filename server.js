// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoService } from './services/mongoClient.js';
import { AIService } from './services/aiService.js';
import { VectorSearchService } from './services/vectorSearchService.js';
import { ConversationManager } from './services/conversationManager.js';
import { createChatRoutes } from './routes/chatRoutes.js';

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors());

app.use((req, res, next) => {
  res.charset = 'utf-8';
  res.set('Content-Type', 'application/json; charset=utf-8');
  next();
});

const mongo = new MongoService();
const ai = new AIService();
const conversationManager = new ConversationManager();

await mongo.connect();
console.log('✓ Conectado ao MongoDB');

const vectorSearch = new VectorSearchService(mongo, ai);

app.use('/api', createChatRoutes(vectorSearch, ai, conversationManager, mongo));

app.get('/', (req, res) => {
  res.json({
    nome: 'AdaptaEdu API',
    versao: '1.0.0',
    descricao: 'Sistema educacional com busca semântica em documentos',
    endpoints: {
      chat: 'POST /api/chat',
      conversa: 'GET /api/conversas/:id',
      excluir: 'DELETE /api/conversas/:id',
      health: 'GET /health'
    },
    status: 'online',
    timestamp: new Date()
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

setInterval(() => {
  conversationManager.limparAntigas(24);
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✓ Chat RAG API rodando na porta ${PORT}`);
  console.log(`✓ Health check: http://localhost:${PORT}/health`);
  console.log(`✓ Modo: IA orquestra todo o fluxo`);
});

process.on('SIGINT', async () => {
  console.log('\nEncerrando servidor...');
  await mongo.close();
  process.exit(0);
});