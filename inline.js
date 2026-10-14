// 나무마크 인라인 문법: 글자 꾸미기, 링크, 각주, {{{ }}}, 매크로
import { esc, color, size, safeCss, lum, parseDate, fmtDate } from './util.js?v=c8840afc3dfd';

export const TOC_MARK = '\u0000toc\u0000';

// ── 짝 찾기 ──
// s[j] 는 여는 {{{ 바로 다음 글자. 닫는 }}} 의 위치를 돌려준다.
export function closeBrace(s, j) {
  let d = 1;
  while (j < s.length) {
    if (s.startsWith('{{{', j)) { d++; j += 3; }
    else if (s.startsWith('}}}', j)) { if (--d === 0) return j; j += 3; }
    else j++;
  }
  return -1;
}

export function closeLink(s, j) {
  let d = 1;
  while (j < s.length) {
    if (s[j] === '\n') return -1;
    if (s[j] === '\\') { j += 2; continue; }
    if (s.startsWith('{{{', j)) { const e = closeBrace(s, j + 3); if (e < 0) return -1; j = e + 3; continue; }
    if (s.startsWith('[[', j)) { d++; j += 2; continue; }
    if (s.startsWith(']]', j)) { if (--d === 0) return j; j += 2; continue; }
    j++;
  }
  return -1;
}

function closeBracket(s, j) {
  let d = 1;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\') { j += 2; continue; }
    if (s.startsWith('{{{', j)) { const e = closeBrace(s, j + 3); if (e < 0) return -1; j = e + 3; continue; }
    if (c === '[') d++;
    else if (c === ']' && --d === 0) return j;
    j++;
  }
  return -1;
}

// 한 줄에서 열린 {{{ 개수 - 닫힌 }}} 개수
export function braceDepth(line) {
  let d = 0, j = 0;
  while (j < line.length) {
    if (line.startsWith('{{{', j)) { d++; j += 3; }
    else if (line.startsWith('}}}', j)) { d--; j += 3; }
    else j++;
  }
  return d;
}

// {{{ }}} 와 [[ ]] 안쪽은 건너뛰고 sep 으로 나눈다
export function splitTop(s, sep) {
  const parts = [];
  let last = 0, i = 0;
  while (i < s.length) {
    if (s[i] === '\\') { i += 2; continue; }
    if (s.startsWith('{{{', i)) { const e = closeBrace(s, i + 3); if (e >= 0) { i = e + 3; continue; } }
    if (s.startsWith('[[', i)) { const e = closeLink(s, i + 2); if (e >= 0) { i = e + 2; continue; } }
    if (s.startsWith(sep, i)) { parts.push(s.slice(last, i)); i += sep.length; last = i; continue; }
    i++;
  }
  parts.push(s.slice(last));
  return parts;
}

// ── 색 ──
// 어두운 테마용 색이 없으면 알아서 읽을 만한 색을 고른다
export function colorVars(kind, light, dark) {
  if (!dark) {
    if (kind === 'bg') dark = `color-mix(in srgb, ${light} 24%, var(--surface))`;
    else dark = (lum(light) ?? 1) < 0.25 ? 'currentColor' : light;
  }
  return `--c${kind}:${light};--c${kind}d:${dark}`;
}

// ── 본체 ──
const STYLES = [["'''", 'strong'], ["''", 'em'], ['__', 'u'], ['~~', 'del'], ['--', 'del'], ['^^', 'sup'], [',,', 'sub']];
const MACRO_RE = /^\[([a-zA-Z가-힣]+)(?:\(([^\]\n]*)\))?\]/;

