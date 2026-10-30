/* ════════════════════════════════════════════════════════════
   SHAZAM IPTV — lógica do site (vertical e horizontal)
   Onde ligar o teu conteúdo:
   1) SHAZAM.api.*      → troca os dados de exemplo por fetch() ao teu servidor
   2) SHAZAM.api.fonte  → devolve o link do vídeo SÓ no momento de assistir (de preferência
                          com assinatura e validade curta). Não guardes links de vídeo neste ficheiro.
   3) poster / backdrop → URL da imagem (ex.: TMDB)
   4) SHAZAM.onPlay / onCanal / onConta → eventos do utilizador
   ════════════════════════════════════════════════════════════ */
"use strict";
const ICON={
  message:'<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.2-4.2"/>',
  user:'<circle cx="12" cy="8.2" r="3.8"/><path d="M4.5 20.5c.6-3.8 3.6-5.6 7.5-5.6s6.9 1.8 7.5 5.6"/>',
  play:'<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.1"/>',
  home:'<path d="M3.5 11 12 3.8l8.5 7.2V20a1 1 0 0 1-1 1h-4.2v-6h-6.6v6H4.5a1 1 0 0 1-1-1z" fill="currentColor"/>',
  grid:'<rect x="4" y="4" width="6.5" height="6.5" rx="1.3"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.3"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.3"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.3"/>',
  tv:'<rect x="3" y="7.5" width="18" height="12" rx="2"/><path d="m8 3.5 4 4 4-4M10.5 11.5v4l3.5-2z"/>',
  clap:'<rect x="3.5" y="9" width="17" height="11" rx="1.5"/><path d="m3.5 9 1.6-4.5 15.4 3.2-.5 1.3M8 5.5l2.4 3.4M13 6.6l2.4 3.4"/>',
  mon:'<rect x="3" y="4.5" width="18" height="12" rx="1.8"/><path d="M9 20.5h6M12 16.5v4"/>',
  bear:'<circle cx="12" cy="13" r="7"/><circle cx="6.2" cy="6.4" r="2.2"/><circle cx="17.8" cy="6.4" r="2.2"/><path d="M9.6 12.4v.1M14.4 12.4v.1M10.6 16c.8.7 2 .7 2.8 0"/>',
  live:'<rect x="3" y="8" width="18" height="12" rx="2"/><path d="m8 3.8 4 4.2 4-4.2M11 12.2v4.6l4-2.3z"/>',
  cam:'<rect x="3" y="6.5" width="18" height="13" rx="2.2"/><circle cx="12" cy="13" r="3.4"/><path d="M8 6.5 9.2 4h5.6L16 6.5"/>'
};
const ic=n=>`<svg class="i" viewBox="0 0 24 24">${ICON[n]}</svg>`;


/* SHAZAM_API_REAL_V1 — integração com as APIs existentes */
const DB = {
  destaques: [],
  continuar: [],
  categorias: [
    {id:"filmes",nome:"Filmes",icone:"clap"},
    {id:"series",nome:"Séries",icone:"mon"},
    {id:"animes",nome:"Animes",icone:"bear"},
    {id:"canais",nome:"Canais ao vivo",icone:"live"},
    {id:"docs",nome:"Documentários",icone:"cam"}
  ],
  lancamentos: [],
  canais: [],
  todos: []
};

