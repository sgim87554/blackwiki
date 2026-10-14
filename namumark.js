// 나무마크 렌더러 (블록 단위): 문단·제목·목록·표·인용·틀
// render(원문, ctx, 제목) → { html, cats, links, includes, headings, redirect? }
import { esc, colorPair, size } from './util.js?v=c8840afc3dfd';
import { inline, splitTop, braceDepth, closeBrace, renderFootnotes, colorVars, TOC_MARK } from './inline.js?v=c8840afc3dfd';

const FIRST_HEAD = '\u0000fh\u0000';
const HEAD_RE = /^(={1,6})(#?) +(.+?) +\2\1 *$/;
const LIST_RE = /^( +)(\*|1\.|a\.|A\.|i\.|I\.)(?:#(\d+))?[ ]?([\s\S]*)$/;
const HR_RE = /^-{4,9} *$/;
const CAP_RE = /^\|([^|\n]+)\|/;
const OL_TYPE = { '1.': '1', 'a.': 'a', 'A.': 'A', 'i.': 'i', 'I.': 'I' };

// 여러 줄에 걸친 {{{ }}} 를 한 덩어리로 모은다
function gather(lines, i) {
  let text = lines[i], d = braceDepth(text), j = i + 1;
  while (d > 0 && j < lines.length) { text += '\n' + lines[j]; d += braceDepth(lines[j]); j++; }
  return [text, j];
}

// 표의 한 행: 줄 끝이 || 로 끝날 때까지 모은다
function gatherRow(lines, i) {
  let text = lines[i], d = braceDepth(text), j = i + 1;
  const done = () => { const t = text.trimEnd(); return d <= 0 && t.length > 2 && t.endsWith('||'); };
  while (!done() && j < lines.length) { text += '\n' + lines[j]; d += braceDepth(lines[j]); j++; }
  return [text, j];
}

export function blocks(text, st, top = false) {
  const lines = text.split('\n');
  const out = [];
  let para = [];
  const flush = () => {
    while (para.length && !para[0].trim()) para.shift();
    while (para.length && !para[para.length - 1].trim()) para.pop();
    const html = para.length ? inline(para.join('\n'), st) : '';
    if (html.replace(/<br>/g, '').trim()) out.push(`<div class="wiki-p">${html}</div>`);
    para = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (top && (m = HEAD_RE.exec(line))) {
      flush();
      out.push(heading(m, st));
      i++;
      continue;
    }
    if (HR_RE.test(line)) {
      flush();
      out.push('<hr>');
      i++;
      continue;
    }
    if (line.startsWith('||') || CAP_RE.test(line)) {
      flush();
      const rows = [];
      let caption = null;
      while (i < lines.length && (lines[i].startsWith('||') || (!rows.length && CAP_RE.test(lines[i])))) {
        let [row, j] = gatherRow(lines, i);
        if (!rows.length && !row.startsWith('||')) {
          const cm = CAP_RE.exec(row);
          caption = cm[1];
          row = row.slice(cm[0].length);
          row = row.startsWith('|') ? '|' + row : '||' + row;
        }
        rows.push(row);
        i = j;
      }
      out.push(table(rows, caption, st));
      continue;
    }
    if (LIST_RE.test(line)) {
      flush();
      const [html, j] = list(lines, i, st);
      out.push(html);
      i = j;
      continue;
    }
    if (line.startsWith(' ') && line.trim()) {
      flush();
      const sub = [];
      while (i < lines.length && lines[i].startsWith(' ') && lines[i].trim()) sub.push(lines[i++].slice(1));
      out.push(`<div class="wiki-indent">${blocks(sub.join('\n'), st)}</div>`);
      continue;
    }
    if (line.startsWith('>')) {
      flush();
      const sub = [];
      while (i < lines.length && lines[i].startsWith('>')) sub.push(lines[i++].replace(/^> ?/, ''));
      out.push(`<blockquote class="wiki-quote">${blocks(sub.join('\n'), st)}</blockquote>`);
      continue;
    }
    const [t, j] = gather(lines, i);
    para.push(t);
    i = j;
  }
  flush();
  return out.join('');
}

// ── 제목 ──
function heading(m, st) {
  const level = m[1].length;
  const folded = !!m[2];
  let pre = '';
  while (st.secStack.length && st.secStack[st.secStack.length - 1] >= level) {
    pre += '</div>';
    st.secStack.pop();
  }
  st.counters[level - 1]++;
  for (let k = level; k < 6; k++) st.counters[k] = 0;
  const num = st.counters.slice(st.minLevel - 1, level).join('.');
  const id = 's-' + num;
  const html = inline(m[3], st);
  if (!st.headings.length) pre += FIRST_HEAD;
  st.headings.push({ level, num, id, html });
  st.secStack.push(level);
  const tag = 'h' + Math.min(6, Math.max(2, level));
  const f = folded ? ' folded' : '';
  return `${pre}<${tag} class="wiki-h${f}" data-aid="${id}"><a class="num" data-anchor="toc">${num}.</a><span class="ht">${html}</span><span class="fold-ico" aria-hidden="true"></span></${tag}><div class="wiki-sec${f}">`;
}

function renderToc(headings) {
  if (!headings.length) return '';
  const base = Math.min(...headings.map(h => h.level));
  const items = headings.map(h => {
    const text = h.html.replace(/<sup class="wiki-fn-ref">[\s\S]*?<\/sup>/g, '').replace(/<\/?a\b[^>]*>/g, '');
    return `<div class="wiki-toc-item" style="padding-left:${(h.level - base) * 1.3}em"><a data-anchor="${h.id}">${h.num}.</a> <span>${text}</span></div>`;
  });
  return `<div class="wiki-toc" data-aid="toc"><div class="wiki-toc-title">목차</div>${items.join('')}</div>`;
}

// ── 목록 ──
function list(lines, i, st) {
  const items = [];
  while (i < lines.length) {
    if (LIST_RE.test(lines[i])) {
      const [t, j] = gather(lines, i);
      const m = LIST_RE.exec(t);
      items.push({ indent: m[1].length, type: m[2], start: m[3], text: m[4] });
      i = j;
      continue;
    }
    // 항목보다 더 들여 쓴 줄은 앞 항목에 이어 붙인다
    const last = items[items.length - 1];
    const lead = /^( +)\S/.exec(lines[i]);
    if (last && lead && lead[1].length > last.indent) {
      const [t, j] = gather(lines, i);
      last.text += '\n' + t.trim();
      i = j;
      continue;
    }
    break;
  }

  const root = { lists: [] };
  const stack = [{ indent: -1, node: root }];
  for (const it of items) {
    while (stack.length > 1 && stack[stack.length - 1].indent >= it.indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    let lst = parent.lists[parent.lists.length - 1];
    if (!lst || lst.type !== it.type) {
      lst = { type: it.type, start: it.start, items: [] };
      parent.lists.push(lst);
    }
    const li = { text: it.text, lists: [] };
    lst.items.push(li);
    stack.push({ indent: it.indent, node: li });
  }
  const draw = node => node.lists.map(l => {
    const ol = l.type !== '*';
    const attrs = ol ? ` type="${OL_TYPE[l.type]}"${l.start ? ` start="${l.start}"` : ''}` : '';
    const lis = l.items.map(li => `<li>${inline(li.text, st)}${draw(li)}</li>`).join('');
    return ol ? `<ol class="wiki-list"${attrs}>${lis}</ol>` : `<ul class="wiki-list">${lis}</ul>`;
  }).join('');
  return [draw(root), i];
}

// ── 표 ──
function paint(o, kind, v) {
  const [light, dark] = colorPair(v);
  if (light) {
    o.cls.push('c-' + kind);
    o.style.push(colorVars(kind, light, dark));
  }
  return true;
}

function cellAttr(a, td, tr, tbl) {
  let m;
  if ((m = /^-(\d+)$/.exec(a))) { td.colspan = +m[1]; return true; }
  if ((m = /^([\^v]?)\|(\d+)$/.exec(a))) {
    td.rowspan = +m[2];
    if (m[1]) td.style.push('vertical-align:' + (m[1] === '^' ? 'top' : 'bottom'));
    return true;
  }
  if (a === '(' || a === ':' || a === ')') {
    td.style.push('text-align:' + { '(': 'left', ':': 'center', ')': 'right' }[a]);
    return true;
  }
  if (a === 'nopad') { td.style.push('padding:0'); return true; }
  if (a.startsWith('#')) return paint(td, 'bg', a);
  if (!(m = /^([a-z]+)\s*=\s*(.+)$/i.exec(a))) return false;
  const k = m[1].toLowerCase();
  const v = m[2].trim().replace(/^["']|["']$/g, '');
  switch (k) {
    case 'bgcolor': return paint(td, 'bg', v);
    case 'color': return paint(td, 'fg', v);
    case 'rowbgcolor': return paint(tr, 'bg', v);
    case 'rowcolor': return paint(tr, 'fg', v);
    case 'tablebgcolor': return paint(tbl, 'bg', v);
    case 'tablecolor': return paint(tbl, 'fg', v);
    case 'tablebordercolor': {
      const [c] = colorPair(v);
      if (c) tbl.style.push('--tbc:' + c);
      return true;
    }
    case 'width': case 'height': {
      const s = size(v);
      if (s) td.style.push(`${k}:${s}`);
      return true;
    }
    case 'tablewidth': {
      const s = size(v);
      if (s) tbl.style.push('width:' + s);
      return true;
    }
    case 'tablealign':
      if (['left', 'center', 'right'].includes(v)) tbl.align = v;
      return true;
    case 'colbgcolor': case 'colcolor': case 'keepall': case 'rowkeepall': case 'colkeepall':
      return true;
  }
  return false;
}

const attrs = o => (o.cls.length ? ` class="${o.cls.join(' ')}"` : '') + (o.style.length ? ` style="${esc(o.style.join(';'))}"` : '');

function table(rows, caption, st) {
  const tbl = { cls: ['wiki-table'], style: [], align: '' };
  const trs = rows.map(row => {
    let body = row.trim();
    body = body.endsWith('||') && body.length >= 4 ? body.slice(2, -2) : body.slice(2);
    const tr = { cls: [], style: [] };
    const tds = [];
    let span = 1;
    for (const raw of splitTop(body, '||')) {
      if (raw === '') { span++; continue; }
      const td = { cls: [], style: [], colspan: span, rowspan: 0 };
      span = 1;
      let text = raw;
      for (;;) {
        const m = /^\s*<([^<>\n]*)>/.exec(text);
        if (!m || !cellAttr(m[1].trim(), td, tr, tbl)) break;
        text = text.slice(m[0].length);
      }
      text = text.includes('\n') ? text.replace(/^[ \t]*\n/, '').replace(/\n\s*$/, '') : text.trim();
      tds.push(`<td${td.colspan > 1 ? ` colspan="${td.colspan}"` : ''}${td.rowspan > 1 ? ` rowspan="${td.rowspan}"` : ''}${attrs(td)}>${blocks(text, st)}</td>`);
    }
    return `<tr${attrs(tr)}>${tds.join('')}</tr>`;
  });
  const cap = caption ? `<caption>${inline(caption, st)}</caption>` : '';
  return `<div class="wiki-table-wrap${tbl.align ? ' al-' + tbl.align : ''}"><table${attrs(tbl)}>${cap}<tbody>${trs.join('')}</tbody></table></div>`;
}

// ── 틀 ([include]) ──
const stripComments = src => src.replace(/^##.*(?:\n|$)/gm, '');

// {{{글자 그대로}}} 영역. 이 안의 [include] 는 펼치지 않는다.
function literalRanges(src) {
  const ranges = [];
  let i = 0;
  while ((i = src.indexOf('{{{', i)) >= 0) {
    const e = closeBrace(src, i + 3);
    if (e < 0) break;
    if (/^(#!(wiki|folding)|[+-][1-5]\s|#[0-9a-zA-Z]+[\s,])/.test(src.slice(i + 3, i + 20))) { i += 3; continue; }
    ranges.push([i, e + 3]);
    i = e + 3;
  }
  return ranges;
}

function expandIncludes(src, ctx, stack, includes) {
  const literal = literalRanges(src);
  return src.replace(/\[include\((.*?)\)\]/gi, (all, args, at) => {
    if (literal.some(([a, b]) => at >= a && at < b)) return all;
    const parts = splitTop(args, ',');
    const target = parts.shift().trim();
    includes.add(target);
    if (stack.includes(target) || stack.length > 5) return '';
    const tsrc = ctx.source(target);
    if (tsrc == null) return `[[${target}]]`;
    const params = {};
    for (const p of parts) {
      const k = p.indexOf('=');
      if (k > 0) params[p.slice(0, k).trim()] = p.slice(k + 1).trim();
    }
    let body = stripComments(tsrc.replace(/\r\n?/g, '\n'));
    if (/^#(redirect|넘겨주기) /i.test(body)) return '';
    body = body.replace(/@([^@=\s]+)(?:=([^@\n]*))?@/g, (m, k, def) => params[k] ?? def ?? '');
    body = body.replace(/\[\[분류:[^\]]*\]\]/g, ''); // 틀의 분류는 가져오지 않는다
    return expandIncludes(body, ctx, [...stack, target], includes);
  });
}

// ── 진입점 ──
export function render(src, ctx, title = '') {
  src = String(src ?? '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const rd = /^#(?:redirect|넘겨주기) +(.+)$/i.exec(src.split('\n', 1)[0].trim());
  if (rd) return { redirect: rd[1].trim(), html: '', cats: [], links: new Set(), includes: new Set(), headings: [] };

  const includes = new Set();
  src = expandIncludes(stripComments(src), ctx, [title], includes);
  let min = 6;
  for (const l of src.split('\n')) {
    const m = HEAD_RE.exec(l);
    if (m) min = Math.min(min, m[1].length);
  }
  const st = {
    ctx, title, blocks,
    links: new Set(), cats: [],
    fnSeq: 0, fnNum: 0, fnNamed: new Map(), fnPending: [],
    headings: [], counters: [0, 0, 0, 0, 0, 0], minLevel: min, secStack: [],
  };
  let html = blocks(src, st, true) + '</div>'.repeat(st.secStack.length) + renderFootnotes(st);
  const toc = renderToc(st.headings);
  if (html.includes(TOC_MARK)) html = html.split(TOC_MARK).join(toc).replace(FIRST_HEAD, '');
  else html = html.replace(FIRST_HEAD, st.headings.length >= 2 ? toc : '');
  return { html, cats: [...new Set(st.cats)], links: st.links, includes, headings: st.headings };
}
