// 화면 공용 도우미: 그림 풀기, 어두운 테마 스타일, 알림
import * as C from './crypto.js?v=c8840afc3dfd';
import { W } from './store.js?v=c8840afc3dfd';

// 암호화된 그림 풀기 (방금 올린 사진은 내 브라우저에 있는 것을 바로 보여준다)
export function hydrate(root) {
  root.querySelectorAll('img[data-file]').forEach(img => {
    const name = img.dataset.file;
    const pending = W.pendingFiles[name];
    if (pending) { img.src = pending.url; return; }
    const f = W.data.files[name];
    if (!f) return;
    C.fileUrl(f).then(u => { img.src = u; }).catch(() => { img.alt = '그림을 불러오지 못했어요'; });
  });
  applyDarkStyles(root);
}

export function applyDarkStyles(root) {
  const dark = document.documentElement.dataset.theme === 'dark';
  root.querySelectorAll('[data-dark-style]').forEach(el => {
    if (el.dataset.lightStyle === undefined) el.dataset.lightStyle = el.getAttribute('style') || '';
    el.setAttribute('style', dark ? `${el.dataset.lightStyle};${el.dataset.darkStyle}` : el.dataset.lightStyle);
  });
}

let toastTimer = 0;
export function toast(msg, kind = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.className = 'toast show ' + kind;
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 6000 : 3500);
}