const SHAZAM = {
  api: {
    /* SHAZAM_AUTH_JWT_V1 */
    obterToken() {
      return localStorage.getItem("shazam_token") || "";
    },

    async pedido(url, opcoes = {}) {
      const headers = new Headers(opcoes.headers || {});
      const token = this.obterToken();

      if (token) {
        headers.set("Authorization", "Bearer " + token);
      }

      const resposta = await fetch(url, {
        ...opcoes,
        headers,
        credentials: "same-origin"
      });

      const dados = await resposta.json().catch(() => ({}));

      if (!resposta.ok) {
        if (
          token &&
          (resposta.status === 401 || resposta.status === 403) &&
          url.startsWith("/api/")
        ) {
          localStorage.removeItem("shazam_token");
          window.dispatchEvent(new CustomEvent("shazam:sessao-expirada"));
        }

        throw new Error(
          dados.error || dados.message || "Erro HTTP " + resposta.status
        );
      }

      return dados;
    },

    async destaques() {
      const dados = await this.pedido("/api/catalogo/filmes?pagina=1");
      return (dados.resultados || []).slice(0, 5).map(item => this.normalizar(item));
    },

    async continuar() {
      try {
        const guardado = JSON.parse(localStorage.getItem("shazam_continuar") || "[]");
        return Array.isArray(guardado) ? guardado : [];
      } catch {
        return [];
      }
    },

    async categorias() {
      const dados = await this.pedido("/api/iptv/categorias");
      const categorias = [
        {id:"filmes",nome:"Filmes",icone:"clap"},
        {id:"series",nome:"Séries",icone:"mon"},
        {id:"animes",nome:"Animes",icone:"bear"},
        {id:"canais",nome:"Canais ao vivo",icone:"live"},
        {id:"docs",nome:"Documentários",icone:"cam"}
      ];

      for (const c of dados.resultados || []) {
        categorias.push({
          id: "iptv:" + c.id,
          categoriaId: c.id,
          nome: c.nome,
          total: c.total,
          icone: "tv"
        });
      }

      return categorias;
    },

    async lancamentos() {
      const [filmes, series, animacao] = await Promise.all([
        this.pedido("/api/catalogo/filmes?pagina=1"),
        this.pedido("/api/catalogo/series?pagina=1"),
        this.pedido("/api/catalogo/animacao?pagina=1")
          .catch(erro => {
            console.warn("Catálogo de animação:", erro.message);
            return { resultados: [] };
          })
      ]);

      const catalogo = [
        ...(filmes.resultados || []).map(item => this.normalizar(item)),
        ...(series.resultados || []).map(item => this.normalizar(item)),
        ...(animacao.resultados || []).map(item => ({
          ...this.normalizar(item),
          id: "tmdb:animacao:" + item.id,
          cat: "animes",
          tipoOriginal: item.tipo
        }))
      ];

      return catalogo.sort((a, b) =>
        String(b.dataLancamento || "").localeCompare(String(a.dataLancamento || ""))
      );
    },

    async canais() {
      const dados = await this.pedido("/api/iptv/canais?pagina=1&limite=30");

      return (dados.resultados || []).map(c => ({
        id: "canal:" + c.id,
        canalId: c.id,
        titulo: c.nome || "Canal",
        nome: c.nome || "Canal",
        sub: c.categoria || "IPTV",
        categoria: c.categoria,
        logo: c.logo || "",
        url: c.url || "",
        tipo: c.tipo || "hls",
        tvgId: c.tvgId || "",
        h: 210,
        cat: "canais"
      }));
    },

    async utilizador() {
      try {
        const dados = await this.pedido("/api/me");
        const u = dados.user || dados.utilizador || dados;
        return {
          nome: u.nome || u.username || u.usuario || "Utilizador",
          plano: u.plano || u.assinatura || "Conta autenticada"
        };
      } catch {
        return {nome:"Visitante",plano:"Inicia sessão para aceder à tua conta"};
      }
    },

    normalizar(item) {
      const serie = item.tipo === "serie";
      const ano = String(item.dataLancamento || "").slice(0, 4);

      return {
        id: "tmdb:" + item.tipo + ":" + item.id,
        tmdbId: item.id,
        tipo: item.tipo,
        titulo: item.titulo || "Sem título",
        desc: item.sinopse || "",
        ano: ano || "—",
        dur: serie ? "Série" : "Filme",
        nota: Number(item.classificacao || 0).toFixed(1),
        poster: item.poster || "",
        backdrop: item.capa || "",
        cat: serie ? "series" : "filmes",
        dataLancamento: item.dataLancamento || "",
        generos: item.generos || [],
        src: ""
      };
    },

    async pesquisar(consulta) {
      const dados = await this.pedido(
        "/api/catalogo/pesquisa?q=" + encodeURIComponent(consulta)
      );
      return (dados.resultados || []).map(item => this.normalizar(item));
    },

    async fonte(item) {
      if (item && item.canalId) {
        const dados = await this.pedido(
          "/api/iptv/canais?pagina=1&limite=100&q=" +
          encodeURIComponent(item.nome || item.titulo || "")
        );

        const canal = (dados.resultados || []).find(
          c => String(c.id) === String(item.canalId)
        );

        return item.url || (canal && canal.url) || "";
      }

      return item && item.src ? item.src : "";
    }
  },

  /* SHAZAM_CONTA_FUNCOES_V1 */
  onPlay(item) {
    if (!item || !item.id) return;
    try {
      let lista = JSON.parse(localStorage.getItem("shazam_historico") || "[]");
      if (!Array.isArray(lista)) lista = [];
      lista = [
        {...item, vistoEm: new Date().toISOString()},
        ...lista.filter(x => x && x.id !== item.id)
      ].slice(0, 100);
      localStorage.setItem("shazam_historico", JSON.stringify(lista));
    } catch (e) {
      console.warn("Erro ao guardar histórico:", e.message);
    }
  },

  onConta(acao) {
    if (acao === "sair") return;

    const painel = document.getElementById("shzContaPainel");
    const titulo = document.getElementById("shzContaTitulo");
    const descricao = document.getElementById("shzContaDescricao");
    const conteudo = document.getElementById("shzContaConteudo");
    if (!painel || !titulo || !descricao || !conteudo) return;

    const ler = chave => {
      try {
        const dados = JSON.parse(localStorage.getItem(chave) || "[]");
        return Array.isArray(dados) ? dados : [];
      } catch {
        return [];
      }
    };

    const escapar = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    }[c]));

    const listar = (itens, favoritos) => {
      if (!itens.length) {
        conteudo.innerHTML = '<p class="shz-conta-vazio">Ainda não existem conteúdos nesta secção.</p>';
        return;
      }

      conteudo.innerHTML = itens.map(item => {
        const id = escapar(item.id);
        const nome = escapar(item.titulo || item.nome || "Conteúdo");
        const imagem = item.poster || item.logo || "";
        return `<article class="shz-conta-registo">
          ${imagem
            ? `<img class="shz-conta-miniatura" src="${escapar(imagem)}" alt="" loading="lazy">`
            : '<span class="shz-conta-miniatura shz-conta-sem-imagem">▶</span>'}
          <div class="shz-conta-registo-texto">
            <b>${nome}</b>
            ${!favoritos && item.vistoEm
              ? `<small>${escapar(new Date(item.vistoEm).toLocaleString())}</small>` : ""}
          </div>
          <button type="button" class="btn-info" data-conta-reproduzir="${id}">Abrir</button>
          ${favoritos
            ? `<button type="button" class="btn-info" data-fav-remover="${id}">Remover</button>` : ""}
        </article>`;
      }).join("");
    };

    painel.hidden = false;

    if (acao === "lista") {
      titulo.textContent = "Minha lista de favoritos";
      descricao.textContent = "Conteúdos guardados neste dispositivo.";
      listar(ler("shazam_favoritos"), true);
    } else if (acao === "historico") {
      titulo.textContent = "Histórico de visualização";
      descricao.textContent = "Conteúdos abertos para reprodução neste dispositivo.";
      listar(ler("shazam_historico"), false);
      const limpar = document.createElement("button");
      limpar.type = "button";
      limpar.className = "item";
      limpar.dataset.contaLimparHistorico = "1";
      limpar.textContent = "Limpar histórico";
      conteudo.appendChild(limpar);
    } else if (acao === "assinatura") {
      titulo.textContent = "Informações da assinatura";
      descricao.textContent = "Estado disponibilizado pelo sistema da conta.";
      conteudo.innerHTML = `<p><b>Utilizador:</b> ${escapar(document.getElementById("nomeUser")?.textContent || "Utilizador")}</p>
        <p><b>Estado:</b> ${escapar(document.getElementById("planoUser")?.textContent || "Não disponível")}</p>
        <p>Para confirmar validade ou pagamentos, contacta o suporte oficial.</p>
        <a class="item" href="https://wa.me/244950898368" target="_blank" rel="noopener noreferrer">Contactar suporte <span>↗</span></a>`;
    } else if (acao === "informacoes") {
      titulo.textContent = "Informações e suporte";
      descricao.textContent = "Conhece o SHAZAM IPTV e encontra os nossos canais oficiais de suporte.";

      conteudo.innerHTML = `
        <section class="shz-sobre-app">

          <p>
            Uma plataforma de entretenimento digital criada para facilitar
            a descoberta e o acesso aos conteúdos disponíveis no serviço.
          </p>
          <p>
            Explora filmes, séries, animes e canais de televisão,
            organiza os teus favoritos e consulta o histórico de visualização,
            conforme as funcionalidades disponíveis na plataforma.
          </p>
          <div class="shz-sobre-responsavel">
            <span>Proprietário e desenvolvedor</span>
            <strong>ISAÍAS PEDRO</strong>
          </div>
        </section>


        <a class="item" href="https://wa.me/244950898368" target="_blank" rel="noopener noreferrer">
          WhatsApp · 950 898 368 <span>↗</span>
        </a>
        <a class="item" href="https://whatsapp.com/channel/0029VbD1YXB5PO0woGQqs63c" target="_blank" rel="noopener noreferrer">
          Canal oficial SHAZAM IPTV <span>↗</span>
        </a>`;
    }

    painel.scrollIntoView({behavior:"smooth", block:"nearest"});
  },
  onCanal(canal) {}
};

const $=s=>document.querySelector(s);
const estado={
  cat:"filmes",
  slide:0,
  timer:null,
  todos:[],
  categoriaIPTV:null,
  paginaIPTV:1,
  totalPaginasIPTV:1,
  carregandoIPTV:false
};
const esc=t=>String(t).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const bg=i=>i.poster?`background-image:url('${encodeURI(i.poster)}')`:`--h:${+i.h||0}`;
const card=i=>`<button class="pc" data-id="${esc(i.id)}"><div class="poster" style="${bg(i)}">${i.poster?"":`<b>${esc(i.titulo)}</b>`}<em class="novo">NOVO</em></div><h4>${esc(i.titulo)}</h4><p>${esc(i.ano)} • ${esc(i.dur)}</p><div class="st">★ ${esc(i.nota)}</div></button>`;
const achar=id=>estado.todos.find(i=>i.id===id);

