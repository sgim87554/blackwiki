// 공용 도우미
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

// 색 값 검증: #hex, hex, 이름(red) 만 허용
export function color(v) {
  v = String(v ?? '').trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return v.toLowerCase();
  if (/^([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return '#' + v.toLowerCase();
  if (/^#?[a-z]{3,20}$/i.test(v)) return v.replace('#', '').toLowerCase();
  return null;
}

// "밝을때,어두울때" 색 쌍
export function colorPair(v) {
  const [a, b] = String(v ?? '').split(',');
  return [color(a), b === undefined ? null : color(b)];
}

// 대략적인 밝기 (0~1). hex가 아니면 null
export function lum(c) {
  if (c === 'black') return 0;
  if (c === 'white') return 1;
  let m = /^#([0-9a-f]{3,8})$/i.exec(c || '');
  if (!m) return null;
  let h = m[1];
  if (h.length <= 4) h = [...h.slice(0, 3)].map(x => x + x).join('');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function size(v) {
  const m = /^(\d+(?:\.\d+)?)(px|%|em|rem|vw)?$/.exec(String(v ?? '').trim());
  return m ? m[1] + (m[2] || 'px') : null;
}

// 문서에 쓰인 style 속성에서 위험한 것은 버린다
export function safeCss(v) {
  v = String(v ?? '').trim();
  if (!v || /url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:|-moz-binding|position\s*:\s*(fixed|sticky)|[<>\\]/i.test(v)) return '';
  return v;
}

const pad = n => String(n).padStart(2, '0');
export function fmtDate(d) {
  d = new Date(d);
  if (isNaN(d)) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function relTime(d) {
  const s = (Date.now() - new Date(d)) / 1000;
  if (isNaN(s)) return '';
  if (s < 60) return '방금 전';
  if (s < 3600) return Math.floor(s / 60) + '분 전';
  if (s < 86400) return Math.floor(s / 3600) + '시간 전';
  if (s < 86400 * 30) return Math.floor(s / 86400) + '일 전';
  return fmtDate(d).slice(0, 10);
}

export function parseDate(v) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(v ?? '').trim());
  return m ? new Date(+m[1], m[2] - 1, +m[3]) : null;
}

export function fmtSize(n) {
  if (n < 1024) return n + 'B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB';
  return (n / 1024 / 1024).toFixed(1) + 'MB';
}

// 가나다 묶음용 첫 글자 (ㄲ→ㄱ 처럼 된소리는 예사소리로)
const CHO = 'ㄱㄱㄴㄷㄷㄹㅁㅂㅂㅅㅅㅇㅈㅈㅊㅋㅌㅍㅎ';
export function initial(s) {
  const c = String(s).charCodeAt(0);
  if (c >= 0xac00 && c <= 0xd7a3) return CHO[Math.floor((c - 0xac00) / 588)];
  const ch = String(s)[0] || '';
  if (/[a-z]/i.test(ch)) return ch.toUpperCase();
  if (/[0-9]/.test(ch)) return '0-9';
  return '기타';
}
