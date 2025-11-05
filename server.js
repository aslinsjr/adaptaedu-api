// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoService } from './services/mongoClient.js';
import { FirebaseService } from './services/firebaseClient.js';
import { AIService } from './services/aiService.js';
import { VectorSearchService } from './services/vectorSearchService.js';
import { ConversationManager } from './services/conversationManager.js';
import { TextReconstructor } from './utils/textReconstructor.js';
import { createChatRoutes } from './routes/chatRoutes.js';
import { createDocumentRoutes } from './routes/documentRoutes.js';
import { createSearchRoutes } from './routes/searchRoutes.js';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// Inicialização dos serviços
const mongo = new MongoService();
const firebase = new FirebaseService();
const ai = new AIService();
const conversationManager = new ConversationManager();

await mongo.connect();
console.log('Connected to MongoDB');

const vectorSearch = new VectorSearchService(mongo, ai);
const textReconstructor = new TextReconstructor(mongo);

// === INICIALIZAÇÃO DO IntentDetector COM DADOS DO MONGODB ===
const { IntentDetector } = await import('./services/intentDetector.js');
const intentDetector = new IntentDetector(mongo.db); // Passa o db
await intentDetector.init(); // Carrega tópicos dinâmicos
console.log('IntentDetector inicializado com tópicos do MongoDB');

// === ROTAS ===
app.use('/api', createChatRoutes(vectorSearch, ai, conversationManager, mongo.db, intentDetector));
app.use('/api', createDocumentRoutes(mongo, textReconstructor, vectorSearch));
app.use('/api', createSearchRoutes(vectorSearch));

// === HEALTH CHECK ===
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// === LIMPEZA PERIÓDICA ===
setInterval(() => {
  conversationManager.limparConversasAntigas(24);
}, 60 * 60 * 1000);

// === INICIAR SERVIDOR ===
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Chat RAG API rodando na porta ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

// === GRACEFUL SHUTDOWN ===
process.on('SIGINT', async () => {
  console.log('\nEncerrando servidor...');
  await mongo.close();
  process.exit(0);
});