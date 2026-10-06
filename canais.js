import mapa from "./mapa.js";

const canais = mapa.canais || [];

export function obterCanal(id) {
    return canais.find(canal => canal.id === id);
}

export function obterCanais() {
    return canais;
}

export function obterCategorias() {
    return mapa.categorias || [];
}

export function obterCategoria(id) {
    return (mapa.categorias || []).find(categoria => categoria.id === id);
}
