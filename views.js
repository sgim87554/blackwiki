// 화면별 내용 만들기. 각 함수는 { title, sub, actions, meta, body } 를 돌려준다.
import { W, collator, renderDoc, getIndex, splitNs, splitAnchor, titleToPath, href, docHref, urls } from './store.js?v=c8840afc3dfd';
import { esc, fmtDate, relTime, fmtSize, initial } from './util.js?v=c8840afc3dfd';
import { icon } from './icons.js?v=c8840afc3dfd';
import { canEdit } from './github.js?v=c8840afc3dfd';

// 위키 안 편집이 켜져 있으면 편집기로, 아니면 GitHub 편집 화면으로
const editLink = (title, path) => (canEdit() ? href('edit', title) : path ? urls.edit(path) : urls.create(title, newTemplate(title)));
const editOpts = (o = {}) => ({ ...o, ext: !canEdit() });

const EXT = ' target="_blank" rel="noopener noreferrer"';

export function btn(h, ic, label, { primary = false, ext = false, title = '' } = {}) {
  return `<a class="btn${primary ? ' primary' : ''}" href="${esc(h)}"${ext ? EXT : ''}${title ? ` title="${esc(title)}"` : ''}>${icon(ic)}<span>${label}</span></a>`;
}

const docLink = t => `<a class="${t in W.data.docs ? '' : 'missing'}" href="${docHref(t)}">${esc(t)}</a>`;

