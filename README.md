# AdaptaEdu API

Sistema educacional de chat com busca semântica em documentos usando Retrieval-Augmented Generation (RAG).

## Tecnologias

- **Backend**: Node.js + Express
- **Database**: MongoDB Atlas (Vector Search)
- **IA**: Google Gemini 2.0 Flash + Grok (fallback)
- **Embeddings**: Google text-embedding-004

## Funcionalidades

- Chat contextual com RAG
- Busca vetorial em documentos
- Filtros por tags, tipo e arquivo
- Respostas baseadas em fragmentos ou conversação geral

## API Endpoints

### Chat

**POST** `/api/chat`

```json
{
  "mensagem": "Explique fotossíntese",
  "conversationId": "uuid-opcional"
}
```

**Resposta:**
```json
{
  "conversationId": "uuid",
  "tipo": "resposta",
  "resposta": "texto da resposta",
  "fontes": [
    {
      "chunk_id": "...",
      "texto": "preview do conteúdo...",
      "metadata": {
        "fonte": "...",
        "tipo": "pdf",
        "referencia_completa": "Documento, pág. 5"
      },
      "score": "0.850"
    }
  ],
  "documentos_usados": [
    {
      "nome": "Biologia.pdf",
      "tipo": "pdf",
      "url": "..."
    }
  ]
}
```

### ⚠️ Rotas de Conversa (Funcionalidade Futura)

> **Nota**: As rotas de recuperar e excluir conversas estão implementadas mas **sem funcionalidade no momento**. O salvamento persistente de conversas será uma implementação futura. Atualmente, as conversas existem apenas em memória e são perdidas ao reiniciar o servidor.

**GET** `/api/conversas/:conversationId` *(Planejado)*

**DELETE** `/api/conversas/:conversationId` *(Planejado)*

### Health Check

**GET** `/health`

```json
{
  "status": "ok",
  "timestamp": "2025-11-09T...",
  "uptime": 123.45
}
```

## Estrutura do Projeto

```
├── server.js                      # Servidor Express
├── services/
│   ├── aiService.js              # Google Gemini + Grok
│   ├── vectorSearchService.js    # Busca semântica
│   ├── mongoClient.js            # MongoDB Atlas Vector Search
│   ├── conversationManager.js    # Sessões em memória
│   └── firebaseClient.js         # Firebase Storage
├── routes/
│   └── chatRoutes.js             # Endpoints REST
└── utils/
    └── responseFormatter.js      # Formatação de respostas
```

## Fluxo de Funcionamento

1. **Usuário envia mensagem** → `/api/chat`
2. **Criação de embedding** → Google text-embedding-004
3. **Busca vetorial** → MongoDB Atlas Vector Search
4. **IA gera resposta** → Gemini/Grok com contexto dos fragmentos
5. **Retorno formatado** → Resposta + fontes + documentos

## Configuração do MongoDB

Requer índice vetorial:

```javascript
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 768,
      "similarity": "cosine"
    }
  ]
}
```

## Características

- **Fallback inteligente**: Grok usado se Gemini falhar
- **Respostas contextuais**: Histórico de até 10 mensagens
- **Score mínimo**: Fragmentos com score < 0.4 são filtrados
- **CORS habilitado**: Aceita requisições cross-origin

🔗 **[Acesse a aplicação](https://adaptaedu-api.vercel.app/)**

Desenvolvido por Alexandre Lins