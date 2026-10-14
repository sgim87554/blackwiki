// 위키 데이터 보관소와 주소 도우미
import { render } from './namumark.js?v=c8840afc3dfd';

export const W = { meta: null, data: null, site: null, titles: [], cache: new Map(), index: null, pendingFiles: {} };
export const collator = new Intl.Collator('ko', { numeric: true });

const PENDING = 'bw.pending';
const PENDING_TTL = 30 * 60 * 1000;

function refresh() {
  W.titles = Object.keys(W.data.docs).sort(collator.compare);
  W.cache.clear();
  W.index = null;
}

export function setData(data) {
  W.data = data;
  W.site = data.site;
  refresh();
  // 방금 저장했지만 아직 새 빌드에 들어가지 않은 편집을 다시 얹는다
  const built = Date.parse(data.builtAt);
  const keep = readPending().filter(p => p.at > built && Date.now() - p.at < PENDING_TTL);
  for (const p of keep) applyEdit(p);
  writePending(keep);
}

function readPending() {
  try { return JSON.parse(sessionStorage.getItem(PENDING) || '[]'); } catch { return []; }
}
function writePending(list) {
  try { sessionStorage.setItem(PENDING, JSON.stringify(list)); } catch { /* 무시 */ }
}

function applyEdit(e) {
  const d = new Date(e.at).toISOString();
  if (e.src == null) delete W.data.docs[e.title];
  else W.data.docs[e.title] = { ...(W.data.docs[e.title] || {}), path: e.path, src: e.src, updated: d, author: e.author };
  const entry = { h: e.sha || '', a: e.author, d, m: e.msg, s: e.status, add: null, del: null };
  W.data.recent.unshift({ t: e.title, ...entry });
  (W.data.history[e.title] ??= []).unshift(entry);
  refresh();
}

// 위키 안에서 저장한 결과를 바로 화면에 반영한다 (다른 사람에게는 새 빌드 후 보인다)
export function localEdit(e) {
  e = { ...e, at: Date.now() };
  applyEdit(e);
  const list = readPending().filter(p => Date.now() - p.at < PENDING_TTL);
  list.push(e);
  writePending(list);
}

const ctx = {
  exists: t => t in W.data.docs || (t.startsWith('파일:') && (t.slice(3) in W.data.files || t.slice(3) in W.pendingFiles)),
  source: t => W.data.docs[t]?.src ?? null,
  file: name => W.data.files[name] ?? W.pendingFiles[name] ?? null,
  get pageCount() { return W.titles.length; },
};

export function renderDoc(title) {
  let r = W.cache.get(title);
  if (!r) {
    r = render(W.data.docs[title]?.src ?? '', ctx, title);
    W.cache.set(title, r);
  }
  return r;
}

export const renderSrc = (src, title) => render(src, ctx, title);

// 역링크·분류 목록. 처음 필요할 때 한 번만 모든 문서를 훑는다.
export function getIndex() {
  if (W.index) return W.index;
  const back = new Map();
  const cats = new Map();
  const add = (map, key, val) => { if (!map.has(key)) map.set(key, []); map.get(key).push(val); };
  for (const t of W.titles) {
    const r = renderDoc(t);
    if (r.redirect) {
      add(back, splitAnchor(r.redirect)[0], { from: t, type: 'redirect' });
      continue;
    }
    for (const l of r.links) if (l !== t) add(back, l, { from: t, type: 'link' });
    for (const inc of r.includes) add(back, inc, { from: t, type: 'include' });
    for (const c of r.cats) add(cats, '분류:' + c, t);
  }
  W.index = { back, cats };
  return W.index;
}

export function splitAnchor(t) {
  const i = t.lastIndexOf('#');
  return i > 0 ? [t.slice(0, i), t.slice(i + 1)] : [t, ''];
}

export function splitNs(t) {
  const i = t.indexOf(':');
  if (i > 0 && W.site.namespaces.includes(t.slice(0, i))) return [t.slice(0, i), t.slice(i + 1)];
  return ['', t];
}

export function titleToPath(t) {
  const [ns, rest] = splitNs(t);
  return ns ? `docs/${ns}/${rest}.txt` : `docs/${t}.txt`;
}

// 제목으로 쓸 수 없는 글자 (Windows 파일 이름, 링크 문법과 겹치는 것)
export function badTitle(t) {
  const [, name] = splitNs(t);
  if (!t.trim() || t !== t.trim()) return '제목 앞뒤에 공백을 둘 수 없어요.';
  if (/[\\:*?"<>|#[\]{}]/.test(name)) return '제목에 \\ : * ? " < > | # [ ] { } 는 쓸 수 없어요. (분류: 틀: 같은 이름공간은 괜찮아요)';
  if (/(^|\/)\.|\.(\/|$)|\/\/|^\/|\/$/.test(name)) return '제목의 / 앞뒤나 끝에 마침표나 빈칸을 둘 수 없어요.';
  if (name.length > 100) return '제목이 너무 길어요.';
  return '';
}

// ── 주소 ──
export function href(view, arg = '', params = null, anchor = '') {
  let s = '#/' + view + (arg ? '/' + encodeURIComponent(arg) : '');
  if (params) {
    const qs = new URLSearchParams(params).toString();
    if (qs) s += '?' + qs;
  }
  if (anchor) s += '#' + encodeURIComponent(anchor);
  return s;
}
export const docHref = (t, anchor) => href('w', t, null, anchor);

const gh = () => `https://github.com/${encodeURIComponent(W.site.repo.owner)}/${encodeURIComponent(W.site.repo.name)}`;
const encPath = p => p.split('/').map(encodeURIComponent).join('/');
const branch = () => encodeURIComponent(W.site.repo.branch);

export const urls = {
  edit: path => `${gh()}/edit/${branch()}/${encPath(path)}`,
  create: (title, value = '') =>
    `${gh()}/new/${branch()}?filename=${encodeURIComponent(titleToPath(title))}${value ? '&value=' + encodeURIComponent(value) : ''}`,
  commit: h => `${gh()}/commit/${h}`,
  blob: (h, path) => `${gh()}/blob/${h}/${encPath(path)}`,
  upload: () => `${gh()}/upload/${branch()}/files`,
};