function grouped(titles, label = t => t) {
  const groups = new Map();
  for (const t of titles) {
    const k = initial(label(t));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  return `<div class="groups">${[...groups].map(([k, ts]) =>
    `<section class="group"><h3 class="group-title">${esc(k)}</h3><ul class="group-list">${ts.map(t =>
      `<li><a href="${docHref(t)}">${esc(label(t))}</a></li>`).join('')}</ul></section>`).join('')}</div>`;
}

export function newTemplate(title) {
  const [ns, name] = splitNs(title);
  if (ns === '분류') return `${name} 분류에 대한 설명을 적어 주세요.\n`;
  if (ns === '틀') return `||<tablewidth=100%> @내용@ ||\n`;
  return `== 개요 ==\n'''${name}'''은(는) \n`;
}

function missingBox(title) {
  const [ns, name] = splitNs(title);
  const bad = /[\\:*?"<>|]/.test(name) || (!ns && title.includes(':'));
  return `<div class="missing-box">
    <p class="missing-title"><b>${esc(title)}</b> 문서가 아직 없어요.</p>
    <p class="hint">${canEdit() ? '새 문서를 만들어 보세요. 저장하면 바로 보이고, 다른 사람에게는 1~2분 뒤에 보여요.' : '새 문서를 만들면 GitHub 편집 화면이 열려요. <b>Commit changes</b>로 저장하고 1~2분 뒤 새로고침하면 보여요.'}</p>
    ${bad ? '<p class="warn">제목에 \\ : * ? " &lt; &gt; | 가 들어 있으면 Windows에서 내려받을 때 문제가 생길 수 있어요.</p>' : ''}
    ${btn(editLink(title), 'plus', '새 문서 만들기', editOpts({ primary: true }))}
  </div>`;
}

function catBox(cats) {
  if (!cats.length) return '';
  return `<div class="cat-box"><b>분류</b>${cats.map(c => `<a href="${docHref('분류:' + c)}">${esc(c)}</a>`).join('<span class="sep">·</span>')}</div>`;
}

function categoryMembers(cat) {
  const list = (getIndex().cats.get(cat) || []).slice().sort(collator.compare);
  const name = esc(cat.slice(3));
  if (!list.length) return `<section class="cat-members"><h2 class="sec-title">"${name}" 분류에 속한 문서</h2><p class="empty">아직 이 분류에 속한 문서가 없어요.</p></section>`;
  const subs = list.filter(t => t.startsWith('분류:'));
  const pages = list.filter(t => !t.startsWith('분류:'));
  let h = '';
  if (subs.length) h += `<h2 class="sec-title">하위 분류 <span class="count">${subs.length}</span></h2>${grouped(subs, t => t.slice(3))}`;
  if (pages.length) h += `<h2 class="sec-title">"${name}" 분류에 속한 문서 <span class="count">${pages.length}</span></h2>${grouped(pages)}`;
  return `<section class="cat-members">${h}</section>`;
}

function fileBlock(name) {
  const f = W.data.files[name];
  if (!f) return `<div class="missing-box">
    <p class="missing-title"><b>${esc(name)}</b> 파일이 없어요.</p>
    <p class="hint">GitHub 저장소의 <code>files</code> 폴더에 같은 이름으로 올리면 돼요.</p>
    ${btn(urls.upload(), 'upload', '파일 올리기', { primary: true, ext: true })}
  </div>`;
  return `<figure class="file-view"><img class="wiki-img" data-file="${esc(name)}" alt="${esc(name)}"><figcaption>${esc(f.type)} · ${fmtSize(f.size)} · <code>${esc(f.path)}</code></figcaption></figure>`;
}

// ── 문서 ──
export function docView(title, params) {
  const d = W.data.docs[title];
  const [ns, name] = splitNs(title);
  const from = params.get('from');

  if (d && !params.has('noredirect') && !from) {
    const r = renderDoc(title);
    if (r.redirect) {
      const [t, a] = splitAnchor(r.redirect);
      if (t !== title) return { redirect: href('w', t, { from: title }, a) };
    }
  }

  const acts = [];
  if (d) acts.push(btn(editLink(title, d.path), 'edit', '편집', editOpts({ primary: true, title: canEdit() ? '' : 'GitHub에서 편집 · 저장 후 1~2분 뒤 반영' })));
  else acts.push(btn(editLink(title), 'plus', ns === '파일' ? '설명 쓰기' : '만들기', editOpts({ primary: true })));
  acts.push(btn(href('history', title), 'history', '역사'), btn(href('backlink', title), 'link', '역링크'));

  let body = from ? `<div class="notice"><a href="${href('w', from, { noredirect: 1 })}">${esc(from)}</a>에서 넘어왔어요.</div>` : '';
  let meta = '';
  if (d) {
    const r = renderDoc(title);
    if (r.redirect) body += `<div class="notice">이 문서는 ${docLink(splitAnchor(r.redirect)[0])} 문서로 넘겨주는 문서예요.</div>`;
    else body += catBox(r.cats) + `<div class="wiki">${r.html}</div>`;
    if (d.updated) meta = `최근 수정 <time datetime="${esc(d.updated)}" title="${esc(fmtDate(d.updated))}">${esc(fmtDate(d.updated))}</time>${d.author ? ` · ${esc(d.author)}` : ''}`;
  } else if (ns !== '분류' && ns !== '파일') {
    body += missingBox(title);
    const q = name.toLowerCase();
    const similar = W.titles.filter(t => t.toLowerCase().includes(q)).slice(0, 20);
    if (similar.length) body += `<h2 class="sec-title">비슷한 제목의 문서</h2><ul class="plain-list">${similar.map(t => `<li>${docLink(t)}</li>`).join('')}</ul>`;
  }
  if (ns === '파일') body = fileBlock(name) + body;
  if (ns === '분류') {
    if (!d) body += `<p class="desc">이 분류의 설명 문서는 아직 없어요. 위의 <b>만들기</b>로 설명을 써 둘 수 있어요.</p>`;
    body += categoryMembers(title);
  }
  return { title, actions: acts.join(''), meta, body };
}

// ── 역사 ──
function diffStat(e) {
  if (e.add == null) return '';
  return `<span class="diff"><span class="plus">+${e.add}</span> <span class="minus">−${e.del}</span></span>`;
}
const BADGE = { A: '<span class="badge new">새 문서</span>', D: '<span class="badge del">삭제</span>' };

export function historyView(title) {
  const list = W.data.history[title] || [];
  const d = W.data.docs[title];
  const path = d?.path ?? (title.startsWith('파일:') ? 'files/' + title.slice(3) : titleToPath(title));
  const rows = list.map(e => `<li class="row">
      <div class="row-main">${BADGE[e.s] || ''}<b>${esc(e.a)}</b><span class="msg">${esc(e.m)}</span>${diffStat(e)}</div>
      <div class="row-sub"><time title="${esc(relTime(e.d))}">${esc(fmtDate(e.d))}</time>
        <a href="${urls.commit(e.h)}"${EXT}>바뀐 내용</a>${e.s !== 'D' ? `<a href="${urls.blob(e.h, path)}"${EXT}>이 판 보기</a>` : ''}<code>${e.h.slice(0, 7)}</code></div>
    </li>`).join('');
  const body = list.length
    ? `<p class="desc">바뀐 내용과 옛 판은 GitHub에서 열려요. 저장소에 초대된 계정으로 로그인해야 볼 수 있어요.</p><ul class="rows">${rows}</ul>`
    : `<p class="empty">아직 편집 기록이 없어요.</p>`;
  return { title, sub: '역사', actions: btn(docHref(title), 'doc', '문서로'), body };
}

// ── 역링크 ──
const BL_TYPE = { link: '링크', include: '포함', redirect: '넘겨주기' };
export function backlinkView(title) {
  const seen = new Set();
  const items = (getIndex().back.get(title) || [])
    .filter(x => { const k = x.from + '\u0001' + x.type; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => collator.compare(a.from, b.from));
  const body = items.length
    ? `<p class="desc">이 문서를 가리키는 문서 ${new Set(items.map(x => x.from)).size}개</p><ul class="plain-list">${items.map(x =>
      `<li><a href="${docHref(x.from)}${x.type === 'redirect' ? '?noredirect=1' : ''}">${esc(x.from)}</a>${x.type !== 'link' ? ` <span class="badge">${BL_TYPE[x.type]}</span>` : ''}</li>`).join('')}</ul>`
    : `<p class="empty">이 문서를 가리키는 문서가 없어요.</p>`;
  return { title, sub: '역링크', actions: btn(docHref(title), 'doc', '문서로'), body };
}

// ── 최근 변경 ──
export function recentView(type) {
  let list = W.data.recent;
  if (type === 'new') list = list.filter(e => e.s === 'A');
  if (type === 'del') list = list.filter(e => e.s === 'D');
  const tab = (t, label) => `<a href="${href('recent', '', t ? { type: t } : null)}" class="${type === t ? 'active' : ''}">${label}</a>`;
  const rows = list.slice(0, 150).map(e => `<li class="row">
      <div class="row-main">${docLink(e.t)}${BADGE[e.s] || ''}${diffStat(e)}</div>
      <div class="row-sub"><b>${esc(e.a)}</b><span class="msg">${esc(e.m)}</span><time title="${esc(fmtDate(e.d))}">${esc(relTime(e.d))}</time></div>
    </li>`).join('');
  return {
    title: '최근 변경',
    body: `<nav class="tabs">${tab('', '전체')}${tab('new', '새 문서')}${tab('del', '삭제')}</nav>` +
      (list.length ? `<ul class="rows">${rows}</ul>` : `<p class="empty">기록이 없어요.</p>`),
  };
}

// ── 검색 ──
function highlight(text, q) {
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  let out = '', last = 0, m;
  while ((m = re.exec(text))) {
    out += esc(text.slice(last, m.index)) + `<mark>${esc(m[0])}</mark>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

function plain(s) {
  return s
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\{\{\{(?:#!\w+[^\n]*\n|[+-]\d\s|#[\w,#]+\s)?/g, '').replace(/\}\}\}/g, '')
    .replace(/'''|''|~~|__|\^\^|,,/g, '')
    .replace(/\[\*\S*\s?([^\]]*)\]/g, ' ($1)').replace(/\[\*\S*\s?/g, '').replace(/<[^>]*>/g, '').replace(/\|\|/g, ' ')
    .replace(/^=+#?\s*|\s*#?=+$/gm, '')
    .replace(/\s+/g, ' ');
}

export function searchView(q) {
  q = q.trim();
  if (!q) return { title: '검색', body: '<p class="empty">검색어를 입력해 주세요.</p>' };
  const ql = q.toLowerCase();
  const score = t => { const l = t.toLowerCase(); return l === ql ? 0 : l.startsWith(ql) ? 1 : 2; };
  const titleHits = W.titles.filter(t => t.toLowerCase().includes(ql))
    .sort((a, b) => score(a) - score(b) || a.length - b.length || collator.compare(a, b));
  const inTitle = new Set(titleHits);
  const textHits = [];
  for (const t of W.titles) {
    if (inTitle.has(t)) continue;
    const src = W.data.docs[t].src;
    const k = src.toLowerCase().indexOf(ql);
    if (k >= 0) textHits.push({ t, snip: plain(src.slice(Math.max(0, k - 60), k + q.length + 100)) });
  }
  let body = q in W.data.docs
    ? `<div class="notice"><a href="${docHref(q)}"><b>${esc(q)}</b></a> 문서로 바로 가기</div>`
    : `<div class="notice"><b>${esc(q)}</b> 문서는 없어요. <a href="${esc(editLink(q))}"${canEdit() ? '' : EXT}>새로 만들기</a></div>`;
  if (titleHits.length) body += `<h2 class="sec-title">제목 일치 <span class="count">${titleHits.length}</span></h2><ul class="plain-list">${titleHits.slice(0, 100).map(t =>
    `<li><a href="${docHref(t)}">${highlight(t, q)}</a></li>`).join('')}</ul>`;
  if (textHits.length) body += `<h2 class="sec-title">내용 일치 <span class="count">${textHits.length}</span></h2><ul class="results">${textHits.slice(0, 100).map(h =>
    `<li><a class="r-title" href="${docHref(h.t)}">${esc(h.t)}</a><p class="snippet">…${highlight(h.snip, q)}…</p></li>`).join('')}</ul>`;
  if (!titleHits.length && !textHits.length) body += `<p class="empty">검색 결과가 없어요.</p>`;
  return { title: '검색', sub: q, body };
}

// ── 전체 문서 ──
export function allView(ns) {
  const names = ['', ...W.site.namespaces];
  if (!names.includes(ns)) ns = '';
  const tab = n => `<a href="${href('all', '', n ? { ns: n } : null)}" class="${n === ns ? 'active' : ''}">${n || '일반 문서'}</a>`;
  let list;
  if (ns === '파일') list = Object.keys(W.data.files).sort(collator.compare).map(n => '파일:' + n);
  else if (ns === '분류') list = [...new Set([...W.titles.filter(t => t.startsWith('분류:')), ...getIndex().cats.keys()])].sort(collator.compare);
  else list = W.titles.filter(t => splitNs(t)[0] === ns);
  const strip = t => (ns ? t.slice(ns.length + 1) : t);
  return {
    title: '전체 문서',
    body: `<nav class="tabs">${names.map(tab).join('')}</nav>` +
      (list.length ? `<p class="desc">${list.length}개</p>${grouped(list, strip)}` : '<p class="empty">아직 없어요.</p>'),
  };
}

export function randomTitle() {
  const pool = W.titles.filter(t => !splitNs(t)[0] && !renderDoc(t).redirect);
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : W.site.mainPage;
}
