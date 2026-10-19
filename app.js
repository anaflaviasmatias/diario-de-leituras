(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };

  const MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const STATUS = { lido: 'Lido', lendo: 'Lendo', quero: 'Quero ler', abandonado: 'Abandonei' };
  const NOTAS = ['', 'Não gostei', 'Mais ou menos', 'Bom', 'Muito bom', 'Favorito'];
  const thisYear = new Date().getFullYear();

  /* ---------- Supabase ---------- */
  const cfg = window.DIARIO_CONFIG || {};
  const configured = cfg.supabaseUrl && cfg.supabaseUrl.startsWith('https://') && cfg.supabaseAnonKey && !cfg.supabaseAnonKey.startsWith('COLE_');
  const sb = configured && window.supabase ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

  const state = {
    books: new Map(), loaded: false, user: null, channel: null,
    tab: 'shelf', filter: 'lido', sort: 'order', year: thisYear, openId: null,
  };
  try { const s = JSON.parse(localStorage.getItem('dl-ui') || '{}'); Object.assign(state, pick(s, ['tab','filter','sort','year'])); } catch (e) {}
  function pick(o, ks) { const r = {}; for (const k of ks) if (o[k] != null) r[k] = o[k]; return r; }
  function saveUi() { try { localStorage.setItem('dl-ui', JSON.stringify(pick(state, ['tab','filter','sort','year']))); } catch (e) {} }

  // linha do banco <-> objeto usado na tela
  const COLS = { order: 'ord', coverUrl: 'cover_url' };
  function fromRow(r) {
    return { id: r.id, title: r.title || '', author: r.author || '', status: r.status || 'lido', rating: Number(r.rating) || 0,
      summary: r.summary || '', notes: r.notes || '', quotes: Array.isArray(r.quotes) ? r.quotes : [], started: r.started || '', finished: r.finished || '',
      pages: r.pages, genre: r.genre || '', format: r.format || '', year: r.year, order: r.ord, coverUrl: r.cover_url || '' };
  }
  function toRow(d) { const r = {}; for (const [k, v] of Object.entries(d)) r[COLS[k] || k] = v; return r; }

  /* ---------- helpers ---------- */
  const list = () => [...state.books.values()];
  const yearOf = b => b.status === 'quero' ? null : (Number(b.year) || (b.finished ? Number(b.finished.slice(0,4)) : null) || (b.started ? Number(b.started.slice(0,4)) : null));
  function inFilter(b) {
    if (state.filter === 'quero') return b.status === 'quero';
    if (yearOf(b) !== Number(state.year)) return false;
    if (state.filter === 'todos') return b.status !== 'quero';
    return b.status === state.filter;
  }
  function sorted(arr) {
    const by = state.sort; const coll = new Intl.Collator('pt-BR');
    return arr.sort((a, b) => {
      if (by === 'rating') return (b.rating || 0) - (a.rating || 0) || (a.order || 999) - (b.order || 999);
      if (by === 'title') return coll.compare(a.title || '', b.title || '');
      if (by === 'author') return coll.compare(a.author || '', b.author || '') || (a.order || 999) - (b.order || 999);
      return (a.order || 9999) - (b.order || 9999) || coll.compare(a.title || '', b.title || '');
    });
  }
  function coverEl(b, opts = {}) {
    const c = h('div', { class: 'cover' });
    if (b.coverUrl) {
      const img = h('img', { src: b.coverUrl, alt: 'Capa de ' + (b.title || 'livro'), loading: 'lazy' });
      img.addEventListener('error', () => { img.remove(); c.prepend(placeholder(b)); });
      c.append(img);
    } else c.append(placeholder(b));
    if (opts.num && b.order && b.status !== 'quero') c.append(h('span', { class: 'num', text: b.order }));
    if (opts.state && b.status === 'lendo') c.append(h('span', { class: 'state', text: 'Lendo' }));
    return c;
  }
  function placeholder(b) { return h('div', { class: 'ph' }, b.title || 'Sem título', h('small', { text: b.author || '' })); }
  const fmtNota = r => String(r).replace('.', ',');
  const notaLabel = r => !r ? '' : Number.isInteger(r) ? NOTAS[r] : fmtNota(r) + ' de 5';
  // uma estrela que pode estar cheia, pela metade ou vazia
  const STAR_PATH = 'M12 1.6l3.09 6.97 7.58.73-5.71 5.03 1.67 7.43L12 17.9l-6.63 3.86 1.67-7.43L1.33 9.3l7.58-.73z';
  function starSvg() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', STAR_PATH); path.setAttribute('fill', 'currentColor'); svg.append(path);
    return svg;
  }
  function star(fill) {
    return h('span', { class: 'st', 'aria-hidden': 'true' }, starSvg(), h('span', { class: 'st-fill', style: `width:${fill * 100}%` }, starSvg()));
  }
  function starsRow(r, cls) {
    const w = h('div', { class: cls, 'aria-label': r ? fmtNota(r) + ' de 5 estrelas' : 'sem nota' });
    for (let i = 1; i <= 5; i++) w.append(star(Math.max(0, Math.min(1, r - (i - 1)))));
    return w;
  }
  function miniStars(n) { return starsRow(n || 0, 'mini-stars'); }
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2800); }
  function notice(msg) { const n = $('#notice'); n.textContent = msg || ''; n.hidden = !msg; }

  /* ---------- gravação com fila por livro ---------- */
  const pending = new Map(); const timers = new Map(); const writing = new Set();
  function patch(id, data, delay = 650) {
    const b = state.books.get(id); if (!b) return;
    Object.assign(b, data);
    pending.set(id, Object.assign(pending.get(id) || {}, data));
    setSaved('Salvando…');
    renderShelf(); if (state.tab === 'year') renderYear();
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => flush(id), delay));
  }
  async function flush(id) {
    if (writing.has(id) || !pending.has(id)) return;
    const data = pending.get(id); pending.delete(id); writing.add(id);
    let failed = false;
    try {
      const row = toRow(data); row.updated_at = new Date().toISOString();
      const { error } = await sb.from('books').update(row).eq('id', id);
      if (error) throw error;
      if (!pending.size) setSaved('Salvo');
    } catch (e) {
      failed = true;
      // devolve para a fila e tenta de novo quando a conexão voltar
      pending.set(id, Object.assign(data, pending.get(id) || {}));
      setSaved('Não salvou ainda');
      toast(navigator.onLine === false ? 'Sem internet. Salvo assim que a conexão voltar.' : 'Não foi possível salvar agora. Tentando de novo…');
      clearTimeout(timers.get(id)); timers.set(id, setTimeout(() => flush(id), 5000));
    } finally {
      writing.delete(id);
      if (!failed && pending.has(id)) flush(id);
    }
  }
  function flushAll() { for (const id of [...pending.keys()]) { clearTimeout(timers.get(id)); timers.delete(id); flush(id); } }
  window.addEventListener('online', flushAll);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); else if (state.user) refresh(); });
  window.addEventListener('pagehide', flushAll);
  function setSaved(t) { const s = $('#savedLbl'); if (s) s.textContent = t; }

  /* ---------- estante ---------- */
  function renderChips() {
    const all = list(); const y = Number(state.year);
    const counts = {
      lido: all.filter(b => b.status === 'lido' && yearOf(b) === y).length,
      lendo: all.filter(b => b.status === 'lendo' && yearOf(b) === y).length,
      quero: all.filter(b => b.status === 'quero').length,
      todos: all.filter(b => b.status !== 'quero' && yearOf(b) === y).length,
    };
    const defs = [['lido','Lidos'],['lendo','Lendo'],['quero','Quero ler'],['todos','Tudo de ' + y]];
    const box = $('#chips'); box.replaceChildren();
    for (const [k, label] of defs) {
      box.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.filter === k), onclick: () => { state.filter = k; saveUi(); renderShelf(); } },
        label, h('span', { class: 'n', text: counts[k] })));
    }
    const read = counts.lido;
    $('#subtitle').textContent = state.loaded
      ? (read ? `${read} ${read === 1 ? 'livro lido' : 'livros lidos'} em ${y}` + (counts.lendo ? ` · ${counts.lendo} em andamento` : '') : `Nenhum livro marcado como lido em ${y} ainda.`)
      : 'Carregando sua estante…';
  }
  function renderYears() {
    const ys = new Set([thisYear]);
    for (const b of list()) { const y = yearOf(b); if (y) ys.add(y); }
    const sel = $('#year'); const cur = Number(state.year); ys.add(cur);
    sel.replaceChildren(...[...ys].sort((a, b) => b - a).map(y => h('option', { value: y, text: y, selected: y === cur })));
  }
  function renderShelf() {
    renderChips(); renderYears();
    $('#sort').value = state.sort;
    const shelf = $('#shelf'); const empty = $('#shelfEmpty');
    const items = sorted(list().filter(inFilter));
    shelf.replaceChildren(...items.map(b => h('button', { class: 'book', type: 'button', onclick: () => openBook(b.id), 'aria-label': (b.title || 'Livro') + (b.author ? ', de ' + b.author : '') },
      coverEl(b, { num: state.sort === 'order', state: true }),
      h('div', { class: 't', text: b.title || 'Sem título' }),
      h('div', { class: 'a', text: b.author || '' }),
      b.status === 'quero' ? null : miniStars(b.rating || 0))));
    empty.hidden = items.length > 0 || !state.loaded;
    if (!items.length && state.loaded) {
      if (!state.books.size) {
        empty.replaceChildren(h('div', { class: 'import' },
          h('h3', { text: 'Sua estante está vazia' }),
          h('p', { text: 'Traga os livros que você já tinha cadastrado, com capas e ordem de leitura.' }),
          h('button', { class: 'btn', type: 'button', id: 'importBtn', onclick: importSeed, text: 'Importar meus livros' }),
          h('p', { class: 'saved', text: 'Ou comece do zero com “+ Livro”.' })));
        return;
      }
      const msg = state.filter === 'quero' ? ['Lista de desejos vazia', 'Adicione livros que você quer ler com “+ Livro” e marque como “Quero ler”.']
        : state.filter === 'lendo' ? ['Nenhuma leitura em andamento', 'Quando começar um livro, adicione com “+ Livro” e marque como “Lendo”.']
        : ['Nada por aqui em ' + state.year, 'Toque em “+ Livro” para registrar uma leitura.'];
      empty.replaceChildren(h('h3', { text: msg[0] }), h('p', { text: msg[1] }));
    }
  }

  /* ---------- ano em números ---------- */
  function renderYear() {
    const y = Number(state.year);
    const read = list().filter(b => b.status === 'lido' && yearOf(b) === y);
    const reading = list().filter(b => b.status === 'lendo' && yearOf(b) === y).length;
    const rated = read.filter(b => b.rating);
    const avg = rated.length ? rated.reduce((s, b) => s + b.rating, 0) / rated.length : null;
    const pages = read.reduce((s, b) => s + (Number(b.pages) || 0), 0);
    const withPages = read.filter(b => Number(b.pages)).length;
    const quotes = read.reduce((s, b) => s + ((b.quotes || []).length), 0);
    const fmt = n => n.toLocaleString('pt-BR');
    const v = $('#view-year'); v.replaceChildren();

    const stat = (k, val, hint) => h('div', { class: 'stat' }, h('div', { class: 'k', text: k }), h('div', { class: 'v', text: val }), h('div', { class: 'h', text: hint || '' }));
    v.append(h('div', { class: 'stats' },
      stat('Livros lidos', fmt(read.length), reading ? 'e mais ' + reading + ' em andamento' : ''),
      stat('Nota média', avg ? avg.toFixed(1).replace('.', ',') : '–', rated.length ? `de ${rated.length} ${rated.length === 1 ? 'livro avaliado' : 'livros avaliados'}` : 'dê estrelas aos livros'),
      stat('Páginas', withPages ? fmt(pages) : '–', withPages ? (withPages < read.length ? `em ${withPages} de ${read.length} livros` : 'somando todos') : 'preencha nas fichas'),
      stat('Frases guardadas', fmt(quotes), quotes ? '' : 'anote nas fichas')));

    const perMonth = Array(12).fill(0); let noDate = 0;
    for (const b of read) { if (b.finished && Number(b.finished.slice(0,4)) === y) perMonth[Number(b.finished.slice(5,7)) - 1]++; else noDate++; }
    const max = Math.max(1, ...perMonth);
    const months = h('div', { class: 'months', role: 'img', 'aria-label': 'Livros terminados por mês' },
      perMonth.map((n, i) => h('div', { class: 'mcol' },
        h('div', { class: 'mbar' + (n ? '' : ' zero'), style: `height:${n ? Math.max(8, n / max * 100) : 2}%` }, n ? h('span', { text: n }) : null),
        h('div', { class: 'mlab', text: MESES[i] }))));
    const pMonth = h('div', { class: 'panel' }, h('h3', { text: 'Livros por mês' }), months,
      noDate ? h('div', { class: 'note', text: `${noDate} ${noDate === 1 ? 'livro ainda sem' : 'livros ainda sem'} data de término. Preencha na ficha para aparecer no gráfico.` }) : null);

    const dist = [5,4,3,2,1].map(n => [n, rated.filter(b => Math.floor(b.rating) === n || (n === 1 && b.rating < 1)).length]);
    const dmax = Math.max(1, ...dist.map(d => d[1]));
    const pRate = h('div', { class: 'panel' }, h('h3', { text: 'Notas' }),
      dist.map(([n, c]) => h('div', { class: 'rrow' }, h('span', { text: '★'.repeat(n), style: 'color:var(--star);letter-spacing:-1px;font-size:12px' }),
        h('div', { class: 'rtrack' }, h('div', { class: 'rfill', style: `width:${c / dmax * 100}%` })), h('span', { class: 'c', text: c }))),
      h('div', { class: 'note', text: 'Notas com meia estrela entram na linha de baixo (4,5 conta em 4).' + (rated.length < read.length ? ` ${read.length - rated.length} ${read.length - rated.length === 1 ? 'livro' : 'livros'} sem nota.` : '') }));

    const aut = new Map(); for (const b of read) if (b.author) aut.set(b.author, (aut.get(b.author) || 0) + 1);
    const top = [...aut.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR')).slice(0, 6);
    const pAut = h('div', { class: 'panel' }, h('h3', { text: 'Autores mais lidos' }),
      top.length ? h('ul', { class: 'authors' }, top.map(([a, c]) => h('li', {}, h('span', { text: a }), h('span', { class: 'c', text: c + (c === 1 ? ' livro' : ' livros') })))) : h('p', { class: 'note', text: 'Aparece quando houver livros lidos.' }));

    const favs = sorted(read.filter(b => b.rating === 5));
    const pFav = h('div', { class: 'panel' }, h('h3', { text: 'Favoritos do ano' }),
      favs.length ? h('div', { class: 'favs' }, favs.map(b => h('button', { class: 'book', type: 'button', onclick: () => openBook(b.id), 'aria-label': b.title }, coverEl(b))))
        : h('p', { class: 'note', text: 'Os livros com 5 estrelas aparecem aqui.' }));

    const yearBooks = sorted(list().filter(b => yearOf(b) === y && (b.quotes || []).length));
    const allQ = yearBooks.flatMap(b => b.quotes.map(q => ({ q, b })));
    const pQuote = h('div', { class: 'panel' }, h('h3', { text: 'Frases marcantes' }),
      allQ.length ? h('div', { class: 'qall' }, allQ.map(({ q, b }) => h('figure', { class: 'qitem' },
          h('blockquote', { text: '“' + q.text + '”' }),
          h('figcaption', {}, h('button', { class: 'linkish', type: 'button', onclick: () => openBook(b.id), text: b.title || 'Sem título' }),
            (b.author ? ', ' + b.author : '') + (q.page ? ', p. ' + q.page : '')))))
        : h('p', { class: 'note', text: 'As frases que você guardar nas fichas dos livros aparecem aqui.' }));

    v.append(h('div', { class: 'panels' }, pMonth, pRate));
    v.append(h('div', { class: 'panels', style: 'margin-top:16px' }, pFav, pAut));
    v.append(h('div', { class: 'panels', style: 'margin-top:16px;grid-template-columns:1fr' }, pQuote));
  }

  /* ---------- ficha do livro ---------- */
  const fmtDate = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return d && m ? `${d}/${m}/${y}` : s; };
  function paragraphs(text) {
    return String(text || '').split(/\n\s*\n|\n/).map(t => t.trim()).filter(Boolean).map(t => h('p', { text: t }));
  }
  function showSheet(sheet) {
    const scrim = $('#scrim'); scrim.replaceChildren(sheet); scrim.hidden = false; scrim.scrollTop = 0;
    document.body.style.overflow = 'hidden';
  }

  // ficha em modo leitura: o card do livro
  function viewBook(b) {
    const top = h('div', { class: 'sheet-top' },
      h('button', { class: 'btn small', type: 'button', onclick: () => openBook(b.id, true), text: 'Editar' }),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fechar', onclick: closeBook, text: '×' }));

    const stars = starsRow(b.rating || 0, 'v-stars');
    stars.append(h('span', { class: 'lbl', text: b.rating ? notaLabel(b.rating) : 'Sem nota' }));

    const meta = [];
    if (b.started) meta.push(['Comecei', fmtDate(b.started)]);
    if (b.finished) meta.push(['Terminei', fmtDate(b.finished)]);
    if (b.pages) meta.push(['Páginas', String(b.pages)]);
    if (b.genre) meta.push(['Gênero', b.genre]);
    if (b.format) meta.push(['Como li', b.format]);
    if (b.order && b.status !== 'quero') meta.push(['Nº na ordem', String(b.order)]);

    const section = (label, body) => h('section', { class: 'v-sec' }, h('h3', { class: 'sec-h', text: label }), body);
    const qs = b.quotes || [];
    const hasText = b.summary || b.notes || qs.length;

    const head = h('div', { class: 'v-head' },
      h('div', { class: 'v-cover' }, coverEl(b)),
      h('div', { class: 'v-id' },
        h('span', { class: 'v-status s-' + (b.status || 'lido'), text: STATUS[b.status] || 'Lido' }),
        h('h2', { class: 'v-title', text: b.title || 'Sem título' }),
        b.author ? h('div', { class: 'v-author', text: b.author }) : null,
        b.status === 'quero' ? null : stars));

    const body = h('div', { class: 'v-body' },
      meta.length ? h('dl', { class: 'v-meta' }, meta.map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: v })))) : null,
      b.summary ? section('Resumo da história', h('div', { class: 'v-text' }, paragraphs(b.summary))) : null,
      qs.length ? section('Frases favoritas', h('div', { class: 'quotes' }, qs.map(q => h('blockquote', { class: 'q' },
        h('p', { text: q.text }), q.page ? h('div', { class: 'pg', text: 'p. ' + q.page }) : null)))) : null,
      b.notes ? section('O que eu achei', h('div', { class: 'v-text' }, paragraphs(b.notes))) : null,
      hasText ? null : h('div', { class: 'v-empty' },
        h('p', { text: 'Você ainda não escreveu nada sobre este livro.' }),
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => openBook(b.id, true), text: 'Escrever resumo e impressões' })));

    showSheet(h('div', { class: 'sheet view', role: 'dialog', 'aria-modal': 'true', 'aria-label': b.title || 'Livro' }, top, head, body));
  }

  function openBook(id, edit = false) {
    const b = state.books.get(id); if (!b) return;
    state.openId = id; state.editing = edit;
    if (!edit) { viewBook(b); return; }
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Editando ' + (b.title || 'livro') });

    const top = h('div', { class: 'sheet-top' },
      h('span', { class: 'saved', id: 'savedLbl', text: 'As alterações são salvas sozinhas' }),
      h('button', { class: 'btn small', type: 'button', onclick: () => { flushAll(); openBook(b.id, false); }, text: 'Concluir' }));

    const coverBox = h('div', { id: 'coverBox' }, coverEl(b));
    const file = h('input', { type: 'file', accept: 'image/*', class: 'sr', id: 'coverFile', onchange: e => changeCover(b.id, e.target.files[0]) });
    const side = h('div', { class: 'side' }, coverBox,
      h('div', {}, file, h('button', { class: 'btn ghost small cover-btn', type: 'button', onclick: () => file.click(), text: b.coverUrl ? 'Trocar capa' : 'Adicionar capa' })));

    const title = h('textarea', { class: 'title-in', id: 'f-title', rows: 1, 'aria-label': 'Título', placeholder: 'Título do livro' });
    title.value = b.title || '';
    const fit = () => { title.style.height = 'auto'; title.style.height = title.scrollHeight + 'px'; };
    title.addEventListener('input', () => { fit(); patch(b.id, { title: title.value.trim() }); });
    title.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
    const author = h('input', { class: 'author-in', id: 'f-author', 'aria-label': 'Autor', placeholder: 'Autor' });
    author.value = b.author || '';
    author.addEventListener('input', () => patch(b.id, { author: author.value.trim() }));

    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Status' });
    const drawSeg = () => seg.replaceChildren(...Object.entries(STATUS).map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(b.status === k),
      onclick: () => { const d = { status: k }; if (k !== 'quero' && !b.year) d.year = Number(state.year) || thisYear; if (k === 'lido' && !b.order) d.order = nextOrder(); patch(b.id, d, 0); drawSeg(); }, text: l })));
    drawSeg();

    const rate = h('div', { class: 'rate', role: 'group', 'aria-label': 'Nota' });
    const setRate = v => { patch(b.id, { rating: b.rating === v ? 0 : v }, 0); drawRate(); };
    const drawRate = () => rate.replaceChildren(...[1,2,3,4,5].map(n => h('span', { class: 'rate-star' },
        star(Math.max(0, Math.min(1, (b.rating || 0) - (n - 1)))),
        h('button', { type: 'button', class: 'half l', 'aria-label': fmtNota(n - 0.5) + ' estrelas', onclick: () => setRate(n - 0.5) }),
        h('button', { type: 'button', class: 'half r', 'aria-label': n + (n === 1 ? ' estrela' : ' estrelas'), onclick: () => setRate(n) }))),
      h('span', { class: 'lbl', text: notaLabel(b.rating || 0) || 'Toque na metade da estrela para dar meia' }));
    drawRate();

    const fld = (id, label, type, key, extra = {}) => {
      const inp = h('input', Object.assign({ id, type }, extra)); inp.value = b[key] ?? '';
      inp.addEventListener(type === 'date' ? 'change' : 'input', () => {
        let v = inp.value; if (type === 'number') v = v === '' ? null : Math.round(Number(v));
        const d = { [key]: v };
        if (key === 'finished' && v && b.status !== 'quero') d.year = Number(v.slice(0,4));
        patch(b.id, d, type === 'date' ? 0 : 650);
      });
      return h('div', { class: 'field' }, h('label', { for: id, text: label }), inp);
    };
    const fields = h('div', { class: 'fields' },
      fld('f-start', 'Comecei', 'date', 'started'),
      fld('f-end', 'Terminei', 'date', 'finished'),
      fld('f-pages', 'Páginas', 'number', 'pages', { min: 1, inputmode: 'numeric' }),
      fld('f-order', 'Nº na ordem', 'number', 'order', { min: 1, inputmode: 'numeric' }),
      fld('f-genre', 'Gênero', 'text', 'genre', { placeholder: 'Romance, ensaio…' }),
      fld('f-from', 'Como li', 'text', 'format', { placeholder: 'Físico, Kindle…' }),
      fld('f-year', 'Ano da leitura', 'number', 'year', { min: 1900, max: 2100, inputmode: 'numeric' }));

    const area = (id, label, key, ph) => {
      const t = h('textarea', { class: 'area', id, placeholder: ph }); t.value = b[key] || '';
      t.addEventListener('input', () => patch(b.id, { [key]: t.value }, 900));
      return h('div', { class: 'block' }, h('label', { class: 'sec-h', for: id, text: label }), t);
    };

    const qList = h('div', { class: 'quotes', id: 'qList' });
    const drawQuotes = () => {
      const qs = b.quotes || [];
      qList.replaceChildren(...qs.map((q, i) => h('div', { class: 'q' },
        h('p', { text: q.text }), q.page ? h('div', { class: 'pg', text: 'p. ' + q.page }) : null,
        h('button', { class: 'icon-btn rm', type: 'button', 'aria-label': 'Remover frase', text: '×', onclick: () => { const n = qs.slice(); n.splice(i, 1); patch(b.id, { quotes: n }, 0); drawQuotes(); } }))));
      if (!qs.length) qList.append(h('p', { class: 'saved', text: 'Nenhuma frase guardada ainda.' }));
    };
    drawQuotes();
    const qText = h('textarea', { id: 'q-text', placeholder: 'Copie aqui um trecho que marcou você', 'aria-label': 'Nova frase' });
    const qPage = h('input', { id: 'q-page', type: 'text', inputmode: 'numeric', placeholder: 'Página', 'aria-label': 'Página' });
    const addQ = () => { const t = qText.value.trim(); if (!t) { qText.focus(); return; } patch(b.id, { quotes: [...(b.quotes || []), { text: t, page: qPage.value.trim() }] }, 0); qText.value = ''; qPage.value = ''; drawQuotes(); };
    const qForm = h('div', { class: 'qadd' }, qText, qPage, h('button', { class: 'btn', type: 'button', onclick: addQ, text: 'Guardar frase' }));

    const dz = h('div', { class: 'danger-zone' });
    const drawDz = (confirming) => dz.replaceChildren(...(confirming
      ? [h('span', { text: 'Excluir este livro e tudo o que você escreveu nele?' }),
         h('button', { class: 'btn danger small', type: 'button', text: 'Excluir', onclick: () => removeBook(b.id) }),
         h('button', { class: 'btn ghost small', type: 'button', text: 'Cancelar', onclick: () => drawDz(false) })]
      : [h('button', { class: 'btn ghost small', type: 'button', text: 'Excluir livro', onclick: () => drawDz(true) })]));
    drawDz(false);

    const main = h('div', { class: 'main' },
      h('div', {}, title, author),
      h('div', { class: 'block' }, h('span', { class: 'sec-h', text: 'Status' }), seg),
      h('div', { class: 'block' }, h('span', { class: 'sec-h', text: 'Nota' }), rate),
      fields,
      area('f-summary', 'Resumo da história', 'summary', 'Do que o livro trata, em poucas linhas, para você lembrar daqui a alguns anos.'),
      h('div', { class: 'block' }, h('span', { class: 'sec-h', text: 'Frases favoritas' }), qList, qForm),
      area('f-notes', 'O que eu achei', 'notes', 'Personagens, o que ficou na cabeça, para quem você indicaria…'),
      dz);

    sheet.append(top, h('div', { class: 'sheet-body' }, side, main));
    showSheet(sheet);
    requestAnimationFrame(fit);
    if (!b.title) title.focus();
  }
  function closeBook() {
    flushAll();
    state.openId = null; $('#scrim').hidden = true; $('#scrim').replaceChildren(); document.body.style.overflow = '';
  }
  $('#scrim').addEventListener('click', e => { if (e.target.id === 'scrim') closeBook(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.openId) { if (state.editing) { flushAll(); openBook(state.openId, false); } else closeBook(); } });

  function nextOrder() {
    const y = Number(state.year);
    return Math.max(0, ...list().filter(b => b.status !== 'quero' && yearOf(b) === y).map(b => Number(b.order) || 0)) + 1;
  }

  async function addBook() {
    const status = state.filter === 'quero' ? 'quero' : state.filter === 'lido' ? 'lido' : 'lendo';
    const data = { title: '', author: '', status, rating: 0, summary: '', notes: '', quotes: [], started: '', finished: '', pages: null, genre: '', format: '',
      year: status === 'quero' ? null : Number(state.year), order: status === 'quero' ? null : nextOrder(), coverUrl: '' };
    const { data: rows, error } = await sb.from('books').insert(toRow(data)).select();
    if (error || !rows || !rows[0]) { toast('Não foi possível criar o livro agora.'); return; }
    const b = fromRow(rows[0]); state.books.set(b.id, b);
    renderShelf(); openBook(b.id, true);
  }

  async function removeBook(id) {
    const { error } = await sb.from('books').delete().eq('id', id);
    if (error) { toast('Não foi possível excluir agora.'); return; }
    state.books.delete(id); pending.delete(id); closeBook(); renderShelf(); if (state.tab === 'year') renderYear(); toast('Livro excluído');
  }

  async function changeCover(id, f) {
    if (!f) return;
    setSaved('Enviando capa…');
    try {
      const blob = await toCoverJpeg(f);
      const path = `${state.user.id}/${id}-${Date.now()}.jpg`;
      const { error } = await sb.storage.from('capas').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (error) throw error;
      const { data } = sb.storage.from('capas').getPublicUrl(path);
      patch(id, { coverUrl: data.publicUrl }, 0);
      $('#coverBox').replaceChildren(coverEl(state.books.get(id)));
    } catch (e) { setSaved('Capa não enviada'); toast('Não deu para enviar essa imagem. Tente uma foto JPG ou PNG.'); }
  }
  function toCoverJpeg(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => {
        const W = 600, H = 900, r = W / H; let sw = img.width, sh = img.height, sx = 0, sy = 0;
        if (sw / sh > r) { sw = sh * r; sx = (img.width - sw) / 2; } else { sh = sw / r; sy = (img.height - sh) / 2; }
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
        URL.revokeObjectURL(url);
        c.toBlob(b => b ? res(b) : rej(new Error('blob')), 'image/jpeg', 0.88);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('img')); };
      img.src = url;
    });
  }

  async function importSeed() {
    const btn = $('#importBtn'); if (btn) { btn.disabled = true; btn.textContent = 'Importando…'; }
    try {
      const seed = await (await fetch('seed.json', { cache: 'no-store' })).json();
      const base = new URL('.', location.href).href;
      const rows = seed.map(r => Object.assign({}, r, { cover_url: r.cover_url && !/^https?:/.test(r.cover_url) ? base + r.cover_url : r.cover_url }));
      const { error } = await sb.from('books').insert(rows);
      if (error) throw error;
      await refresh(); toast(rows.length + ' livros importados');
    } catch (e) {
      toast('Não foi possível importar agora.');
      if (btn) { btn.disabled = false; btn.textContent = 'Importar meus livros'; }
    }
  }

  /* ---------- carregar e sincronizar ---------- */
  async function refresh() {
    const { data, error } = await sb.from('books').select('*').order('ord', { ascending: true, nullsFirst: false });
    if (error) { notice('Não consegui carregar sua estante. Confira a internet e abra o app de novo.'); state.loaded = true; renderShelf(); return; }
    notice('');
    const next = new Map();
    for (const r of data) {
      const obj = state.books.get(r.id) || {};
      // mantém na tela o que ainda está sendo salvo
      next.set(r.id, Object.assign(obj, fromRow(r), pending.get(r.id) || {}));
    }
    state.books = next; state.loaded = true;
    renderShelf(); if (state.tab === 'year') renderYear();
    if (state.openId && !next.has(state.openId)) closeBook();
  }
  function subscribe() {
    if (state.channel) sb.removeChannel(state.channel);
    state.channel = sb.channel('books-' + state.user.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'books', filter: 'user_id=eq.' + state.user.id }, payload => {
        if (payload.eventType === 'DELETE') { state.books.delete(payload.old.id); }
        else {
          const r = payload.new; if (pending.has(r.id) || writing.has(r.id)) return;
          const obj = state.books.get(r.id) || {}; state.books.set(r.id, Object.assign(obj, fromRow(r)));
          if (state.openId === r.id) { if (!state.editing) viewBook(state.books.get(r.id)); return; } // não mexe na ficha em edição
        }
        renderShelf(); if (state.tab === 'year') renderYear();
      })
      .subscribe();
  }

  /* ---------- abas e controles ---------- */
  function setTab(t) {
    state.tab = t; saveUi();
    $('#tab-shelf').setAttribute('aria-selected', String(t === 'shelf'));
    $('#tab-year').setAttribute('aria-selected', String(t === 'year'));
    $('#view-shelf').hidden = t !== 'shelf'; $('#view-year').hidden = t !== 'year';
    if (t === 'year') renderYear();
  }
  $('#tab-shelf').addEventListener('click', () => setTab('shelf'));
  $('#tab-year').addEventListener('click', () => setTab('year'));
  $('#sort').addEventListener('change', e => { state.sort = e.target.value; saveUi(); renderShelf(); });
  $('#year').addEventListener('change', e => { state.year = Number(e.target.value); saveUi(); renderShelf(); if (state.tab === 'year') renderYear(); });
  $('#addBtn').addEventListener('click', addBook);
  $('#logout').addEventListener('click', async () => { flushAll(); await sb.auth.signOut(); });

  /* ---------- entrada ---------- */
  let mode = 'login';
  const ERR = {
    'Invalid login credentials': 'E-mail ou senha incorretos.',
    'Email not confirmed': 'Confirme seu e-mail pelo link que enviamos e depois entre aqui.',
    'User already registered': 'Já existe uma conta com esse e-mail. Use “Entrar”.',
    'Signups not allowed for this instance': 'Novas contas estão desativadas neste app.',
  };
  function loginMsg(t) { const m = $('#loginMsg'); m.textContent = t || ''; m.hidden = !t; }
  function setMode(m) {
    mode = m;
    $('#loginBtn').textContent = m === 'login' ? 'Entrar' : 'Criar conta';
    $('#switchText').textContent = m === 'login' ? 'Primeira vez aqui?' : 'Já tem conta?';
    $('#switchMode').textContent = m === 'login' ? 'Criar conta' : 'Entrar';
    $('#loginIntro').textContent = m === 'login' ? 'Entre para ver sua estante.' : 'Crie sua conta com e-mail e uma senha de pelo menos 6 caracteres.';
    $('#password').autocomplete = m === 'login' ? 'current-password' : 'new-password';
    loginMsg('');
  }
  $('#switchMode').addEventListener('click', () => setMode(mode === 'login' ? 'signup' : 'login'));
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#email').value.trim(), password = $('#password').value;
    if (!email || password.length < 6) { loginMsg('Preencha o e-mail e uma senha com pelo menos 6 caracteres.'); return; }
    const btn = $('#loginBtn'); btn.disabled = true;
    try {
      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split('#')[0] } });
        if (error) throw error;
        if (!data.session) { setMode('login'); loginMsg('Conta criada. Abra o e-mail de confirmação que enviamos e depois entre aqui.'); }
      }
    } catch (err) { loginMsg(ERR[err.message] || 'Não deu certo: ' + err.message); }
    finally { btn.disabled = false; }
  });

  function showLogin() { $('#app').hidden = true; $('#login').hidden = false; }
  function showApp() { $('#login').hidden = true; $('#app').hidden = false; }

  setTab(state.tab);

  if (!sb) {
    showLogin();
    loginMsg('O app ainda não está ligado ao banco de dados. Falta preencher o arquivo config.js.');
    $('#loginBtn').disabled = true;
    return;
  }

  sb.auth.onAuthStateChange((event, session) => {
    const u = session ? session.user : null;
    if (u && (!state.user || state.user.id !== u.id)) {
      state.user = u; $('#whoami').textContent = u.email || '';
      showApp(); state.loaded = false; renderShelf(); refresh(); subscribe();
    } else if (!u && state.user !== null) {
      state.user = null; state.books = new Map(); if (state.channel) sb.removeChannel(state.channel);
      showLogin();
    } else if (!u) showLogin();
  });

  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();
