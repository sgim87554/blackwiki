// 블랙위키 앱: 로그인 → 데이터 복호화 → 주소(#/...)에 따라 화면 그리기
import * as C from './crypto.js?v=c8840afc3dfd';
import * as V from './views.js?v=c8840afc3dfd';
import * as E from './editor.js?v=c8840afc3dfd';
import * as A from './accounts.js?v=c8840afc3dfd';
import { W, setData, splitNs, href, docHref, badTitle } from './store.js?v=c8840afc3dfd';
import { esc, fmtDate, relTime } from './util.js?v=c8840afc3dfd';
import { icon } from './icons.js?v=c8840afc3dfd';
import { hydrate, applyDarkStyles, toast } from './ui.js?v=c8840afc3dfd';

const $ = s => document.querySelector(s);
const article = $('#article');
const pop = $('#fn-pop');
const canHover = matchMedia('(hover: hover)');
let currentKey = '';

// ── 시작 ──
async function boot() {
  document.querySelectorAll('[data-icon]').forEach(el => el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)));
  try {
    W.meta = await C.loadMeta();
  } catch {
    $('#boot').textContent = '사이트 정보를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.';
    return;
  }
  const name = W.meta.name || '블랙위키';
  document.title = name;
  $('#lock-title').textContent = name;
  const r = parseRoute();
  if (r.view === 'join') {
    $('#boot').hidden = true;
    A.showJoin(r.arg, W.meta, start);
    return;
  }
  const s = await C.resume(W.meta).catch(() => null);
  $('#boot').hidden = true;
  if (s?.data) start(s.data, s.me);
  else showLock(s?.pending ? '방금 만든 계정을 준비하고 있어요. 1~2분 뒤에 다시 로그인해 주세요.' : '');
}

function showLock(notice = '') {
  $('#lock').hidden = false;
  const form = $('#lock-form'), nameIn = $('#lock-name'), pw = $('#lock-pw'), btn = $('#lock-btn'), err = $('#lock-err');
  err.textContent = notice;
  try { nameIn.value = localStorage.getItem('bw.lastName') || ''; } catch { /* 무시 */ }
  (nameIn.value ? pw : nameIn).focus();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!nameIn.value.trim() || !pw.value || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '확인하는 중…';
    err.textContent = '';
    try {
      const { data, me } = await C.login(nameIn.value, pw.value, $('#lock-remember').checked, W.meta);
      try { localStorage.setItem('bw.lastName', nameIn.value.trim()); } catch { /* 무시 */ }
      pw.value = '';
      $('#lock').hidden = true;
      start(data, me);
    } catch (x) {
      err.textContent = x?.code === 'wrong'
        ? '이름이나 비밀번호가 맞지 않아요.'
        : '불러오는 중 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.';
      pw.select();
    } finally {
      btn.disabled = false;
      btn.textContent = '로그인';
    }
  });
}

