import express from 'express';
import { ResponseFormatter } from '../utils/responseFormatter.js';

export function createSearchRoutes(vectorSearch) {
  const router = express.Router();

  router.post('/buscar', async (req, res) => {
    try {
      const { query, limite = 10, filtros = {} } = req.body;

      if (!query) {
        return res.status(400).json(
          ResponseFormatter.formatError('Query é obrigatória', 400)
        );
      }

      const resultados = await vectorSearch.buscarFragmentosRelevantes(
        query,
        filtros,
        limite
      );

      res.json(ResponseFormatter.formatSearchResponse(resultados));
    } catch (error) {
      console.error('Erro na busca:', error);
      res.status(500).json(
        ResponseFormatter.formatError(error.message)
      );
    }
  });

  return router;
}