/* navegação */
const VISTAS=[["inicio","Início","home"],["catalogo","Catálogo","grid"],["canais","Canais","tv"],["buscar","Buscar","search"],["conta","Conta","user"]];
$("#nav").innerHTML=VISTAS.map(([id,nome,ico])=>`<button data-v="${id}">${ic(ico)}<span>${nome}</span></button>`).join("");
function mostrar(v){
  if(!VISTAS.some(x=>x[0]===v))v="inicio";
  document.querySelectorAll(".view").forEach(e=>e.classList.toggle("on",e.id==="v-"+v));
  document.querySelectorAll("#nav button").forEach(b=>b.classList.toggle("on",b.dataset.v===v));
  scrollTo(0,0);
  if(location.hash!=="#"+v)history.replaceState(null,"","#"+v);
  if(v==="buscar")setTimeout(()=>$("#q").focus(),50);
}
$("#nav").addEventListener("click",e=>{const b=e.target.closest("button");if(b){mostrar(b.dataset.v);if(b.dataset.v==="canais")mostrarCategoriasIPTV();}});
$("#bBuscar").innerHTML=ic("search");$("#bConta").innerHTML=ic("message");$("#icBusca").innerHTML=ic("search");$("#icAv").innerHTML=ic("user");
$("#bBuscar").onclick=()=>mostrar("buscar");$("#bConta").onclick=()=>abrirMensagens();

