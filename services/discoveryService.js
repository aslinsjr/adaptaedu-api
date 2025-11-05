// services/discoveryService.js
export class DiscoveryService {
  constructor(mongoService) {
    this.mongo = mongoService;
  }

  async listarTopicosDisponiveis() {
    const pipeline = [
      {
        $match: {
          'metadados.tags': { $exists: true, $ne: [] }
          // Evite filtros diretos sem $eq
        }
      },
      { $unwind: '$metadados.tags' },
      {
        $group: {
          _id: '$metadados.tags',
          fragmentos: { $sum: 1 },
          tipos: { $addToSet: '$metadados.tipo' },
          documentos: { $addToSet: '$metadados.arquivo_nome' }
        }
      },
      {
        $project: {
          topico: '$_id',
          fragmentos: 1,
          tipos: 1,
          documentos: 1,
          _id: 0
        }
      }
    ];

    return await this.db.collection('chunks').aggregate(pipeline).toArray();
  }

  async buscarPorTopico(topico) {
    const topicos = await this.mongo.getAvailableTopics();
    const topicoEncontrado = topicos.find(t =>
      t.topico.toLowerCase().includes(topico.toLowerCase())
    );

    if (!topicoEncontrado) return null;

    return {
      topico: topicoEncontrado.topico,
      documentos: topicoEncontrado.documentos,
      tipos: topicoEncontrado.tipos,
      fragmentos_disponiveis: topicoEncontrado.fragmentos
    };
  }

  async verificarSeEhTopicoConhecido(termo) {
    const topicos = await this.mongo.getAvailableTopics();
    const termoLower = termo.toLowerCase();

    const topicoEncontrado = topicos.find(t => {
      const topicoLower = t.topico.toLowerCase();
      return topicoLower.includes(termoLower) || termoLower.includes(topicoLower);
    });

    if (!topicoEncontrado) return null;

    return {
      encontrado: true,
      topico: topicoEncontrado.topico,
      tipos_material: topicoEncontrado.tipos,
      total_fragmentos: topicoEncontrado.fragmentos
    };
  }

  async listarPorTipoMaterial(tipo) {
    const documentos = await this.mongo.listAllDocuments();
    return documentos.filter(d => d.tipo === tipo);
  }

  agruparPorCategoria(topicos) {
    const categorias = new Map();

    for (const topico of topicos) {
      const categoria = this.inferirCategoria(topico.nome);

      if (!categorias.has(categoria)) {
        categorias.set(categoria, []);
      }

      categorias.get(categoria).push(topico);
    }

    return Array.from(categorias.entries()).map(([categoria, items]) => ({
      categoria,
      topicos: items,
      total: items.length
    }));
  }

  inferirCategoria(topico) {
    const lower = topico.toLowerCase();

    if (lower.match(/\b(programação|código|software|algoritmo|função)\b/)) {
      return 'Tecnologia';
    }
    if (lower.match(/\b(matemática|cálculo|geometria|álgebra|equação)\b/)) {
      return 'Matemática';
    }
    if (lower.match(/\b(física|química|biologia|ciência)\b/)) {
      return 'Ciências';
    }
    if (lower.match(/\b(história|geografia|sociedade|cultura)\b/)) {
      return 'Humanas';
    }
    if (lower.match(/\b(inglês|português|espanhol|idioma|língua)\b/)) {
      return 'Idiomas';
    }

    return 'Geral';
  }

  formatarParaApresentacao(dados) {
    const { topicos, resumo } = dados;

    const topicosDestaque = topicos
      .sort((a, b) => b.quantidade - a.quantidade)
      .slice(0, 8);

    return {
      destaques: topicosDestaque,
      categorias: this.agruparPorCategoria(topicos),
      estatisticas: resumo,
      sugestoes: this.gerarSugestoes(topicosDestaque)
    };
  }

  gerarSugestoes(topicos) {
    return topicos.slice(0, 3).map(t => ({
      texto: `Aprender sobre ${t.nome}`,
      topico: t.nome,
      tipos: t.tipos_disponiveis
    }));
  }
}