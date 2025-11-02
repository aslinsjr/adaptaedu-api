// services/mongoClient.js
import { MongoClient, ObjectId } from 'mongodb';

export class MongoService {
  constructor(uri = process.env.MONGODB_URI) {
    this.client = new MongoClient(uri);
    this.dbName = 'rag_db';
    this.collectionName = 'documentos';
  }

  async connect() {
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    this.collection = this.db.collection(this.collectionName);
  }

  async getChunkById(id) {
    return await this.collection.findOne({ _id: new ObjectId(id) });
  }

  async searchByVector(queryEmbedding, limit = 5, filtros = {}) {
    const pipeline = [
      {
        $vectorSearch: {
          index: 'vector_index',
          path: 'embedding',
          queryVector: queryEmbedding,
          numCandidates: limit * 10,
          limit: limit,
          filter: filtros
        }
      },
      {
        $project: {
          conteudo: 1,
          metadados: 1,
          score: { $meta: 'vectorSearchScore' }
        }
      }
    ];

    return await this.collection.aggregate(pipeline).toArray();
  }

  async getAllChunksFromDocument(arquivo_url) {
    return await this.collection
      .find({ 'metadados.arquivo_url': arquivo_url })
      .sort({ 'metadados.chunk_index': 1 })
      .toArray();
  }

  async getDocumentMetadata(arquivo_url) {
    const firstChunk = await this.collection.findOne(
      { 'metadados.arquivo_url': arquivo_url }
    );
    
    if (!firstChunk) return null;

    const totalChunks = await this.collection.countDocuments(
      { 'metadados.arquivo_url': arquivo_url }
    );

    return {
      arquivo_url: firstChunk.metadados.arquivo_url,
      arquivo_nome: firstChunk.metadados.arquivo_nome,
      tipo: firstChunk.metadados.tipo,
      tags: firstChunk.metadados.tags || [],
      tamanho_bytes: firstChunk.metadados.tamanho_bytes,
      total_chunks: totalChunks
    };
  }

  async listAllDocuments() {
    const docs = await this.collection
      .aggregate([
        {
          $group: {
            _id: '$metadados.arquivo_url',
            nome: { $first: '$metadados.arquivo_nome' },
            tipo: { $first: '$metadados.tipo' },
            chunks: { $sum: 1 },
            tamanho: { $first: '$metadados.tamanho_bytes' },
            tags: { $first: '$metadados.tags' }
          }
        },
        {
          $project: {
            _id: 0,
            arquivo_url: '$_id',
            arquivo_nome: '$nome',
            tipo: 1,
            chunks_total: '$chunks',
            tamanho_mb: { $divide: ['$tamanho', 1048576] },
            tags: 1
          }
        }
      ])
      .toArray();

    return docs;
  }

  async getAvailableTopics() {
    const topics = await this.collection
      .aggregate([
        { $unwind: '$metadados.tags' },
        {
          $group: {
            _id: '$metadados.tags',
            documentos: { $addToSet: '$metadados.arquivo_nome' },
            tipos: { $addToSet: '$metadados.tipo' },
            count: { $sum: 1 }
          }
        },
        {
          $project: {
            _id: 0,
            topico: '$_id',
            documentos: 1,
            tipos: 1,
            fragmentos: '$count'
          }
        },
        { $sort: { fragmentos: -1 } }
      ])
      .toArray();

    return topics;
  }

  async getDocumentsByType() {
    const byType = await this.collection
      .aggregate([
        {
          $group: {
            _id: {
              tipo: '$metadados.tipo',
              arquivo: '$metadados.arquivo_nome'
            }
          }
        },
        {
          $group: {
            _id: '$_id.tipo',
            documentos: { $push: '$_id.arquivo' },
            count: { $sum: 1 }
          }
        },
        {
          $project: {
            _id: 0,
            tipo: '$_id',
            documentos: 1,
            total: '$count'
          }
        }
      ])
      .toArray();

    return byType;
  }

  async getChunkContext(chunk_id) {
    const chunk = await this.getChunkById(chunk_id);
    if (!chunk) return null;

    const chunkIndex = chunk.metadados.chunk_index;
    const arquivo_url = chunk.metadados.arquivo_url;

    const anterior = await this.collection.findOne({
      'metadados.arquivo_url': arquivo_url,
      'metadados.chunk_index': chunkIndex - 1
    });

    const posterior = await this.collection.findOne({
      'metadados.arquivo_url': arquivo_url,
      'metadados.chunk_index': chunkIndex + 1
    });

    return {
      chunk_atual: chunk,
      contexto_anterior: anterior,
      contexto_posterior: posterior
    };
  }

  async close() {
    await this.client.close();
  }
}