/* destaque */
function slideIr(n){
  const s=document.querySelectorAll(".slide"),d=document.querySelectorAll("#dots button");
  if(!s.length)return;estado.slide=(n+s.length)%s.length;
  s.forEach((e,i)=>e.classList.toggle("on",i===estado.slide));d.forEach((e,i)=>e.classList.toggle("on",i===estado.slide));
}
function slideAuto(){
  clearInterval(estado.timer);
  if(matchMedia("(prefers-reduced-motion:reduce)").matches)return;
  estado.timer=setInterval(()=>{if(!$("#hero").contains(document.activeElement))slideIr(estado.slide+1);},6500);
}
function renderHero(l){
  $("#hero").innerHTML=l.map((i,k)=>`<div class="slide${k?"":" on"}" style="${i.backdrop?`background-image:linear-gradient(100deg,#0b0c10 30%,transparent),url('${encodeURI(i.backdrop)}');background-size:cover;background-position:center;`:""}--h:${+i.h||0}">
    <div class="sel">EM DESTAQUE</div><h2>${esc(i.titulo)}</h2><div class="meta">${[i.ano,i.dur,i.nota?"★ "+i.nota:""].filter(Boolean).map(esc).join(" • ")}</div><p>${esc(i.desc||"")}</p>
    <div class="acts"><button class="btn-play" data-act="play" data-id="${esc(i.id)}">${ic("play")} Assistir</button><button class="btn-info" data-act="info" data-id="${esc(i.id)}" aria-label="Detalhes">${ic("info")}</button></div></div>`).join("")+
    `<div class="dots" id="dots">${l.map((_,k)=>`<button data-s="${k}" class="${k?"":"on"}" aria-label="Destaque ${k+1}"></button>`).join("")}</div>`;
  slideAuto();
}
let tx=null;
$("#hero").addEventListener("click",e=>{const d=e.target.closest("[data-s]");if(d){slideIr(+d.dataset.s);slideAuto();}});
$("#hero").addEventListener("pointerdown",e=>{tx=e.clientX;});
$("#hero").addEventListener("pointerup",e=>{if(tx!==null&&Math.abs(e.clientX-tx)>45){slideIr(estado.slide+(e.clientX<tx?1:-1));slideAuto();}tx=null;});

/* listas */
const renderContinuar=l=>{$("#rCont").innerHTML=l.map(i=>`<div class="cc"><button class="cc-play" data-id="${esc(i.id)}" data-act="play"><div class="th" style="${bg(i)}"><span class="pl">${ic("play")}</span><div class="pr"><i style="width:${+i.pct||0}%"></i></div></div>
  <div class="tx"><h4>${esc(i.titulo)}</h4><p>${esc(i.sub)}</p></div></button><button class="inf" data-id="${esc(i.id)}" data-act="info" aria-label="Detalhes">${ic("info")}</button></div>`).join("");};
const renderCategorias=l=>{$("#rCat").innerHTML=l.map(c=>`<button class="ct${c.id===estado.cat?" on":""}" data-cat="${esc(c.id)}">${ic(c.icone)}<span>${esc(c.nome)}</span></button>`).join("");};
function renderLancamentos(){
  const nome=(DB.categorias.find(c=>c.id===estado.cat)||{}).nome||"";
  const l=estado.todos.filter(i=>i.cat===estado.cat&&(i.tipo==="filme"||i.tipo==="serie"||String(i.id).startsWith("tmdb:")));
  $("#tLanc").textContent=estado.cat==="filmes"?"Lançamentos":nome;
  $("#rLanc").innerHTML=l.length?l.map(card).join(""):`<p class="vazio">Ainda não há conteúdo em ${esc(nome)}.</p>`;
}
$("#rCat").addEventListener("click",e=>{
  const b=e.target.closest("[data-cat]");
  if(!b)return;

  if(b.dataset.cat==="canais"){
    mostrar("canais");
    mostrarCategoriasIPTV();
    return;
  }

  if(b.dataset.cat.startsWith("iptv:")){
    const id=b.dataset.cat.slice(5);
    mostrar("canais");
    carregarCanaisCategoria(id,1);
    return;
  }

  estado.cat=b.dataset.cat;
  renderCategorias(DB.categorias);
  renderLancamentos();
  const n=$(`[data-cat="${estado.cat}"]`);
  if(n)n.focus({preventScroll:true});
});
$("#verTudo").onclick=()=>mostrar("catalogo");
function mostrarCategoriasIPTV(){
  estado.categoriaIPTV=null;
  estado.paginaIPTV=1;

  const host=$("#lCanais");
  host.innerHTML=`
    <div class="iptv-top">
      <h2>Categorias IPTV</h2>
      <p>Escolhe uma categoria para ver os canais disponíveis.</p>
    </div>
    <div id="categoriasIPTV" class="iptv-categorias">
      <p class="vazio">A carregar categorias...</p>
    </div>`;

  SHAZAM.api.pedido("/api/iptv/categorias")
    .then(data=>{
      const categorias=data.resultados||[];
      const el=$("#categoriasIPTV");
      if(!el)return;

      el.innerHTML=categorias.length?categorias.map(c=>`
        <button class="iptv-categoria" data-iptv-cat="${esc(c.id)}">
          <span class="iptv-cat-ico">${ic("tv")}</span>
          <span class="iptv-cat-info">
            <b>${esc(c.nome.replace(/^●\\s*/,""))}</b>
            <small>${Number(c.total)||0} canais</small>
          </span>
          <span class="iptv-seta">›</span>
        </button>`).join("")
        :'<p class="vazio">Não existem categorias IPTV.</p>';
    })
    .catch(erro=>{
      console.error("Categorias IPTV:",erro);
      const el=$("#categoriasIPTV");
      if(el)el.innerHTML='<p class="vazio">Não foi possível carregar as categorias.</p>';
    });
}

async function carregarCanaisCategoria(id,pagina=1){
  if(estado.carregandoIPTV)return;
  estado.carregandoIPTV=true;
  estado.categoriaIPTV=id;
  estado.paginaIPTV=pagina;

  const host=$("#lCanais");
  host.innerHTML='<p class="vazio">A carregar canais...</p>';

  try{
    const qs=new URLSearchParams({
      categoria:id,
      pagina:String(pagina),
      limite:"50"
    });
    const data=await SHAZAM.api.pedido("/api/iptv/canais?"+qs.toString());

    if(!data.ok)throw new Error(data.error||"Falha ao carregar canais.");

    estado.totalPaginasIPTV=data.totalPaginas||1;
    const canais=data.resultados||[];
    const categoria=(DB.categorias||[]).find(c=>String(c.id)===("iptv:"+id));

    host.innerHTML=`
      <div class="iptv-lista-top">
        <button class="iptv-voltar" id="voltarCategorias">← Categorias</button>
        <div>
          <h2>${esc(categoria?categoria.nome.replace(/^●\\s*/,""):id.replace(/-/g," "))}</h2>
          <p>${Number(data.total)||0} canais · Página ${data.pagina} de ${data.totalPaginas||1}</p>
        </div>
      </div>
      <div class="iptv-lista">
        ${canais.map(c=>`
          <button class="canal"
            data-canal="${esc(c.id)}"
            data-nome="${esc(c.nome)}"
            data-url="${esc(c.url || "")}"
            data-tipo="${esc(c.tipo || "hls")}"
            data-categoria="${esc(c.categoria || "")}"
            data-tvg-id="${esc(c.tvgId || "")}">
            <div class="lg">
              ${c.logo
                ? `<img src="${esc(c.logo)}" alt="" loading="lazy" onerror="this.remove();this.parentElement.textContent='TV'">`
                : `<span>${esc(c.nome.slice(0,3).toUpperCase())}</span>`}
            </div>
            <div class="canal-info">
              <h4>${esc(c.nome)}</h4>
              <p>${esc(c.tvgId||"IPTV")}</p>
            </div>
            <span class="live">AO VIVO</span>
          </button>`).join("")}
      </div>
      <div class="iptv-paginacao">
        <button id="iptvAnterior" ${pagina<=1?"disabled":""}>← Anterior</button>
        <span>${pagina} / ${data.totalPaginas||1}</span>
        <button id="iptvSeguinte" ${pagina>=(data.totalPaginas||1)?"disabled":""}>Seguinte →</button>
      </div>`;

  }catch(erro){
    console.error("Canais IPTV:",erro);
    host.innerHTML=`
      <button class="iptv-voltar" id="voltarCategorias">← Categorias</button>
      <p class="vazio">Não foi possível carregar os canais desta categoria.</p>`;
  }finally{
    estado.carregandoIPTV=false;
  }
}

const renderCanais=l=>{
  mostrarCategoriasIPTV();
};

$("#lCanais").addEventListener("click",e=>{
  const voltar=e.target.closest("#voltarCategorias");
  if(voltar){mostrarCategoriasIPTV();return;}

  const categoria=e.target.closest("[data-iptv-cat]");
  if(categoria){carregarCanaisCategoria(categoria.dataset.iptvCat,1);return;}

  const anterior=e.target.closest("#iptvAnterior");
  if(anterior&&!anterior.disabled){
    carregarCanaisCategoria(estado.categoriaIPTV,estado.paginaIPTV-1);
    return;
  }

  const seguinte=e.target.closest("#iptvSeguinte");
  if(seguinte&&!seguinte.disabled){
    carregarCanaisCategoria(estado.categoriaIPTV,estado.paginaIPTV+1);
    return;
  }

  const b=e.target.closest("[data-canal]");
  if(!b)return;

  const id=b.dataset.canal;
  const c={
    id:"canal:"+id,
    canalId:id,
    titulo:b.dataset.nome || "Canal IPTV",
    nome:b.dataset.nome || "Canal IPTV",
    url:b.dataset.url || "",
    tipo:b.dataset.tipo || "hls",
    categoria:b.dataset.categoria || "",
    tvgId:b.dataset.tvgId || "",
    cat:"canais",
    src:b.dataset.url || ""
  };

  if(!c.url){
    alert("Este canal não tem um endereço de transmissão disponível.");
    return;
  }

  SHAZAM.onCanal(c);
  origem=document.activeElement;
  abrirPlayer(c);
});
let temporizadorPesquisa;
$("#q").addEventListener("input", e => {
  const consulta = e.target.value.trim();
  clearTimeout(temporizadorPesquisa);

  if (consulta.length < 2) {
    $("#gBusca").innerHTML = '<p class="vazio">Escreve pelo menos 2 caracteres para pesquisar filmes e séries.</p>';
    return;
  }

  $("#gBusca").innerHTML = '<p class="vazio">A pesquisar...</p>';

  temporizadorPesquisa = setTimeout(async () => {
    try {
      const [conteudos, canais] = await Promise.all([
        SHAZAM.api.pesquisar(consulta),
        SHAZAM.api.pedido("/api/iptv/canais?pagina=1&limite=30&q=" + encodeURIComponent(consulta))
      ]);

      const resultadosCanais = (canais.resultados || []).map(c => ({
        id: "canal:" + c.id,
        canalId: c.id,
        titulo: c.nome,
        desc: "Canal de televisão",
        ano: "Ao vivo",
        dur: c.categoria || "IPTV",
        nota: "",
        poster: c.logo || "",
        h: 210,
        cat: "canais",
        nome: c.nome,
        url: c.url || "",
        tipo: c.tipo || "hls"
      }));

      const resultados = [...conteudos, ...resultadosCanais];
      estado.todos = [...estado.todos.filter(i => !resultados.some(r => r.id === i.id)), ...resultados];

      $("#gBusca").innerHTML = resultados.length
        ? resultados.map(card).join("")
        : '<p class="vazio">Não foram encontrados resultados.</p>';
    } catch (erro) {
      $("#gBusca").innerHTML = '<p class="vazio">Não foi possível pesquisar. Tenta novamente.</p>';
      console.error("Pesquisa SHAZAM:", erro);
    }
  }, 350);
});

/* ficha e player */
let origem=null;
let hlsInstancia=null;
let epgPedido=0;

function destruirHLS(){
  if(hlsInstancia){
    try{hlsInstancia.destroy();}catch{}
    hlsInstancia=null;
  }
}

function limparEPG(){
  const atual=$("#epgAtual"),proximo=$("#epgProximo");
  if(atual)atual.textContent="";
  if(proximo)proximo.textContent="";
}

function horaEPG(valor){
  if(!valor)return "";
  const data=new Date(valor);
  if(Number.isNaN(data.getTime()))return "";
  return new Intl.DateTimeFormat("pt-PT",{
    hour:"2-digit",minute:"2-digit"
  }).format(data);
}

async function carregarEPGCanal(c){
  const atual=$("#epgAtual"),proximo=$("#epgProximo");
  const pedido=++epgPedido;
  if(!atual||!proximo)return;

  atual.textContent="A carregar programação…";
  proximo.textContent="";

  if(!c.tvgId){
    atual.textContent="Programação indisponível para este canal.";
    return;
  }

  try{
    const dados=await SHAZAM.api.pedido(
      "/api/epg/"+encodeURIComponent(c.tvgId)
    );
    if(pedido!==epgPedido||!$("#player").classList.contains("on"))return;

    const p=dados.current;
    const n=dados.next;

    atual.textContent=p
      ? "AGORA · "+horaEPG(p.start)+"–"+horaEPG(p.stop)+" · "+(p.title||"Programa sem título")
      : "Não há programa atual disponível.";

    proximo.textContent=n
      ? "A SEGUIR · "+horaEPG(n.start)+" · "+(n.title||"Programa sem título")
      : "Não há programa seguinte disponível.";

    if(p&&p.description){
      atual.title=p.description;
    }else{
      atual.removeAttribute("title");
    }
  }catch(erro){
    if(pedido!==epgPedido)return;
    atual.textContent="Não foi possível carregar a programação.";
    proximo.textContent="";
    console.warn("EPG:",erro.message);
  }
}


/* SHAZAM_TEMPORADAS_ANIMACAO_V1 */
let shazamSerieTemporadas = null;
let shazamItemSelecionado = null;

function shazamCaixaTemporadas() {
  let caixa = document.getElementById("shzTemporadas");
  if (!caixa) {
    caixa = document.createElement("div");
    caixa.id = "shzTemporadas";
    caixa.className = "shz-temporadas";
    const descricao = document.getElementById("sDesc");
    if (descricao) descricao.insertAdjacentElement("afterend", caixa);
  }
  return caixa;
}

function shazamMostrarCaixa(titulo, conteudo) {
  const caixa = shazamCaixaTemporadas();
  caixa.hidden = false;
  caixa.innerHTML = "";
  const cabecalho = document.createElement("h3");
  cabecalho.textContent = titulo;
  caixa.appendChild(cabecalho);
  caixa.appendChild(conteudo);
  caixa.scrollIntoView({behavior:"smooth", block:"nearest"});
}

function shazamListaBotoes(itens, texto, aoClicar) {
  const lista = document.createElement("div");
  lista.className = "shz-lista-temporadas";

  if (!itens.length) {
    const vazio = document.createElement("p");
    vazio.textContent = "Não existem resultados disponíveis.";
    lista.appendChild(vazio);
    return lista;
  }

  for (const item of itens) {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "shz-item-temporada";
    botao.textContent = texto(item);
    botao.addEventListener("click", () => aoClicar(item));
    lista.appendChild(botao);
  }
  return lista;
}

async function shazamCarregarTemporadas(serie) {
  const id = Number(serie.tmdbId);
  if (!Number.isInteger(id) || id <= 0) return;

  shazamSerieTemporadas = serie;
  shazamItemSelecionado = null;
  const botaoPrincipal = document.getElementById("sPlay");
  botaoPrincipal.hidden = true;

  const caixa = shazamCaixaTemporadas();
  caixa.hidden = false;
  caixa.innerHTML = "<p>A carregar temporadas…</p>";

  try {
    const resposta = await fetch(
      "/api/catalogo/detalhes/serie/" + id + "/temporadas"
    );
    const dados = await resposta.json();
    if (!resposta.ok || !dados.ok) throw new Error("Falha ao carregar temporadas.");

    const temporadas = Array.isArray(dados.resultados) ? dados.resultados : [];
    const lista = shazamListaBotoes(
      temporadas,
      t => (t.titulo || ("Temporada " + t.numero)) +
        " · " + (t.episodios || 0) + " episódios",
      t => shazamCarregarEpisodios(serie, t)
    );
    shazamMostrarCaixa("Escolhe uma temporada", lista);
  } catch (erro) {
    caixa.innerHTML = "";
    const aviso = document.createElement("p");
    aviso.textContent = "Não foi possível carregar as temporadas. Tenta novamente.";
    caixa.appendChild(aviso);
    console.warn("SHAZAM temporadas:", erro.message);
  }
}

async function shazamCarregarEpisodios(serie, temporada) {
  const id = Number(serie.tmdbId);
  const numero = Number(temporada.numero);
  const caixa = shazamCaixaTemporadas();
  document.getElementById("sPlay").hidden = true;
  caixa.hidden = false;
  caixa.innerHTML = "<p>A carregar episódios…</p>";

  try {
    const resposta = await fetch(
      "/api/catalogo/detalhes/serie/" + id +
      "/temporada/" + numero
    );
    const dados = await resposta.json();
    if (!resposta.ok || !dados.ok) throw new Error("Falha ao carregar episódios.");

    const episodios = Array.isArray(dados.resultados) ? dados.resultados : [];
    const conteudo = document.createElement("div");
    const voltar = document.createElement("button");
    voltar.type = "button";
    voltar.className = "shz-voltar-temporadas";
    voltar.textContent = "← Voltar às temporadas";
    voltar.addEventListener("click", () => shazamCarregarTemporadas(serie));
    conteudo.appendChild(voltar);

    conteudo.appendChild(shazamListaBotoes(
      episodios,
      ep => "E" + ep.numero + " · " + (ep.titulo || "Episódio sem título"),
      ep => shazamMostrarDetalheEpisodio(serie, temporada, ep)
    ));
    shazamMostrarCaixa(temporada.titulo || ("Temporada " + numero), conteudo);
  } catch (erro) {
    caixa.innerHTML = "";
    const aviso = document.createElement("p");
    aviso.textContent = "Não foi possível carregar os episódios. Tenta novamente.";
    caixa.appendChild(aviso);
    console.warn("SHAZAM episódios:", erro.message);
  }
}

function shazamMostrarDetalheEpisodio(serie, temporada, ep) {
  const item = {
    ...serie,
    serieTmdbId: serie.tmdbId,
    id: "tmdb:episodio:" + ep.id,
    tmdbId: ep.id,
    titulo: ep.titulo || "Episódio sem título",
    desc: ep.sinopse || "Sem descrição disponível.",
    poster: ep.poster || temporada.poster || serie.poster || "",
    ano: ep.dataLancamento ? ep.dataLancamento.slice(0, 4) : "",
    dur: ep.duracao ? ep.duracao + " min" : "",
    nota: ep.classificacao || "",
    tipoOriginal: "episodio",
    episodio: ep.numero,
    temporada: ep.temporada,
    src: ""
  };

  shazamItemSelecionado = item;
  document.getElementById("sPlay").hidden = false;
  document.getElementById("sTitulo").textContent = item.titulo;
  document.getElementById("sMeta").textContent = [
    "Temporada " + ep.temporada,
    "Episódio " + ep.numero,
    item.dur,
    item.nota ? "★ " + item.nota : "",
    item.ano
  ].filter(Boolean).join(" • ");
  document.getElementById("sDesc").textContent = item.desc;
  document.getElementById("sPoster").style.cssText = bg(item);
  document.getElementById("sPosterT").textContent = item.poster ? "" : item.titulo;

  const caixa = shazamCaixaTemporadas();
  caixa.hidden = false;
  caixa.innerHTML = "";
  const voltar = document.createElement("button");
  voltar.type = "button";
  voltar.className = "shz-voltar-temporadas";
  voltar.textContent = "← Voltar aos episódios";
  voltar.addEventListener("click", () => {
    shazamItemSelecionado = null;
    document.getElementById("sPlay").hidden = true;
    document.getElementById("sTitulo").textContent = serie.titulo;
    document.getElementById("sDesc").textContent = serie.desc || "Sem descrição disponível.";
    document.getElementById("sMeta").textContent = [serie.ano, serie.dur, serie.nota ? "★ " + serie.nota : ""].filter(Boolean).join(" • ");
    document.getElementById("sPoster").style.cssText = bg(serie);
    document.getElementById("sPosterT").textContent = serie.poster ? "" : serie.titulo;
    document.getElementById("sPlay").innerHTML = ic("play") + " Escolher temporada";
    shazamCarregarEpisodios(serie, temporada);
  });
  caixa.appendChild(voltar);
  document.getElementById("sPlay").innerHTML = ic("play") + " Assistir episódio";
}

function abrirDetalhe(i){
  origem=document.activeElement;
  shazamItemSelecionado = null;
  shazamSerieTemporadas = null;
  $("#sPlay").hidden = false;
  $("#sTitulo").textContent=i.titulo;
  $("#sMeta").textContent=[i.ano,i.dur,i.nota?"★ "+i.nota:""].filter(Boolean).join(" • ");
  $("#sDesc").textContent=i.desc||"Sem descrição disponível.";
  const caixaTemporadas = shazamCaixaTemporadas();
  caixaTemporadas.hidden = true;
  caixaTemporadas.innerHTML = "";
  $("#sPoster").style.cssText=bg(i);$("#sPosterT").textContent=i.poster?"":i.titulo;
  $("#sPlay").innerHTML=ic("play")+" Assistir";
  let favBotao = document.getElementById("shzFavoritoDetalhe");
  if (!favBotao) {
    favBotao = document.createElement("button");
    favBotao.id = "shzFavoritoDetalhe";
    favBotao.type = "button";
    favBotao.className = "btn-info";
    $("#sPlay").parentElement.insertBefore(favBotao, $("#sPlay"));
  }

  const atualizarFav = () => {
    let favoritos = [];
    try {
      const dados = JSON.parse(localStorage.getItem("shazam_favoritos") || "[]");
      favoritos = Array.isArray(dados) ? dados : [];
    } catch {}
    const guardado = favoritos.some(x => x && x.id === i.id);
    favBotao.textContent = guardado ? "♥" : "♡";
    favBotao.title = guardado ? "Remover dos favoritos" : "Adicionar aos favoritos";
    favBotao.setAttribute("aria-label", favBotao.title);
  };

  atualizarFav();
  favBotao.onclick = () => {
    try {
      let favoritos = JSON.parse(localStorage.getItem("shazam_favoritos") || "[]");
      if (!Array.isArray(favoritos)) favoritos = [];
      favoritos = favoritos.some(x => x && x.id === i.id)
        ? favoritos.filter(x => x && x.id !== i.id)
        : [{...i}, ...favoritos.filter(x => x && x.id !== i.id)].slice(0, 200);
      localStorage.setItem("shazam_favoritos", JSON.stringify(favoritos));
      atualizarFav();
    } catch (e) {
      console.warn("Erro ao guardar favorito:", e.message);
    }
  };$("#sPlay").onclick=()=>{
    if(shazamItemSelecionado && shazamItemSelecionado.tipoOriginal==="episodio"){
      const episodio=shazamItemSelecionado;
      shazamItemSelecionado=null;
      fechar("#sheetOv",true);
      abrirPlayer(episodio);
      return;
    }

    const ehSerie = i.tipo==="serie" || i.tipoOriginal==="serie";
    const idValido = /^\d+$/.test(String(i.tmdbId||""));

    if(ehSerie && idValido){
      $("#sPlay").innerHTML=ic("play")+" Escolher temporada";
      shazamCarregarTemporadas(i);
      return;
    }

    fechar("#sheetOv",true);
    abrirPlayer(i);
  };
  $("#sheetOv").classList.add("on");$("#sPlay").focus();
}


/* SHAZAM_SERVERS_OUTSIDE_PLAYER_V1 */
let shazamItemPendente = null;

function mostrarSelecaoServidores(item) {
  shazamItemPendente = item;
  const titulo = document.querySelector("#servidoresTitulo");
  const mensagem = document.querySelector("#servidoresMsg");

  if (titulo) titulo.textContent = item.titulo || "Conteúdo";
  if (mensagem) mensagem.textContent = "";
  fechar("#sheetOv");
  fechar("#player");
  fechar("#resultadosServidores");
  document.querySelector("#selecaoServidores").classList.add("on");
}

async function abrirPlayer(i) {
  if (typeof SHAZAM !== "undefined") SHAZAM.onPlay(i);
  destruirHLS();

  const v = $("#vid");
  const m = $("#pMsg");
  v.pause();
  v.removeAttribute("src");
  v.load();
  limparEPG();

  if (i && i.canalId) {
    $("#player").classList.add("iptv-player");
    $("#player").classList.add("on");
    $("#pFechar").focus();

    const epg = $("#epgInfo");
    if (epg) epg.hidden = false;
    carregarEPGCanal(i);

    try {
      const src = await SHAZAM.api.fonte(i);
      if (!$("#player").classList.contains("on")) return;
      if (!src) {
        m.textContent = "Este canal não tem um endereço de reprodução disponível.";
        return;
      }
      reproduzirFonte(src);
    } catch (erro) {
      m.textContent = "Não foi possível carregar este canal.";
      console.error("Fonte IPTV:", erro);
    }
    return;
  }

  ++epgPedido;
  const epg = $("#epgInfo");
  if (epg) epg.hidden = true;
  shazamItemPendente = i;
  await iniciarServidor1();
}

/* SHAZAM_PLAYMOZ_DIRECT_V2 */
async function iniciarServidor1() {
  const item = shazamItemPendente;
  if (!item) return;

  const msg = $("#pMsg");
  const frame = $("#playmozFrame");
  const player = $("#player");
  const video = $("#vid");
  const epg = $("#epgInfo");

  try {
    let url = "";

    if (item.tipoOriginal === "episodio") {
      const serieId = Number(item.serieTmdbId);
      const temporada = Number(item.temporada);
      const episodio = Number(item.episodio);

      if (
        !Number.isSafeInteger(serieId) || serieId <= 0 ||
        !Number.isSafeInteger(temporada) || temporada <= 0 ||
        !Number.isSafeInteger(episodio) || episodio <= 0
      ) {
        throw new Error("Não foi possível identificar este episódio.");
      }

      url = `https://embed.playmoz.xyz/tv/${serieId}/${temporada}/${episodio}`;
    } else if (item.tipo === "filme") {
      const filmeId = Number(item.tmdbId);

      if (!Number.isSafeInteger(filmeId) || filmeId <= 0) {
        throw new Error("Não foi possível identificar este filme.");
      }

      url = `https://embed.playmoz.xyz/movie/${filmeId}`;
    } else if (item.tipo === "serie") {
      throw new Error("Escolhe primeiro uma temporada e um episódio.");
    } else {
      throw new Error("Este tipo de conteúdo não é suportado pelo PlayMoz.");
    }

    if (!frame || !player || !video) {
      throw new Error("O leitor PlayMoz não está disponível.");
    }

    destruirHLS();
    video.pause();
    video.removeAttribute("src");
    video.load();
    limparEPG();
    ++epgPedido;

    if (epg) epg.hidden = true;

    player.classList.add("on", "playmoz-active");
    frame.hidden = false;
    frame.src = url;

    if (msg) msg.textContent = "";
    $("#pFechar").focus();
  } catch (erro) {
    if (msg) msg.textContent = erro.message || "Não foi possível abrir o PlayMoz.";
    console.error("PlayMoz:", erro);
  }
}

