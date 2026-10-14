// 위키 안 편집기: 왼쪽 원문, 오른쪽 실시간 미리보기. 저장하면 GitHub에 바로 커밋된다.
import { W, renderSrc, splitNs, titleToPath, badTitle, localEdit, href, docHref, urls } from './store.js?v=c8840afc3dfd';
import * as G from './github.js?v=c8840afc3dfd';
import { esc } from './util.js?v=c8840afc3dfd';
import { icon } from './icons.js?v=c8840afc3dfd';
import { hydrate, toast } from './ui.js?v=c8840afc3dfd';
import { btn, newTemplate } from './views.js?v=c8840afc3dfd';

const MAX_SIDE = 1600; // 사진 긴 변 최대 픽셀

// app.js 가 페이지를 떠날 때 확인하는 상태
export const editor = { dirty: false, hash: '' };

const TOOLBAR = [
  [['bold', '<b>B</b>', '굵게 (Ctrl+B)'], ['italic', '<i>I</i>', '기울임 (Ctrl+I)'], ['underline', '<u>U</u>', '밑줄 (Ctrl+U)'], ['strike', '<s>S</s>', '취소선']],
  [['heading', '문단', '문단 제목'], ['link', '링크', '문서 링크 (Ctrl+K)'], ['footnote', '각주', '각주']],
  [['ul', '• 목록', '목록'], ['ol', '1. 목록', '번호 목록'], ['quote', '인용', '인용'], ['table', '표', '표']],
  [['big', '크게', '글자 크게'], ['small', '작게', '글자 작게'], ['color', '색', '글자 색'], ['fold', '접기', '접기 상자']],
  [['category', '분류', '분류 넣기'], ['photo', icon('image') + '사진', '사진 올리기 (끌어다 놓기·붙여넣기도 돼요)']],
];

const toolbarHtml = () => TOOLBAR.map(group => `<div class="tb-group">${group.map(([id, label, title]) =>
  id === 'color'
    ? `<label class="tb tb-color" title="${title}"><span>색</span><input type="color" id="ed-color" value="#e11d48" aria-label="글자 색"></label>`
    : `<button type="button" class="tb${id === 'photo' ? ' tb-photo' : ''}" data-t="${id}" title="${title}">${label}</button>`).join('')}</div>`).join('') +
  `<a class="tb tb-help" href="${docHref('블랙위키:문법 도움말')}" target="_blank" rel="noopener" title="문법 도움말 (새 탭)">${icon('help')}</a>`;

export function editView(title) {
  const d = W.data.docs[title];
  const back = docHref(title);
  if (!G.canEdit()) {
    const gh = d ? urls.edit(d.path) : urls.create(title, newTemplate(title));
    return {
      title, sub: '편집',
      body: `<div class="notice">위키 안 편집이 아직 설정되지 않았어요. 관리자가 편집 토큰을 등록하면 여기서 바로 고칠 수 있어요.</div>
        ${btn(gh, 'external', 'GitHub에서 편집', { primary: true, ext: true })}`,
    };
  }
  const bad = badTitle(title);
  const actions = d
    ? `<button type="button" class="btn" id="ed-rename">${icon('edit')}<span>이름 바꾸기</span></button>
       <button type="button" class="btn danger" id="ed-delete">${icon('trash')}<span>삭제</span></button>`
    : '';
  return {
    title, sub: d ? '편집' : '새 문서', wide: true, actions,
    body: `${bad ? `<div class="notice error">${esc(bad)}</div>` : ''}
      <div class="editor">
        <div class="ed-toolbar" role="toolbar" aria-label="문법 도구">${toolbarHtml()}</div>
        <div class="ed-tabs" role="tablist">
          <button type="button" data-tab="src" class="active">편집</button>
          <button type="button" data-tab="prev">미리보기</button>
        </div>
        <div class="ed-panes" data-show="src">
          <div class="ed-src">
            <textarea id="ed-text" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="문서 내용"></textarea>
            <div class="ed-drop">${icon('upload')}여기에 놓으면 사진이 올라가요</div>
          </div>
          <div class="ed-prev" aria-label="미리보기"><div class="wiki" id="ed-preview"></div></div>
        </div>
        <div class="ed-foot">
          <input id="ed-summary" class="field sm grow" maxlength="100" placeholder="무엇을 고쳤나요? (선택)" aria-label="편집 요약">
          <div class="ed-buttons">
            <a class="btn" href="${back}">취소</a>
            <button type="button" class="btn primary" id="ed-save">${icon('check')}<span>저장</span></button>
          </div>
        </div>
        <div class="ed-status" id="ed-status" role="status"></div>
      </div>
      <input type="file" id="ed-file" accept="image/*" multiple hidden>`,
    mount: root => mount(root, title, bad),
  };
}