function start(data, me) {
  setData(data);
  W.me = me;
  $('#brand-name').textContent = W.site.name;
  $('#me-name').textContent = me.name;
  $('#menu-admin').hidden = !me.admin;
  $('#foot-name').textContent = `${W.site.name} · 초대받은 사람만 볼 수 있는 비공개 위키`;
  $('#foot-build').innerHTML = `<a href="${docHref('블랙위키:문법 도움말')}">문법 도움말</a><span>마지막 갱신 ${esc(fmtDate(data.builtAt))}</span>`;
  $('#shell').hidden = false;
  initHeader();
  initContent();
  addEventListener('hashchange', route);
  addEventListener('beforeunload', e => {
    if (E.editor.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
  route();
}

// ── 주소 해석: #/보기/인자?쿼리#앵커 ──
const dec = s => { try { return decodeURIComponent(s); } catch { return s; } };
function parseRoute() {
  let h = location.hash.replace(/^#/, '');
  let anchor = '';
  const a = h.indexOf('#');
  if (a >= 0) { anchor = dec(h.slice(a + 1)); h = h.slice(0, a); }
  let qs = '';
  const q = h.indexOf('?');
  if (q >= 0) { qs = h.slice(q + 1); h = h.slice(0, q); }
  const m = /^\/([a-z]+)(?:\/([\s\S]*))?$/.exec(h);
  return { view: m ? m[1] : '', arg: m && m[2] ? dec(m[2]) : '', params: new URLSearchParams(qs), anchor };
}

function route() {
  // 편집 중에 다른 곳으로 가려 하면 한 번 묻는다
  if (E.editor.dirty && location.hash !== E.editor.hash) {
    if (!confirm('저장하지 않은 내용이 있어요. 이 페이지를 나갈까요?')) {
      history.replaceState(null, '', E.editor.hash);
      return;
    }
    E.editor.dirty = false;
  }
  const r = parseRoute();
  hidePop();
  closeSuggest();
  const key = [r.view, r.arg, r.params].join('\u0001');
  if (key === currentKey && r.anchor) { scrollToAnchor(r.anchor); return; }

  let v;
  switch (r.view) {
    case 'w': v = V.docView(r.arg || W.site.mainPage, r.params); break;
    case 'edit': v = E.editView(r.arg || W.site.mainPage); break;
    case 'admin': v = A.adminView(); break;
    case 'account': v = A.accountView(); break;
    case 'history': v = V.historyView(r.arg); break;
    case 'backlink': v = V.backlinkView(r.arg); break;
    case 'recent': v = V.recentView(r.params.get('type') || ''); break;
    case 'search': v = V.searchView(r.params.get('q') || ''); break;
    case 'all': v = V.allView(r.params.get('ns') || ''); break;
    case 'random': location.replace(docHref(V.randomTitle())); return;
    default: location.replace(docHref(W.site.mainPage)); return;
  }
  if (v.redirect) { location.replace(v.redirect); return; }

  currentKey = key;
  document.body.classList.toggle('wide', !!v.wide);
  show(v);
  v.mount?.(article);
  renderSidebar();
  document.title = `${v.title}${v.sub ? ` (${v.sub})` : ''} - ${W.site.name}`;
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === r.view));
  if (r.anchor) requestAnimationFrame(() => scrollToAnchor(r.anchor));
  else scrollTo(0, 0);
}

function show({ title, sub = '', actions = '', meta = '', body = '' }) {
  const [ns, rest] = splitNs(title);
  article.innerHTML = `
    <header class="doc-head">
      <h1 class="doc-title">${ns ? `<span class="ns">${esc(ns)}:</span>` : ''}${esc(rest)}${sub ? ` <span class="sub">(${esc(sub)})</span>` : ''}</h1>
      ${actions ? `<div class="actions">${actions}</div>` : ''}
    </header>
    ${meta ? `<div class="doc-meta">${meta}</div>` : ''}
    <div class="doc-body">${body}</div>`;
  hydrate(article);
}

// ── 머리글: 검색, 테마, 잠금 ──
function closeSuggest() { $('#suggest').classList.remove('open'); }

function go(h) {
  const input = $('#q');
  input.value = '';
  input.blur();
  closeSuggest();
  if (location.hash === h) route();
  else location.hash = h;
}

function initHeader() {
  const input = $('#q'), box = $('#suggest');
  let items = [], sel = -1;

  const draw = () => {
    const q = input.value.trim();
    if (!q) { closeSuggest(); return; }
    box.innerHTML = items.map((t, i) => `<a href="${docHref(t)}" class="${i === sel ? 'sel' : ''}">${esc(t)}</a>`).join('') +
      `<a href="${href('search', '', { q })}" class="more${sel === items.length ? ' sel' : ''}">${icon('search')}<span>'${esc(q)}' 내용까지 검색</span></a>`;
    box.classList.add('open');
  };
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    sel = -1;
    const starts = [], has = [];
    if (q) for (const t of W.titles) {
      const l = t.toLowerCase();
      if (l.startsWith(q)) starts.push(t);
      else if (l.includes(q)) has.push(t);
    }
    items = [...starts, ...has].slice(0, 8);
    draw();
  });
  input.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return; // 한글 조합 중
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, items.length); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, -1); draw(); }
    else if (e.key === 'Escape') { closeSuggest(); input.blur(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      if (sel >= 0 && sel < items.length) go(docHref(items[sel]));
      else if (sel === items.length || !(q in W.data.docs)) go(href('search', '', { q }));
      else go(docHref(q));
    }
  });
  input.addEventListener('focus', draw);
  input.addEventListener('blur', () => setTimeout(closeSuggest, 120));
  box.addEventListener('mousedown', e => e.preventDefault());
  box.addEventListener('click', e => {
    const a = e.target.closest('a');
    if (a) { e.preventDefault(); go(a.getAttribute('href')); }
  });
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) {
      e.preventDefault();
      input.focus();
    }
  });

  const themeBtn = $('#theme-btn');
  const themeIcon = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    themeBtn.innerHTML = icon(dark ? 'sun' : 'moon');
    themeBtn.title = dark ? '밝은 테마로' : '어두운 테마로';
  };
  themeBtn.addEventListener('click', () => window.bwTheme.toggle());
  addEventListener('bw-theme', () => { themeIcon(); applyDarkStyles(article); });
  themeIcon();

  // 새 문서: 제목을 묻고 편집기로
  $('#new-doc').addEventListener('click', () => {
    const t = (prompt('새 문서 제목을 적어 주세요.') || '').trim().normalize('NFC');
    if (!t) return;
    const bad = badTitle(t);
    if (bad) { toast(bad, 'error'); return; }
    if (t in W.data.docs) { toast('이미 있는 문서예요. 그 문서로 갈게요.'); go(docHref(t)); return; }
    go(href('edit', t));
  });

  // 계정 메뉴
  const menuBtn = $('#me-btn'), menu = $('#me-menu');
  const closeMenu = () => { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); };
  menuBtn.addEventListener('click', e => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    menuBtn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  menu.addEventListener('click', closeMenu);
  document.addEventListener('click', e => { if (!e.target.closest('#me-menu')) closeMenu(); });
  $('#menu-logout').addEventListener('click', () => {
    if (E.editor.dirty && !confirm('저장하지 않은 내용이 있어요. 로그아웃할까요?')) return;
    E.editor.dirty = false;
    C.forget();
    location.href = location.pathname + '#/';
    location.reload();
  });
}