async function pesquisarServidor2() {
  const item = shazamItemPendente;
  if (!item) return;

  const botao = $("#servidor2");
  const msg = $("#resultadosMsg");
  const lista = $("#youtubeResultados");

  botao.disabled = true;
  lista.replaceChildren();
  msg.textContent = "A pesquisar…";
  $("#resultadosTitulo").textContent = item.titulo || "Resultados";
  fechar("#selecaoServidores");
  $("#resultadosServidores").classList.add("on");

  try {
    const q = encodeURIComponent(item.titulo || "");
    const resposta = await fetch(
      "/api/shazam/youtube?q=" + q,
      { credentials: "include" }
    );
    const dados = await resposta.json().catch(() => ({}));

    if (!resposta.ok) {
      throw new Error(dados.error || "Erro na pesquisa: HTTP " + resposta.status);
    }

    const resultados = Array.isArray(dados.resultados)
      ? dados.resultados.slice(0, 10)
      : [];

    if (!resultados.length) {
      throw new Error("Não foram encontrados resultados para este título.");
    }

    msg.textContent = "Seleciona um vídeo para assistir:";

    resultados.forEach((video, indice) => {
      if (!video || !video.id) return;

      const cartao = document.createElement("article");
      cartao.className = "youtube-cartao";

      const nome = document.createElement("strong");
      nome.textContent = video.titulo || "Vídeo sem título";

      const detalhes = document.createElement("p");
      detalhes.textContent = [
        video.duracao || "",
        video.autor || ""
      ].filter(Boolean).join(" · ");

      const assistir = document.createElement("button");
      assistir.type = "button";
      assistir.className = "youtube-assistir";
      assistir.textContent = "▶ ASSISTIR";

      assistir.addEventListener("click", async () => {
        assistir.disabled = true;
        msg.textContent = "A preparar o vídeo…";

        try {
          const url = "/api/shazam/youtube/video?id=" +
            encodeURIComponent(video.id);
          const respostaVideo = await fetch(url, {
            credentials: "include"
          });
          const dadosVideo = await respostaVideo.json().catch(() => ({}));

          if (!respostaVideo.ok || !dadosVideo.url) {
            throw new Error(
              dadosVideo.error || "Não foi possível obter o vídeo."
            );
          }

          fechar("#resultadosServidores");
          await abrirPlayer({ ...item, src: "" });

          if ($("#player").classList.contains("on")) {
            reproduzirFonte(dadosVideo.url);
          }
        } catch (erro) {
          msg.textContent = erro.message || "Erro ao preparar o vídeo.";
          assistir.disabled = false;
        }
      });

      const numero = document.createElement("span");
      numero.className = "youtube-numero";
      numero.textContent = String(indice + 1).padStart(2, "0");

      cartao.append(numero, nome, detalhes, assistir);
      lista.appendChild(cartao);
    });

    if (!lista.children.length) {
      throw new Error("A pesquisa não devolveu vídeos válidos.");
    }
  } catch (erro) {
    msg.textContent = erro.message || "O servidor está temporariamente indisponível.";
  } finally {
    botao.disabled = false;
  }
}

