'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const MAPA_FILE = path.join(__dirname, 'mapa.js');

let cacheMapa = null;
let cacheMtime = 0;

function carregarMapa() {
  const stat = fs.statSync(MAPA_FILE);

  if (cacheMapa && cacheMtime === stat.mtimeMs) {
    return cacheMapa;
  }

  const conteudo = fs.readFileSync(MAPA_FILE, 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/^\s*export\s+default\s*/, '')
    .replace(/;\s*$/, '');

  const mapa = JSON.parse(conteudo);

  if (!Array.isArray(mapa.categorias) ||
      !Array.isArray(mapa.canais)) {
    throw new Error('Estrutura inválida no mapa.js');
  }

  cacheMapa = mapa;
  cacheMtime = stat.mtimeMs;

  return mapa;
}

function erroServidor(res, erro) {
  console.error('Erro na API IPTV:', erro.message);

  return res.status(500).json({
    ok: false,
    error: 'Não foi possível carregar os dados IPTV.'
  });
}

router.get('/status', (req, res) => {
  try {
    const mapa = carregarMapa();

    res.set('Cache-Control', 'no-store');

    return res.json({
      ok: true,
      categorias: mapa.categorias.length,
      canais: mapa.canais.length
    });
  } catch (erro) {
    return erroServidor(res, erro);
  }
});

router.get('/categorias', (req, res) => {
  try {
    const mapa = carregarMapa();

    return res.json({
      ok: true,
      resultados: mapa.categorias.map(c => ({
        id: c.id,
        nome: c.nome,
        total: c.canais.length
      }))
    });
  } catch (erro) {
    return erroServidor(res, erro);
  }
});

router.get('/canais', (req, res) => {
  try {
    const mapa = carregarMapa();

    const categoria = String(req.query.categoria || '').trim();
    const pesquisa = String(req.query.q || '').trim().toLowerCase();

    const pagina = Math.max(
      1,
      Math.min(1000000, parseInt(req.query.pagina, 10) || 1)
    );

    const limite = Math.max(
      1,
      Math.min(100, parseInt(req.query.limite, 10) || 30)
    );

    if (categoria && !mapa.categorias.some(c => c.id === categoria)) {
      return res.status(400).json({
        ok: false,
        error: 'Categoria inexistente.'
      });
    }

    if (pesquisa.length > 100) {
      return res.status(400).json({
        ok: false,
        error: 'Pesquisa demasiado longa.'
      });
    }

    let canais = mapa.canais.filter(c => {
      if (c.ativo === false) return false;

      if (categoria && c.categoria !== categoria) return false;

      if (pesquisa) {
        const texto = `${c.nome || ''} ${c.tvgId || ''}`.toLowerCase();

        if (!texto.includes(pesquisa)) return false;
      }

      return true;
    });

    const total = canais.length;
    const inicio = (pagina - 1) * limite;

    canais = canais.slice(inicio, inicio + limite).map(c => ({
      id: c.id,
      nome: c.nome,
      categoria: c.categoria,
      logo: c.logo || '',
      tvgId: c.tvgId || '',
      tipo: c.tipo || 'hls',
      url: c.url
    }));

    res.set('Cache-Control', 'public, max-age=30');

    return res.json({
      ok: true,
      pagina,
      limite,
      total,
      totalPaginas: Math.ceil(total / limite),
      resultados: canais
    });
  } catch (erro) {
    return erroServidor(res, erro);
  }
});

module.exports = router;