function mount(root, title, bad) {
  const $ = s => root.querySelector(s);
  const ta = $('#ed-text'), prev = $('#ed-preview'), prevPane = $('.ed-prev'), panes = $('.ed-panes');
  const summary = $('#ed-summary'), statusEl = $('#ed-status'), fileIn = $('#ed-file');
  const doc = W.data.docs[title];
  const st = { isNew: !doc, path: doc?.path || titleToPath(title), sha: null, original: doc ? doc.src : newTemplate(title) };

  ta.value = st.original;
  editor.dirty = false;
  editor.hash = location.hash;

  const status = (msg, error = false) => { statusEl.textContent = msg; statusEl.classList.toggle('error', error); };
  const busy = on => root.querySelectorAll('#ed-save, #ed-rename, #ed-delete, .tb').forEach(b => { b.disabled = on; });

  // ── 미리보기 ──
  let timer = 0;
  const draw = () => {
    const r = renderSrc(ta.value, title);
    prev.innerHTML = r.redirect
      ? `<div class="notice">넘겨주기 문서예요. 열면 <b>${esc(r.redirect)}</b> 문서로 넘어가요.</div>`
      : (r.cats.length ? `<div class="cat-box"><b>분류</b>${r.cats.map(esc).join('<span class="sep">·</span>')}</div>` : '') + r.html;
    hydrate(prev);
  };
  const changed = () => {
    editor.dirty = ta.value !== st.original;
    clearTimeout(timer);
    timer = setTimeout(draw, 120);
  };
  ta.addEventListener('input', changed);
  draw();
  // 미리보기 안의 링크를 누르면 편집 중인 페이지를 떠나지 않도록 막는다
  prev.addEventListener('click', e => { if (e.target.closest('a[href]')) e.preventDefault(); });
  ta.addEventListener('scroll', () => {
    const max = ta.scrollHeight - ta.clientHeight;
    if (max > 0) prevPane.scrollTop = (ta.scrollTop / max) * (prevPane.scrollHeight - prevPane.clientHeight);
  });

  // 휴대폰: 편집/미리보기 탭
  root.querySelectorAll('.ed-tabs button').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('.ed-tabs button').forEach(x => x.classList.toggle('active', x === b));
    panes.dataset.show = b.dataset.tab;
    if (b.dataset.tab === 'prev') draw();
  }));

  // ── 최신 내용 확인 (위키 데이터는 몇 분 늦을 수 있다) ──
  status('저장소의 최신 내용을 확인하는 중…');
  G.getText(st.path).then(f => {
    if (!f) {
      st.sha = null;
      status(st.isNew ? '' : '저장소에서 이 문서를 찾지 못했어요. 저장하면 새로 만들어져요.');
      st.isNew = true;
      return;
    }
    st.sha = f.sha;
    if (f.text === st.original) { status(''); return; }
    if (!editor.dirty) {
      ta.value = st.original = f.text;
      st.isNew = false;
      draw();
      status('누군가 방금 고친 최신 내용을 불러왔어요.');
    } else {
      status('편집하는 사이에 다른 사람이 이 문서를 고쳤어요. 저장할 때 어떻게 할지 물어볼게요.');
    }
  }).catch(e => status(e.friendly || String(e), true));

  // ── 글 넣기 ──
  function insert(text, selA, selB) {
    ta.focus();
    const start = ta.selectionStart;
    // execCommand 는 되돌리기(Ctrl+Z) 기록을 유지한다
    if (!document.execCommand('insertText', false, text)) ta.setRangeText(text, start, ta.selectionEnd, 'end');
    if (selA != null) ta.setSelectionRange(start + selA, start + selB);
    changed();
  }
  const selected = () => ta.value.slice(ta.selectionStart, ta.selectionEnd);
  function ownLine() {
    const v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    return [a > 0 && v[a - 1] !== '\n' ? '\n' : '', b < v.length && v[b] !== '\n' ? '\n' : ''];
  }
  function wrap(before, after, ph) {
    const inner = selected() || ph;
    insert(before + inner + after, before.length, before.length + inner.length);
  }
  function line(before, after, ph) {
    const inner = selected() || ph;
    const [pre, post] = ownLine();
    insert(pre + before + inner + after + post, pre.length + before.length, pre.length + before.length + inner.length);
  }
  function block(text, selA = text.length, selB = text.length) {
    const [pre, post] = ownLine();
    insert(pre + text + post, pre.length + selA, pre.length + selB);
  }
  function prefix(p) {
    const v = ta.value;
    const a = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    let b = v.indexOf('\n', ta.selectionEnd);
    if (b < 0) b = v.length;
    ta.setSelectionRange(a, b);
    const t = v.slice(a, b).split('\n').map(l => p + l).join('\n');
    insert(t, t.length, t.length);
  }

  const T = {
    bold: () => wrap("'''", "'''", '굵은 글씨'),
    italic: () => wrap("''", "''", '기울임'),
    underline: () => wrap('__', '__', '밑줄'),
    strike: () => wrap('~~', '~~', '취소선'),
    heading: () => line('== ', ' ==', '문단 제목'),
    link: () => wrap('[[', ']]', '문서 제목'),
    footnote: () => wrap('[* ', ']', '각주 내용'),
    ul: () => prefix(' * '),
    ol: () => prefix(' 1. '),
    quote: () => prefix('> '),
    table: () => block("||<:> '''제목''' ||<:> '''제목''' ||\n|| 내용 || 내용 ||", 9, 11),
    big: () => wrap('{{{+1 ', '}}}', '큰 글씨'),
    small: () => wrap('{{{-1 ', '}}}', '작은 글씨'),
    fold: () => {
      const inner = selected() || '접을 내용';
      const [pre, post] = ownLine();
      const head = '{{{#!folding [ 펼치기 ]\n';
      insert(pre + head + inner + '\n}}}' + post, pre.length + head.length, pre.length + head.length + inner.length);
    },
    category: () => block('[[분류:친구]]', 5, 7),
    photo: () => fileIn.click(),
  };
  root.querySelector('.ed-toolbar').addEventListener('click', e => {
    const b = e.target.closest('button[data-t]');
    if (b) T[b.dataset.t]();
  });
  $('#ed-color').addEventListener('change', e => wrap(`{{{${e.target.value} `, '}}}', '색 글씨'));

  ta.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.isComposing) return;
    const k = e.key.toLowerCase();
    const map = { b: 'bold', i: 'italic', u: 'underline', k: 'link' };
    if (map[k]) { e.preventDefault(); T[map[k]](); }
  });
  // root(본문 칸)는 화면이 바뀌어도 남아 있으므로, 매번 새로 그려지는 .editor 에 단다
  $('.editor').addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  });

  // 편집 기록에는 로그인한 계정 이름이 남는다
  const nick = () => W.me.name;

  // ── 저장 ──
  async function save() {
    if (bad) { status(bad, true); return; }
    const who = nick();
    if (!who) return;
    const text = ta.value.replace(/\r\n?/g, '\n');
    if (!st.isNew && st.sha && text === st.original) { status('바뀐 내용이 없어요.'); return; }
    const msg = summary.value.trim() || `${title} ${st.isNew ? '새 문서' : '수정'}`;
    busy(true);
    status('저장하는 중…');
    try {
      let r;
      try {
        r = await G.putText(st.path, text, st.sha, msg, who);
      } catch (e) {
        if (!e.conflict) throw e;
        const latest = await G.getText(st.path);
        if (!confirm('다른 사람이 먼저 이 문서를 고쳤어요.\n\n[확인] 내 내용으로 덮어쓰기 (상대 내용은 역사에 남아요)\n[취소] 저장하지 않기 (내 내용은 편집창에 그대로 있어요)')) {
          status('저장하지 않았어요. 문서 역사에서 다른 사람이 고친 내용을 확인해 보세요.');
          return;
        }
        r = await G.putText(st.path, text, latest?.sha ?? null, msg, who);
      }
      localEdit({ title, src: text, path: st.path, author: who, msg, sha: r.commit.sha, status: st.isNew ? 'A' : 'M' });
      editor.dirty = false;
      toast('저장했어요. 다른 사람에게는 1~2분 뒤에 보여요.');
      location.hash = docHref(title);
    } catch (e) {
      status(e.friendly || String(e), true);
    } finally {
      busy(false);
    }
  }
  $('#ed-save').addEventListener('click', save);

  // ── 삭제 ──
  $('#ed-delete')?.addEventListener('click', async () => {
    const who = nick();
    if (!who) return;
    if (!confirm(`'${title}' 문서를 지울까요?\n지운 문서도 역사에 기록이 남아서 되살릴 수 있어요.`)) return;
    busy(true);
    status('지우는 중…');
    try {
      const cur = await G.getText(st.path);
      const msg = `${title} 삭제`;
      if (cur) {
        const r = await G.remove(st.path, cur.sha, msg, who);
        localEdit({ title, src: null, path: st.path, author: who, msg, sha: r.commit.sha, status: 'D' });
      }
      editor.dirty = false;
      toast('문서를 지웠어요.');
      location.hash = docHref(title);
    } catch (e) {
      status(e.friendly || String(e), true);
    } finally {
      busy(false);
    }
  });

  // ── 이름 바꾸기 ──
  $('#ed-rename')?.addEventListener('click', async () => {
    const who = nick();
    if (!who) return;
    if (editor.dirty && !confirm('저장하지 않은 내용은 버리고, 저장된 내용으로 이름을 바꿔요. 계속할까요?')) return;
    const to = (prompt('새 제목을 적어 주세요.', title) || '').trim().normalize('NFC');
    if (!to || to === title) return;
    const err = badTitle(to);
    if (err) { status(err, true); return; }
    if (W.data.docs[to]) { status(`'${to}' 문서가 이미 있어요.`, true); return; }
    const keep = confirm(`옛 제목 '${title}'에 '${to}'(으)로 넘겨주는 문서를 남길까요?\n\n[확인] 남기기 (추천: 다른 문서의 링크가 끊기지 않아요)\n[취소] 남기지 않고 옛 제목은 지우기`);
    busy(true);
    status('이름을 바꾸는 중…');
    try {
      const cur = await G.getText(st.path);
      if (!cur) throw new Error('저장소에서 이 문서를 찾지 못했어요.');
      const newPath = titleToPath(to);
      if (await G.getText(newPath)) throw new Error(`'${to}' 문서가 이미 있어요.`);
      const msg = `${title} → ${to} 이름 바꿈`;
      const r1 = await G.putText(newPath, cur.text, null, msg, who);
      localEdit({ title: to, src: cur.text, path: newPath, author: who, msg, sha: r1.commit.sha, status: 'A' });
      if (keep) {
        const red = `#redirect ${to}\n`;
        const r2 = await G.putText(st.path, red, cur.sha, msg, who);
        localEdit({ title, src: red, path: st.path, author: who, msg, sha: r2.commit.sha, status: 'M' });
      } else {
        const r2 = await G.remove(st.path, cur.sha, msg, who);
        localEdit({ title, src: null, path: st.path, author: who, msg, sha: r2.commit.sha, status: 'D' });
      }
      editor.dirty = false;
      toast('이름을 바꿨어요.');
      location.hash = docHref(to);
    } catch (e) {
      status(e.friendly || e.message || String(e), true);
    } finally {
      busy(false);
    }
  });

  // ── 사진 올리기: 버튼, 끌어다 놓기, 붙여넣기 ──
  fileIn.addEventListener('change', () => { upload(fileIn.files); fileIn.value = ''; });
  const src = $('.ed-src');
  src.addEventListener('dragover', e => {
    if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); src.classList.add('dragging'); }
  });
  src.addEventListener('dragleave', e => { if (!src.contains(e.relatedTarget)) src.classList.remove('dragging'); });
  src.addEventListener('drop', e => {
    src.classList.remove('dragging');
    if (e.dataTransfer.files.length) { e.preventDefault(); upload(e.dataTransfer.files); }
  });
  ta.addEventListener('paste', e => {
    const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); upload(files); }
  });

  async function upload(files) {
    const list = [...files].filter(f => f.type.startsWith('image/'));
    if (!list.length) { status('사진 파일만 올릴 수 있어요.', true); return; }
    const who = nick();
    if (!who) return;
    busy(true);
    let done = 0;
    try {
      for (const f of list) {
        status(`사진 올리는 중… (${done + 1}/${list.length})`);
        const { blob, ext } = await shrink(f);
        if (blob.size > 20 * 1024 * 1024) { status(`${f.name}: 사진이 너무 커요. (20MB 이하만)`, true); continue; }
        const name = fileName(f, ext);
        await G.putBytes('files/' + name, new Uint8Array(await blob.arrayBuffer()), `사진 올림: ${name}`, who);
        W.pendingFiles[name] = { url: URL.createObjectURL(blob), type: blob.type, size: blob.size };
        W.cache.clear();
        block(`[[파일:${name}]]`);
        done++;
      }
      if (done) status(`사진 ${done}장을 올렸어요. 문서를 저장해야 사진이 문서에 들어가요.`);
    } catch (e) {
      status(e.friendly || e.message || '사진을 올리지 못했어요.', true);
    } finally {
      busy(false);
    }
  }
}