function reproduzirFonte(src){
  const v=$("#vid"),m=$("#pMsg");
  destruirHLS();
  m.textContent="";

  const ehHLS=/\.m3u8(?:$|[?#])/i.test(src);
  if(ehHLS&&!v.canPlayType("application/vnd.apple.mpegurl")){
    if(window.Hls&&Hls.isSupported()){
      hlsInstancia=new Hls();
      hlsInstancia.on(Hls.Events.ERROR,(_evento,dados)=>{
        if(!dados.fatal)return;
        m.textContent="Não foi possível reproduzir este conteúdo.";
        destruirHLS();
      });
      hlsInstancia.loadSource(src);
      hlsInstancia.attachMedia(v);
      hlsInstancia.on(Hls.Events.MANIFEST_PARSED,()=>{
        v.play().catch(()=>{m.textContent="Carrega em reproduzir para iniciar o vídeo.";});
      });
      return;
    }
    m.textContent="Este navegador não suporta HLS neste dispositivo.";
    return;
  }

  v.src=src;
  v.play().catch(()=>{m.textContent="Carrega em reproduzir para iniciar o vídeo.";});
}

function fechar(s,manter){
  $(s).classList.remove("on");
  if(s==="#player"){
    $("#player").classList.remove("iptv-player");
    ++epgPedido;
    destruirHLS();
    const frame=$("#playmozFrame");
    if(frame){
      frame.src="about:blank";
      frame.hidden=true;
    }
    $("#player").classList.remove("playmoz-active");

    const v=$("#vid");
    v.pause();
    v.removeAttribute("src");
    v.load();
    limparEPG();
    const epg=$("#epgInfo");
    if(epg)epg.hidden=false;
    $("#pMsg").textContent="";
  }
  if(!manter){
    if(origem&&document.contains(origem))origem.focus({preventScroll:true});
    origem=null;
  }
}
$("#sFechar").onclick=()=>fechar("#sheetOv");$("#pFechar").onclick=()=>fechar("#player");
$("#sheetOv").addEventListener("click",e=>{if(e.target.id==="sheetOv")fechar("#sheetOv");});
$("#vid").addEventListener("contextmenu",e=>e.preventDefault());    /* só dificulta o "guardar vídeo" — a proteção real é o link com validade */
document.addEventListener("click",e=>{
  const a=e.target.closest("[data-id]");if(!a||e.target.closest("[data-cat],[data-s]"))return;
  const i=achar(a.dataset.id);if(!i)return;
  if(a.dataset.act==="info")return abrirDetalhe(i);
  if(a.dataset.act==="play"){origem=document.activeElement;return abrirPlayer(i);}
  abrirDetalhe(i);
});

/* SHAZAM_LOGIN_FLOW_V1 */
(() => {
  const login = document.getElementById("shzLogin");
  const form = document.getElementById("shzLoginForm");
  const msg = document.getElementById("shzLoginMsg");
  const submit = document.getElementById("shzLoginSubmit");
  const app = document.querySelector(".app");

  if (!login || !form || !msg || !submit || !app) {
    console.error("SHAZAM: elementos do login não encontrados.");
    return;
  }

  let verificando = false;
  let verificacaoAutomaticaEmCurso = false;

  function mostrarLogin(texto = "") {
    login.hidden = false;
    app.hidden = true;
    msg.textContent = texto;
    document.getElementById("shzUsername").focus();
  }

  function mostrarApp() {
    login.hidden = true;
    app.hidden = false;
  }

  async function verificarSessao() {
    const token = localStorage.getItem("shazam_token");

    if (!token) {
      mostrarLogin();
      return false;
    }

    try {
      const resposta = await fetch("/api/me", {
        headers: { Authorization: "Bearer " + token },
        credentials: "same-origin"
      });

      const dados = await resposta.json().catch(() => ({}));

      if (!resposta.ok || !dados.ok || !dados.user) {
        if (resposta.status === 401 || resposta.status === 403) {
          localStorage.removeItem("shazam_token");
        }

        mostrarLogin(
          dados.error || "Inicia sessão para continuar."
        );
        return false;
      }

      mostrarApp();

      const nome = dados.user.username || "Utilizador";
      const nomeEl = document.getElementById("nomeUser");
      const planoEl = document.getElementById("planoUser");
      const avatar = document.getElementById("icAv");

      if (nomeEl) nomeEl.textContent = nome;
      if (planoEl) {
        planoEl.textContent = dados.user.status || "Conta autenticada";
      }
      if (avatar) avatar.textContent = nome.slice(0, 1).toUpperCase();

      return true;
    } catch (erro) {
      // Uma falha temporária de internet não termina uma sessão já aberta.
      if (app.hidden) {
        mostrarLogin("Não foi possível contactar o servidor. Tenta novamente.");
      }
      return false;
    }
  }

  // Confirma periodicamente se a conta continua válida no servidor.
  setInterval(async () => {
    if (!localStorage.getItem("shazam_token")) return;
    if (verificando || verificacaoAutomaticaEmCurso) return;

    verificacaoAutomaticaEmCurso = true;
    try {
      await verificarSessao();
    } finally {
      verificacaoAutomaticaEmCurso = false;
    }
  }, 30000);

  form.addEventListener("submit", async event => {
    event.preventDefault();

    if (verificando) return;
    verificando = true;
    submit.disabled = true;
    msg.textContent = "A verificar os dados…";

    const username = document.getElementById("shzUsername").value.trim();
    const password = document.getElementById("shzPassword").value;

    try {
      const resposta = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, password })
      });

      const dados = await resposta.json().catch(() => ({}));

      if (!resposta.ok || !dados.ok || !dados.token) {
        throw new Error(dados.error || "Não foi possível iniciar sessão.");
      }

      localStorage.setItem("shazam_token", dados.token);
      document.getElementById("shzPassword").value = "";

      const valido = await verificarSessao();

      if (valido) {
        msg.textContent = "";
        if (typeof SHAZAM !== "undefined" &&
            typeof SHAZAM.onConta === "function") {
          // A interface continua a usar os seus próprios eventos.
        }
      }
    } catch (erro) {
      localStorage.removeItem("shazam_token");
      mostrarLogin(erro.message || "Erro ao iniciar sessão.");
    } finally {
      verificando = false;
      submit.disabled = false;
    }
  });

  document.addEventListener("click", async event => {
    const botao = event.target.closest('[data-conta="sair"]');
    if (!botao) return;

    event.preventDefault();

    const token = localStorage.getItem("shazam_token");

    try {
      if (token) {
        await fetch("/api/logout", {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
          credentials: "same-origin"
        });
      }
    } catch (_) {
      // O token será removido localmente mesmo se o servidor falhar.
    }

    localStorage.removeItem("shazam_token");
    mostrarLogin("Sessão terminada.");
  });

  window.addEventListener("shazam:sessao-expirada", () => {
    localStorage.removeItem("shazam_token");
    mostrarLogin("A sessão expirou. Inicia sessão novamente.");
  });

  verificarSessao();
})();
document.querySelectorAll("[data-conta]").forEach(b=>b.onclick=()=>SHAZAM.onConta(b.dataset.conta));
document.getElementById("shzContaFechar")?.addEventListener("click", () => {
  document.getElementById("shzContaPainel").hidden = true;
});

