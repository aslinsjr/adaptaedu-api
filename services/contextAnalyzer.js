// services/contextAnalyzer.js
export class ContextAnalyzer {
  analisarRelevancia(fragmentos, threshold = 0.7) {
    if (!fragmentos || fragmentos.length === 0) return { temConteudoRelevante: false };

    const fragmentosRelevantes = fragmentos.filter(f => f.score >= threshold);
    
    return {
      temConteudoRelevante: fragmentosRelevantes.length > 0,
      fragmentosRelevantes,
      scoreMaximo: Math.max(...fragmentos.map(f => f.score)),
      scoreMedio: fragmentos.reduce((sum, f) => sum + f.score, 0) / fragmentos.length
    };
  }

  analisarDocumentos(documentos) {
    const tiposUnicos = new Set(documentos.map(d => d.metadados.tipo));
    const fontesUnicas = new Set(documentos.map(d => d.metadados.arquivo_nome));
    const tagsUnicas = new Set(documentos.flatMap(d => d.metadados.tags || []));

    return {
      totalDocumentos: documentos.length,
      tiposUnicos: Array.from(tiposUnicos),
      fontesUnicas: Array.from(fontesUnicas),
      tagsUnicas: Array.from(tagsUnicas),
      diversidade: this.calcularDiversidade(documentos)
    };
  }

  calcularDiversidade(documentos) {
    const tipos = new Set(documentos.map(d => d.metadados.tipo));
    const fontes = new Set(documentos.map(d => d.metadados.arquivo_nome));
    
    const diversidadeTipos = tipos.size / Math.max(documentos.length, 1);
    const diversidadeFontes = fontes.size / Math.max(documentos.length, 1);
    
    return (diversidadeTipos + diversidadeFontes) / 2;
  }

  extrairTopicos(mensagens) {
    const stopWords = new Set([
      'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'em', 'no', 'na',
      'para', 'por', 'com', 'sem', 'sobre', 'como', 'que', 'qual', 'quando'
    ]);

    const palavrasChave = new Map();

    for (const msg of mensagens) {
      const palavras = msg.content
        .toLowerCase()
        .replace(/[^\w\sá-ú]/g, '')
        .split(/\s+/)
        .filter(p => p.length > 3 && !stopWords.has(p));

      for (const palavra of palavras) {
        palavrasChave.set(palavra, (palavrasChave.get(palavra) || 0) + 1);
      }
    }

    return Array.from(palavrasChave.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([palavra]) => palavra);
  }
}