export function inline(s, st) {
  let out = '', buf = '', i = 0;
  const flush = () => { if (buf) { out += esc(buf); buf = ''; } };
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) { buf += s[i + 1]; i += 2; continue; }
    if (c === '\n') { flush(); out += '<br>'; i++; continue; }
    if (c === '{' && s.startsWith('{{{', i)) {
      const e = closeBrace(s, i + 3);
      if (e >= 0) { flush(); out += brace(s.slice(i + 3, e), st); i = e + 3; continue; }
    }
    if (c === '[') {
      if (s[i + 1] === '[') {
        const e = closeLink(s, i + 2);
        if (e >= 0) { flush(); out += link(s.slice(i + 2, e), st); i = e + 2; continue; }
      } else if (s[i + 1] === '*') {
        const e = closeBracket(s, i + 1);
        if (e >= 0) { flush(); out += footnote(s.slice(i + 2, e), st); i = e + 1; continue; }
      } else {
        const m = MACRO_RE.exec(s.slice(i, i + 400));
        if (m) {
          const r = macro(m[1], m[2], st);
          if (r !== null) { flush(); out += r; i += m[0].length; continue; }
        }
      }
    }
    const tok = STYLES.find(t => s.startsWith(t[0], i));
    if (tok) {
      const n = tok[0].length;
      const nl = s.indexOf('\n', i);
      const close = s.indexOf(tok[0], i + n);
      if (close > i + n && (nl < 0 || close < nl)) {
        flush();
        out += `<${tok[1]}>${inline(s.slice(i + n, close), st)}</${tok[1]}>`;
        i = close + n;
        continue;
      }
      buf += tok[0];
      i += n;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

// ── {{{ }}} ──
function attr(head, name) {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(head);
  return m ? (m[1] ?? m[2]) : '';
}

function brace(content, st) {
  if (content.startsWith('#!')) {
    const nl = content.indexOf('\n');
    const head = nl < 0 ? content : content.slice(0, nl);
    const body = nl < 0 ? '' : content.slice(nl + 1);
    const kind = head.slice(2).split(/\s/, 1)[0].toLowerCase();
    if (kind === 'wiki') {
      const css = safeCss(attr(head, 'style'));
      const dark = safeCss(attr(head, 'dark-style'));
      return `<div class="wiki-box"${css ? ` style="${esc(css)}"` : ''}${dark ? ` data-dark-style="${esc(dark)}"` : ''}>${st.blocks(body, st)}</div>`;
    }
    if (kind === 'folding') {
      const title = head.slice(9).trim() || '[ 펼치기 · 접기 ]';
      return `<details class="wiki-fold"><summary>${inline(title, st)}</summary><div class="wiki-fold-body">${st.blocks(body, st)}</div></details>`;
    }
    if (kind === 'syntax') return `<pre class="wiki-code"><code>${esc(body.replace(/\n$/, ''))}</code></pre>`;
    // #!html 등 지원하지 않는 것은 그대로 보여준다
    return `<pre class="wiki-code">${esc(content)}</pre>`;
  }
  let m = /^([+-])([1-5])(?:\s|$)/.exec(content);
  if (m) return `<span class="wiki-size-${m[1] === '+' ? 'up' : 'down'}-${m[2]}">${inline(content.slice(m[0].length), st)}</span>`;
  m = /^(#[0-9a-zA-Z]+)(?:,(#[0-9a-zA-Z]+))?(?:\s|$)/.exec(content);
  if (m) {
    const light = color(m[1]);
    if (light) {
      const dark = m[2] ? color(m[2]) : null;
      return `<span class="c-fg" style="${colorVars('fg', light, dark)}">${inline(content.slice(m[0].length), st)}</span>`;
    }
  }
  if (content.includes('\n')) return `<pre>${esc(content.replace(/^\n/, '').replace(/\n$/, ''))}</pre>`;
  return `<code>${esc(content)}</code>`;
}

// ── 링크 ──
export function resolveTitle(target, cur) {
  if (target.startsWith('../')) {
    let t = cur, rest = target;
    while (rest.startsWith('../')) {
      t = t.includes('/') ? t.slice(0, t.lastIndexOf('/')) : t;
      rest = rest.slice(3);
    }
    return rest ? t + '/' + rest : t;
  }
  if (target.startsWith('/')) return cur + target;
  return target;
}

const docHref = (t, anchor) => '#/w/' + encodeURIComponent(t) + (anchor ? '#' + encodeURIComponent(anchor) : '');

function link(body, st) {
  const parts = splitTop(body, '|');
  const raw = parts[0].trim();
  const label = parts.length > 1 ? parts.slice(1).join('|') : null;
  let target = raw.replace(/\\(.)/g, '$1');

  if (target.startsWith('분류:')) {
    const cat = target.slice(3).replace(/#blur$/, '').trim();
    if (cat) st.cats.push(cat);
    return '';
  }
  if (target.startsWith('파일:')) return image(target.slice(3).trim(), label, st);
  if (target.startsWith(':')) target = target.slice(1);

  if (/^(https?:\/\/|mailto:)/i.test(target)) {
    const text = label !== null ? inline(label, st) : esc(target);
    return `<a class="ext" href="${esc(target)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  }

  let anchor = '';
  const h = target.lastIndexOf('#');
  if (h >= 0) { anchor = target.slice(h + 1); target = target.slice(0, h); }
  const full = resolveTitle(target, st.title);
  const text = label !== null ? inline(label, st) : esc(raw.replace(/^:/, ''));

  if (!full || (full === st.title && anchor)) return `<a data-anchor="${esc(anchor)}">${text}</a>`;
  if (full === st.title) return `<a class="self">${text}</a>`;
  st.links.add(full);
  const ok = st.ctx.exists(full);
  return `<a class="wl${ok ? '' : ' missing'}" href="${docHref(full, anchor)}" title="${esc(full)}${ok ? '' : ' (없는 문서)'}">${text}</a>`;
}

function image(name, opts, st) {
  const o = {};
  for (const p of String(opts ?? '').split('&')) {
    const k = p.indexOf('=');
    if (k > 0) o[p.slice(0, k).trim()] = p.slice(k + 1).trim();
  }
  const page = docHref('파일:' + name);
  if (!st.ctx.file(name)) return `<a class="wl missing" href="${page}" title="없는 파일">파일:${esc(name)}</a>`;
  const css = [];
  const w = size(o.width), h = size(o.height);
  if (w) css.push('width:' + w);
  if (h) css.push('height:' + h);
  const bg = color(o.bgcolor);
  if (bg) css.push('background:' + bg);
  const al = ['left', 'center', 'right'].includes(o.align) ? ' al-' + o.align : '';
  return `<span class="wiki-img-wrap${al}"><a href="${page}"><img class="wiki-img" data-file="${esc(name)}" alt="${esc(name)}"${css.length ? ` style="${css.join(';')}"` : ''}></a></span>`;
}

// ── 각주 ──
function footnote(body, st) {
  const m = /^(\S*)(?:\s([\s\S]*))?$/.exec(body);
  const name = m[1];
  const content = m[2];
  if (name && content === undefined && st.fnNamed.has(name)) {
    const id = st.fnNamed.get(name);
    return `<sup class="wiki-fn-ref"><a data-anchor="fn-${id}" data-fn="${id}">[${esc(name)}]</a></sup>`;
  }
  const id = ++st.fnSeq;
  const label = name || String(++st.fnNum);
  st.fnPending.push({ id, label, html: inline(content ?? '', st) });
  if (name) st.fnNamed.set(name, id);
  return `<sup class="wiki-fn-ref"><a data-anchor="fn-${id}" data-aid="rfn-${id}" data-fn="${id}">[${esc(label)}]</a></sup>`;
}

export function renderFootnotes(st) {
  if (!st.fnPending.length) return '';
  const items = st.fnPending.map(f =>
    `<div class="wiki-fn" data-aid="fn-${f.id}"><a data-anchor="rfn-${f.id}">[${esc(f.label)}]</a> <span class="fn-body">${f.html}</span></div>`);
  st.fnPending = [];
  return `<div class="wiki-fns">${items.join('')}</div>`;
}

// ── 매크로 ──
function opts(list) {
  const o = {};
  for (const p of list) {
    const k = p.indexOf('=');
    if (k > 0) o[p.slice(0, k).trim()] = p.slice(k + 1).trim();
  }
  return o;
}

function macro(name, arg, st) {
  switch (name.toLowerCase()) {
    case '목차': case 'tableofcontents': return TOC_MARK;
    case '각주': case 'footnote': return renderFootnotes(st);
    case 'br': return '<br>';
    case 'clearfix': return '<div class="wiki-clear"></div>';
    case 'date': case 'datetime': return esc(fmtDate(new Date()));
    case 'pagecount': return String(st.ctx.pageCount);
    case 'anchor': return arg ? `<a data-aid="${esc(arg.trim())}"></a>` : null;
    case 'youtube': {
      const [id, ...rest] = String(arg ?? '').split(',').map(x => x.trim());
      if (!/^[\w-]{6,20}$/.test(id || '')) return null;
      const o = opts(rest);
      const w = size(o.width) || '640px';
      const start = /^\d+$/.test(o.start || '') ? '?start=' + o.start : '';
      return `<span class="wiki-video" style="max-width:${w}"><iframe src="https://www.youtube-nocookie.com/embed/${id}${start}" title="YouTube 영상" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></span>`;
    }
    case 'age': {
      const d = parseDate(arg);
      if (!d) return null;
      const now = new Date();
      let a = now.getFullYear() - d.getFullYear();
      if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--;
      return String(a);
    }
    case 'dday': {
      const d = parseDate(arg);
      if (!d) return null;
      const t = new Date();
      t.setHours(0, 0, 0, 0);
      const diff = Math.round((t - d) / 86400000);
      return diff === 0 ? 'D-Day' : diff > 0 ? 'D+' + diff : 'D' + diff;
    }
    case 'ruby': {
      const [base, ...rest] = splitTop(String(arg ?? ''), ',');
      const o = opts(rest);
      return `<ruby>${inline(base.trim(), st)}<rp>(</rp><rt>${esc(o.ruby || '')}</rt><rp>)</rp></ruby>`;
    }
    case 'include': return '';
  }
  return null;
}