document.getElementById("shzContaConteudo")?.addEventListener("click", event => {
  const remover = event.target.closest("[data-fav-remover]");
  if (remover) {
    try {
      let lista = JSON.parse(localStorage.getItem("shazam_favoritos") || "[]");
      if (!Array.isArray(lista)) lista = [];
      localStorage.setItem("shazam_favoritos", JSON.stringify(
        lista.filter(x => x && x.id !== remover.dataset.favRemover)
      ));
      SHAZAM.onConta("lista");
    } catch (e) {
      console.warn("Erro ao remover favorito:", e.message);
    }
    return;
  }

  if (event.target.closest("[data-conta-limpar-historico]")) {
    localStorage.removeItem("shazam_historico");
    SHAZAM.onConta("historico");
    return;
  }

  const botao = event.target.closest("[data-conta-reproduzir]");
  if (botao) {
    const item = (estado.todos || []).find(x => String(x.id) === botao.dataset.contaReproduzir);
    if (item) {
      document.getElementById("shzContaPainel").hidden = true;
      abrirPlayer(item);
    } else {
      document.getElementById("shzContaDescricao").textContent =
        "Este conteúdo não está no catálogo carregado. Procura-o novamente.";
    }
  }
});

/* teclado e comando de TV: setas, OK e voltar */
const DIR={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
function mover(dx,dy){
  const raiz=document.querySelector(".ov.on")||document;
  const lista=[...raiz.querySelectorAll("button,input")].filter(e=>e.offsetParent!==null&&!e.disabled);
  const a=document.activeElement;
  if(!lista.includes(a)){const p=lista.find(e=>e.closest(".app,#nav,.ov"));if(p)p.focus();return;}
  const r=a.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
  let melhor=null,min=1e12;
  for(const e of lista){
    if(e===a)continue;
    const b=e.getBoundingClientRect(),x=b.left+b.width/2-cx,y=b.top+b.height/2-cy;
    const ao=dx?x*dx:y*dy,lado=dx?Math.abs(y):Math.abs(x);
    if(ao<4)continue;
    const p=ao+lado*2.6;if(p<min){min=p;melhor=e;}
  }
  if(melhor){melhor.focus({preventScroll:true});melhor.scrollIntoView({block:"nearest",inline:"center",behavior:"smooth"});}
}
addEventListener("keydown",e=>{
  const campo=document.activeElement&&document.activeElement.tagName==="INPUT";
  if(DIR[e.key]){
    const [dx,dy]=DIR[e.key];
    if((campo&&dx)||(document.activeElement===$("#vid")&&dx))return;
    e.preventDefault();mover(dx,dy);return;
  }
  const voltar=e.key==="Escape"||e.key==="GoBack"||e.keyCode===10009||e.keyCode===461||(e.key==="Backspace"&&!campo);
  if(!voltar)return;
  if($("#player").classList.contains("on")){e.preventDefault();fechar("#player");}
  else if($("#sheetOv").classList.contains("on")){e.preventDefault();fechar("#sheetOv");}
  else if(!$("#v-inicio").classList.contains("on")){e.preventDefault();mostrar("inicio");}
});

/* arranque */
(async()=>{
  try {
    const [d,c,cat,l,k,u]=await Promise.all([
      SHAZAM.api.destaques(),
      SHAZAM.api.continuar(),
      SHAZAM.api.categorias(),
      SHAZAM.api.lancamentos(),
      SHAZAM.api.canais(),
      SHAZAM.api.utilizador()
    ]);

    DB.destaques=d;
    DB.continuar=c;
    DB.categorias=cat;
    DB.lancamentos=l;
    DB.canais=k;
    DB.todos=[...d,...c,...l];
    estado.todos=[...DB.todos,...k];

    renderHero(d);
    renderContinuar(c);
    renderCategorias(cat);
    renderLancamentos();
    renderCanais(k);

    $("#gCat").innerHTML=DB.todos
      .filter(i=>i.cat==="filmes"||i.cat==="series")
      .map(card).join("");

    $("#nomeUser").textContent=u.nome;
    $("#planoUser").textContent=u.plano;

    $("#q").dispatchEvent(new Event("input"));
    mostrar((location.hash||"#inicio").slice(1));
  } catch(erro) {
    console.error("Inicialização SHAZAM:", erro);
    $("#hero").innerHTML='<p class="vazio">Não foi possível carregar o catálogo. Atualiza a página para tentar novamente.</p>';
    $("#rLanc").innerHTML='<p class="vazio">Não foi possível carregar os conteúdos.</p>';
  }
})();
addEventListener("hashchange",()=>mostrar(location.hash.slice(1)));
window.SHAZAM=SHAZAM;