function renderSidebar() {
  const seen = new Set(), items = [];
  for (const e of W.data.recent) {
    if (seen.has(e.t)) continue;
    seen.add(e.t);
    items.push(e);
    if (items.length >= 12) break;
  }
  $('#sidebar').innerHTML = `<div class="side-title"><span>최근 변경</span><a href="#/recent">더 보기</a></div>` +
    (items.length
      ? `<div class="side-list">${items.map(e => `<a href="${docHref(e.t)}"${e.s === 'D' ? ' class="del"' : ''}><span class="t">${esc(e.t)}</span><time title="${esc(fmtDate(e.d))}">${esc(relTime(e.d))}</time></a>`).join('')}</div>`
      : '<p class="side-empty">아직 편집 기록이 없어요.</p>');
}

// ── 본문: 앵커, 접기, 각주 팝업 ──
function scrollToAnchor(id, remember = false) {
  const el = article.querySelector(`[data-aid="${CSS.escape(id)}"]`);
  if (!el) return;
  for (let s = el.closest('.wiki-sec.folded'); s; s = s.parentElement?.closest('.wiki-sec.folded')) {
    s.classList.remove('folded');
    s.previousElementSibling?.classList.remove('folded');
  }
  el.closest('details')?.setAttribute('open', '');
  el.scrollIntoView({ block: 'start' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  if (remember) history.replaceState(null, '', location.hash.split('#').slice(0, 2).join('#') + '#' + encodeURIComponent(id));
}

let hideTimer = 0;
function showPop(a) {
  clearTimeout(hideTimer);
  const body = article.querySelector(`[data-aid="fn-${CSS.escape(a.dataset.fn)}"] .fn-body`);
  if (!body) return;
  pop.innerHTML = body.innerHTML || '<span class="muted">(빈 각주)</span>';
  pop.hidden = false;
  const r = a.getBoundingClientRect();
  const w = pop.offsetWidth;
  pop.style.left = Math.max(8, Math.min(r.left + scrollX - 16, scrollX + innerWidth - w - 8)) + 'px';
  pop.style.top = r.bottom + scrollY + 6 + 'px';
  hydrate(pop);
}
function hidePop() { pop.hidden = true; }
const schedHide = () => { hideTimer = setTimeout(hidePop, 200); };

function initContent() {
  article.addEventListener('click', e => {
    const a = e.target.closest('a[data-anchor]');
    if (a) {
      e.preventDefault();
      if (a.dataset.fn && !canHover.matches) {
        if (pop.hidden) showPop(a); else hidePop();
        return;
      }
      scrollToAnchor(a.dataset.anchor, true);
      return;
    }
    const h = e.target.closest('.wiki-h');
    if (h && !e.target.closest('a')) {
      h.classList.toggle('folded');
      h.nextElementSibling?.classList.toggle('folded');
    }
  });
  article.addEventListener('mouseover', e => {
    const a = e.target.closest('.wiki-fn-ref a');
    if (a && canHover.matches) showPop(a);
  });
  article.addEventListener('mouseout', e => {
    if (e.target.closest('.wiki-fn-ref a')) schedHide();
  });
  pop.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  pop.addEventListener('mouseleave', schedHide);
  document.addEventListener('click', e => {
    if (!e.target.closest('.wiki-fn-ref, #fn-pop')) hidePop();
  });
}

boot();
