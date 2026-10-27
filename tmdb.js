'use strict';

const express = require('express');

const router = express.Router();

const API_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 200;

function obterToken() {
  return String(process.env.TMDB_READ_ACCESS_TOKEN || '').trim();
}

function obterIdioma(valor) {
  const permitido = new Set([
    'pt-PT',
    'pt-BR',
    'en-US',
    'fr-FR'
  ]);

  return permitido.has(valor) ? valor : 'pt-PT';
}

function obterPagina(valor) {
  const pagina = Number.parseInt(valor || '1', 10);

  if (!Number.isInteger(pagina) || pagina < 1) return 1;

  return Math.min(pagina, 500);
}

async function consultarTMDB(caminho, parametros = {}) {
  const token = obterToken();

  if (!token) {
    const erro = new Error('Catálogo temporariamente indisponível.');
    erro.status = 503;
    throw erro;
  }

  const url = new URL(API_BASE + caminho);

  for (const [chave, valor] of Object.entries(parametros)) {
    if (valor !== undefined && valor !== null && valor !== '') {
      url.searchParams.set(chave, String(valor));
    }
  }

  const chaveCache = url.toString();
  const guardado = cache.get(chaveCache);

  if (guardado && Date.now() - guardado.tempo < CACHE_TTL) {
    return guardado.dados;
  }

  const resposta = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(10000)
  });

  if (!resposta.ok) {
    if (resposta.status === 401 || resposta.status === 403) {
      console.error('TMDB recusou a autenticação. Verifica as variáveis de ambiente.');
      const erro = new Error('Autenticação do catálogo indisponível.');
      erro.status = 502;
      throw erro;
    }

    const erro = new Error(
      resposta.status === 429
        ? 'Limite de pedidos ao catálogo atingido.'
        : 'Não foi possível consultar o catálogo.'
    );

    erro.status = resposta.status === 429 ? 429 : 502;
    throw erro;
  }

  const dados = await resposta.json();

  if (cache.size >= CACHE_MAX) {
    const primeiraChave = cache.keys().next().value;
    if (primeiraChave) cache.delete(primeiraChave);
  }

  cache.set(chaveCache, {
    tempo: Date.now(),
    dados
  });

  return dados;
}

function normalizarItem(item, tipo) {
  return {
    id: item.id,
    tipo,
    titulo: item.title || item.name || '',
    tituloOriginal: item.original_title || item.original_name || '',
    sinopse: item.overview || '',
    dataLancamento: item.release_date || item.first_air_date || null,
    classificacao: Number(item.vote_average || 0),
    numeroVotos: Number(item.vote_count || 0),
    poster: item.poster_path
      ? `${IMAGE_BASE}/w500${item.poster_path}`
      : null,
    capa: item.backdrop_path
      ? `${IMAGE_BASE}/w1280${item.backdrop_path}`
      : null,
    generos: Array.isArray(item.genre_ids) ? item.genre_ids : [],
    popularidade: Number(item.popularity || 0)
  };
}

function tratarErro(res, erro) {
  const status = Number(erro.status) || 502;

  if (status >= 500) {
    console.error('Erro no catálogo TMDB:', erro.message);
  }

  return res.status(status).json({
    ok: false,
    error: erro.message || 'Catálogo temporariamente indisponível.'
  });
}

router.get('/status', (req, res) => {
  res.json({
    ok: true,
    service: 'SHAZAM IPTV Catalog',
    configured: Boolean(obterToken())
  });
});

router.get('/filmes', async (req, res) => {
  try {
    const dados = await consultarTMDB('/movie/popular', {
      language: obterIdioma(req.query.language),
      page: obterPagina(req.query.page)
    });

    res.set('Cache-Control', 'public, max-age=60');

    return res.json({
      ok: true,
      pagina: dados.page,
      totalPaginas: dados.total_pages,
      resultados: (dados.results || []).map(item =>
        normalizarItem(item, 'filme')
      )
    });
  } catch (erro) {
    return tratarErro(res, erro);
  }
});

router.get('/series', async (req, res) => {
  try {
    const dados = await consultarTMDB('/tv/popular', {
      language: obterIdioma(req.query.language),
      page: obterPagina(req.query.page)
    });

    res.set('Cache-Control', 'public, max-age=60');

    return res.json({
      ok: true,
      pagina: dados.page,
      totalPaginas: dados.total_pages,
      resultados: (dados.results || []).map(item =>
        normalizarItem(item, 'serie')
      )
    });
  } catch (erro) {
    return tratarErro(res, erro);
  }
});

router.get('/pesquisa', async (req, res) => {
  try {
    const consulta = String(req.query.q || '').trim();

    if (consulta.length < 2) {
      return res.status(400).json({
        ok: false,
        error: 'Introduz pelo menos 2 caracteres para pesquisar.'
      });
    }

    if (consulta.length > 100) {
      return res.status(400).json({
        ok: false,
        error: 'A pesquisa é demasiado longa.'
      });
    }

    const dados = await consultarTMDB('/search/multi', {
      query: consulta,
      language: obterIdioma(req.query.language),
      page: obterPagina(req.query.page),
      include_adult: 'false'
    });

    const resultados = (dados.results || [])
      .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
      .map(item => normalizarItem(
        item,
        item.media_type === 'movie' ? 'filme' : 'serie'
      ));

    return res.json({
      ok: true,
      pagina: dados.page,
      totalPaginas: dados.total_pages,
      resultados
    });
  } catch (erro) {
    return tratarErro(res, erro);
  }
});

