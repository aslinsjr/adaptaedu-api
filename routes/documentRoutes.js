import express from 'express';
import { ResponseFormatter } from '../utils/responseFormatter.js';

export function createDocumentRoutes(mongo, textReconstructor, vectorSearch) {
  const router = express.Router();

  router.get('/documentos', async (req, res) => {
    try {
      const documentos = await mongo.listAllDocuments();
      res.json(ResponseFormatter.formatDocumentListResponse(documentos));
    } catch (error) {
      console.error('Erro ao listar documentos:', error);
      res.status(500).json(
        ResponseFormatter.formatError(error.message)
      );
    }
  });

  router.get('/documento/:arquivo_url', async (req, res) => {
    try {
      const arquivo_url = decodeURIComponent(req.params.arquivo_url);

      const documento = await textReconstructor.reconstruirDocumento(arquivo_url);

      if (!documento) {
        return res.status(404).json(
          ResponseFormatter.formatError('Documento não encontrado', 404)
        );
      }

      res.json(ResponseFormatter.formatDocumentResponse(documento));
    } catch (error) {
      console.error('Erro ao buscar documento:', error);
      res.status(500).json(
        ResponseFormatter.formatError(error.message)
      );
    }
  });

  router.get('/fragmento/:chunk_id', async (req, res) => {
    try {
      const { chunk_id } = req.params;

      const contexto = await vectorSearch.expandirContexto(chunk_id);

      if (!contexto) {
        return res.status(404).json(
          ResponseFormatter.formatError('Fragmento não encontrado', 404)
        );
      }

      res.json(ResponseFormatter.formatFragmentoResponse(contexto));
    } catch (error) {
      console.error('Erro ao buscar fragmento:', error);
      res.status(500).json(
        ResponseFormatter.formatError(error.message)
      );
    }
  });

  return router;
}
