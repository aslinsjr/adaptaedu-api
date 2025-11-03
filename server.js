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

// Configuração CORS completa
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://adaptaedu.vercel.app',
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:8080'
    ];
    
    // Permite requisições sem origin (Postman, mobile apps, etc)
    if (!origin) return callback(null, true);
    
    // Permite qualquer subdomínio do Vercel em preview/desenvolvimento
    if (origin.includes('vercel.app')) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Origem não permitida pelo CORS'));
    }
  },
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Length', 'X-Request-Id'],
  maxAge: 86400 // 24 horas de cache para preflight
};

app.use(cors(corsOptions));
app.use(express.json());

const mongo = new MongoService();
const firebase = new FirebaseService();
const ai = new AIService();
const conversationManager = new ConversationManager();

await mongo.connect();
console.log('✓ Conectado ao MongoDB');

const vectorSearch = new VectorSearchService(mongo, ai);
const textReconstructor = new TextReconstructor(mongo);

app.use(cors());

app.use('/api', createChatRoutes(vectorSearch, ai, conversationManager, mongo));
app.use('/api', createDocumentRoutes(mongo, textReconstructor, vectorSearch));
app.use('/api', createSearchRoutes(vectorSearch));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

setInterval(() => {
  conversationManager.limparConversasAntigas(24);
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✓ Chat RAG API rodando na porta ${PORT}`);
  console.log(`✓ Health check: http://localhost:${PORT}/health`);
});

process.on('SIGINT', async () => {
  console.log('\nEncerrando servidor...');
  await mongo.close();
  process.exit(0);
});