router.get('/detalhes/:tipo/:id', async (req, res) => {
  try {
    const { tipo } = req.params;
    const id = String(req.params.id || '');

    if (!['filme', 'serie'].includes(tipo)) {
      return res.status(400).json({
        ok: false,
        error: 'Tipo inválido. Utiliza filme ou serie.'
      });
    }

    if (!/^[1-9]\d{0,11}$/.test(id)) {
      return res.status(400).json({
        ok: false,
        error: 'Identificador inválido.'
      });
    }

    const recurso = tipo === 'filme' ? 'movie' : 'tv';

    const dados = await consultarTMDB(`/${recurso}/${id}`, {
      language: obterIdioma(req.query.language)
    });

    return res.json({
      ok: true,
      resultado: {
        ...normalizarItem(dados, tipo),
        sinopse: dados.overview || '',
        generos: (dados.genres || []).map(genero => ({
          id: genero.id,
          nome: genero.name
        })),
        duracao: dados.runtime || null,
        temporadas: dados.number_of_seasons || null,
        episodios: dados.number_of_episodes || null,
        estado: dados.status || null,
        trailerDisponivel: null
      }
    });
  } catch (erro) {
    return tratarErro(res, erro);
  }
});



/* SHAZAM_ANIMACAO_TEMPORADAS_V1 */

// Filmes e séries de animação: género oficial TMDB 16.
router.get('/animacao', async (req, res) => {
  try {
    const pagina = obterPagina(req.query.page);
    const idioma = obterIdioma(req.query.language);

    const [filmes, series] = await Promise.all([
      consultarTMDB('/discover/movie', {
        language: idioma,
        page: pagina,
        with_genres: '16',
        include_adult: 'false',
        sort_by: 'popularity.desc'
      }),
      consultarTMDB('/discover/tv', {
        language: idioma,
        page: pagina,
        with_genres: '16',
        include_adult: 'false',
        sort_by: 'popularity.desc'
      })
    ]);

    const resultados = [
      ...(filmes.results || []).map(item => normalizarItem(item, 'filme')),
      ...(series.results || []).map(item => normalizarItem(item, 'serie'))
    ].sort((a, b) => b.popularidade - a.popularidade);

    res.set('Cache-Control', 'public, max-age=60');

    return res.json({
      ok: true,
      pagina,
      resultados
    });
  } catch (erro) {
    return tratarErro(res, erro);
  }
});

// Temporadas reais de uma série.
router.get('/detalhes/serie/:id/temporadas', async (req, res) => {
  try {
    const id = String(req.params.id || '');

    if (!/^[1-9]\d{0,11}$/.test(id)) {
      return res.status(400).json({
        ok: false,
        error: 'Identificador de série inválido.'
      });
    }

    const dados = await consultarTMDB('/tv/' + id, {
      language: obterIdioma(req.query.language)
    });

    return res.json({
      ok: true,
      serieId: Number(id),
      titulo: dados.name || '',
      resultados: (dados.seasons || []).map(temporada => ({
        id: temporada.id,
        numero: temporada.season_number,
        titulo: temporada.name || '',
        sinopse: temporada.overview || '',
        episodios: temporada.episode_count || 0,
        dataLancamento: temporada.air_date || null,
        poster: temporada.poster_path
          ? IMAGE_BASE + '/w500' + temporada.poster_path
          : null
      }))
    });
  } catch (erro) {
    return tratarErro(res, erro);
  }
});

// Episódios reais de uma temporada.
router.get('/detalhes/serie/:id/temporada/:numero', async (req, res) => {
  try {
    const id = String(req.params.id || '');
    const numero = String(req.params.numero || '');

    if (!/^[1-9]\d{0,11}$/.test(id)) {
      return res.status(400).json({
        ok: false,
        error: 'Identificador de série inválido.'
      });
    }

    if (!/^(0|[1-9]\d{0,3})$/.test(numero)) {
      return res.status(400).json({
        ok: false,
        error: 'Número de temporada inválido.'
      });
    }

    const dados = await consultarTMDB(
      '/tv/' + id + '/season/' + numero,
      { language: obterIdioma(req.query.language) }
    );

    return res.json({
      ok: true,
      serieId: Number(id),
      temporada: Number(numero),
      titulo: dados.name || '',
      resultados: (dados.episodes || []).map(episodio => ({
        id: episodio.id,
        numero: episodio.episode_number,
        temporada: episodio.season_number,
        titulo: episodio.name || '',
        sinopse: episodio.overview || '',
        classificacao: Number(episodio.vote_average || 0),
        dataLancamento: episodio.air_date || null,
        duracao: episodio.runtime || null,
        poster: episodio.still_path
          ? IMAGE_BASE + '/w500' + episodio.still_path
          : null
      }))
    });
  } catch (erro) {
    return tratarErro(res, erro);
  }
});


module.exports = router;
