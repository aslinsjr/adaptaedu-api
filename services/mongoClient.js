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
    // Construir o filtro compatível com Atlas Vector Search
    let filter = undefined;
    
    if (Object.keys(filtros).length > 0) {
      // Processar filtros especiais ($or)
      if (filtros.$or) {
        // Converter regex para formato Atlas
        filter = {
          $or: filtros.$or.map(condition => {
            const result = {};
            for (const [key, value] of Object.entries(condition)) {
              if (value && value.$regex) {
                // Atlas Vector Search usa text match, não regex
                const cleanValue = value.$regex.source
                  .replace(/^\^/, '')
                  .replace(/\$$/, '')
                  .toLowerCase();
                result[key] = cleanValue;
              } else {
                result[key] = value;
              }
            }
            return result;
          })
        };
      } else {
        // Processar filtros normais
        filter = {};
        for (const [key, value] of Object.entries(filtros)) {
          if (value && value.$regex) {
            // Converter regex para string simples
            const cleanValue = value.$regex.source
              .replace(/^\^/, '')
              .replace(/\$$/, '')
              .toLowerCase();
            filter[key] = cleanValue;
          } else if (value && value.$in) {
            // Manter $in como está
            filter[key] = value;
          } else {
            filter[key] = value;
          }
        }
      }
    }

    const pipeline = [
      {
        $vectorSearch: {
          index: 'vector_index',
          path: 'embedding',
          queryVector: queryEmbedding,
          numCandidates: limit * 10,
          limit: limit,
          ...(filter && Object.keys(filter).length > 0 ? { filter } : {})
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

    // Debug pipeline
    if (process.env.DEBUG === 'true') {
      console.log('MongoDB Pipeline:', JSON.stringify(pipeline, null, 2));
    }

    try {
      const results = await this.collection.aggregate(pipeline).toArray();
      
      // Se não retornou resultados com filtro de tipo, tentar busca alternativa
      if (results.length === 0 && filtros['metadados.tipo']) {
        console.log('Tentando busca alternativa sem filtro vetorial...');
        
        // Busca híbrida: primeiro vetorial sem filtro, depois filtra manualmente
        const pipelineAlternative = [
          {
            $vectorSearch: {
              index: 'vector_index',
              path: 'embedding',
              queryVector: queryEmbedding,
              numCandidates: limit * 20, // Buscar mais candidatos
              limit: limit * 4 // Pegar mais resultados para filtrar depois
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
        
        const allResults = await this.collection.aggregate(pipelineAlternative).toArray();
        
        // Filtrar manualmente por tipo
        const filteredResults = allResults.filter(doc => {
          if (filtros['metadados.tipo']) {
            if (filtros['metadados.tipo'].$regex) {
              const tipoPattern = filtros['metadados.tipo'].$regex.source
                .replace(/^\^/, '')
                .replace(/\$$/, '')
                .toLowerCase();
              return doc.metadados?.tipo?.toLowerCase().includes(tipoPattern);
            } else if (filtros['metadados.tipo'].$in) {
              return filtros['metadados.tipo'].$in.includes(doc.metadados?.tipo);
            } else {
              return doc.metadados?.tipo === filtros['metadados.tipo'];
            }
          }
          return true;
        });
        
        // Retornar apenas o limite solicitado
        return filteredResults.slice(0, limit);
      }
      
      return results;
    } catch (error) {
      console.error('Erro na busca vetorial:', error);
      throw error;
    }
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

  // Método auxiliar para testar tipos únicos no banco
  async getUniqueTypes() {
    const tipos = await this.collection
      .aggregate([
        { 
          $group: { 
            _id: '$metadados.tipo',
            count: { $sum: 1 }
          } 
        },
        { $sort: { count: -1 } }
      ])
      .toArray();
    
    return tipos.map(t => ({ tipo: t._id, count: t.count }));
  }

  async close() {
    await this.client.close();
  }
}