// 큰 사진은 줄이고, 위치 정보(EXIF)가 남지 않도록 새로 저장한다
async function shrink(file) {
  if (file.type === 'image/gif') return { blob: file, ext: 'gif' };
  if (file.type === 'image/svg+xml') return { blob: file, ext: 'svg' };
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name}: 이 형식은 올릴 수 없어요. (아이폰 HEIC 사진은 JPG로 바꿔서 올려 주세요)`);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const encode = (type, q) => new Promise(res => canvas.toBlob(res, type, q));
  const webp = await encode('image/webp', 0.86);
  if (webp && webp.type === 'image/webp') return { blob: webp, ext: 'webp' };
  // WebP 로 저장 못 하는 브라우저는 JPG (투명한 부분은 흰색)
  g.globalCompositeOperation = 'destination-over';
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  return { blob: await encode('image/jpeg', 0.86), ext: 'jpg' };
}

function fileName(file, ext) {
  const pad = n => String(n).padStart(2, '0');
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  let base = (file.name || '').replace(/\.[^.]+$/, '').normalize('NFC')
    .replace(/[\\/:*?"<>|#[\]{}&%]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!base || /^image$/i.test(base)) base = '사진-' + stamp;
  let name = `${base}.${ext}`;
  for (let n = 2; W.data.files[name] || W.pendingFiles[name]; n++) name = `${base}-${n}.${ext}`;
  return name;
}
