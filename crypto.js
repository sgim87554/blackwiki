// 로그인과 복호화
//  · 이름+비밀번호 → 내 열쇠 파일(a/<lookup>.json) → 내 비밀 열쇠 → 이번 빌드의 데이터 열쇠 → data.bin
//  · 초대 링크 → 초대 열쇠 파일(a/<초대 id>.json) → 같은 방식
//  · '로그인 유지'는 비밀번호가 아니라 내 비밀 열쇠를 브라우저에 보관한다.
import * as K from './keys.js?v=c8840afc3dfd';

const SESSION = 'bw.session';
const JOIN_GRACE = 20 * 60 * 1000; // 가입 직후 내 열쇠 파일이 배포되기 전까지 초대 링크로 버틴다

let dataKey = null;
let dataBuf = null;
const fileCache = new Map();

export class AuthError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export async function loadMeta() {
  const r = await fetch('meta.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('meta.json ' + r.status);
  return r.json();
}

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}

async function gunzip(buf) {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

async function openData(rawK, meta) {
  const key = await K.aesKey(rawK, ['decrypt']);
  if (!dataBuf) {
    const r = await fetch('data.bin?v=' + encodeURIComponent(meta.build));
    if (!r.ok) throw new Error('data.bin ' + r.status);
    dataBuf = await r.arrayBuffer();
  }
  const u = new Uint8Array(dataBuf);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, key, u.slice(12));
  const data = JSON.parse(new TextDecoder().decode(await gunzip(plain)));
  dataKey = key;
  return data;
}

// ── 세션 (로그인 유지) ──
export function getSession() {
  try {
    const s = sessionStorage.getItem(SESSION) || localStorage.getItem(SESSION);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export function saveSession(s, remember) {
  try {
    if (remember === undefined) remember = !!localStorage.getItem(SESSION);
    const keep = remember ? localStorage : sessionStorage;
    const drop = remember ? sessionStorage : localStorage;
    keep.setItem(SESSION, JSON.stringify(s));
    drop.removeItem(SESSION);
  } catch { /* 저장소를 못 쓰면 이번 탭에서만 유지 */ }
}

export function forget() {
  try {
    localStorage.removeItem(SESSION);
    sessionStorage.removeItem(SESSION);
    localStorage.removeItem('bw.key'); // 예전 공용 비밀번호 방식의 흔적
  } catch { /* 무시 */ }
}

// ── 로그인 ──
export async function login(name, password, remember, meta) {
  const pk = await K.passKeys(name, password, meta.iter);
  const rec = await fetchJson(`a/${pk.lookup}.json?v=${meta.build}`);
  if (!rec || rec.t !== 'u') throw new AuthError('wrong');
  const priv = await K.openPriv(rec.priv, pk.key);
  const data = await openData(await K.unwrapSlot(rec.slot, priv), meta);
  const me = data.users.find(u => u.uid === rec.uid);
  if (!me) throw new AuthError('wrong');
  saveSession({ uid: me.uid, name: me.name, admin: me.admin, lookup: pk.lookup, priv: K.b64(await K.exportPriv(priv)) }, remember);
  return { data, me };
}

// 저장된 세션으로 다시 열기. 실패하면 null, 가입 직후라 아직 준비 중이면 { pending: true }.
export async function resume(meta) {
  const s = getSession();
  if (!s?.priv) return null;
  try {
    const priv = await K.importPriv(K.unb64(s.priv));
    for (const lookup of [s.lookup, s.oldLookup].filter(Boolean)) {
      const rec = await fetchJson(`a/${lookup}.json?v=${meta.build}`);
      if (!rec || rec.t !== 'u' || rec.uid !== s.uid) continue;
      const data = await openData(await K.unwrapSlot(rec.slot, priv), meta);
      const me = data.users.find(u => u.uid === s.uid);
      if (!me) break;
      if (lookup === s.lookup && (s.oldLookup || s.invite)) saveSession({ uid: s.uid, name: me.name, admin: me.admin, lookup: s.lookup, priv: s.priv });
      return { data, me };
    }
    // 방금 가입해서 내 열쇠 파일이 아직 배포되지 않았다면 초대 링크로 연다
    if (s.invite && Date.now() - s.joined < JOIN_GRACE) {
      try {
        const { data } = await openInvite(s.invite, meta, true);
        return { data, me: { uid: s.uid, name: s.name, admin: s.admin, created: new Date(s.joined).toISOString() } };
      } catch {
        return { pending: true };
      }
    }
  } catch { /* 아래에서 정리 */ }
  forget();
  return null;
}

// ── 초대 링크: #/join/<초대 id>.<비밀값> ──
export async function openInvite(code, meta, used = false) {
  const [iid, secret] = String(code).split('.');
  if (!/^[0-9a-f]{16,32}$/.test(iid || '') || !secret) throw new AuthError('bad-invite');
  const rec = await fetchJson(`a/${iid}.json?v=${meta.build}`);
  if (!rec || rec.t !== 'i') throw new AuthError('used-invite');
  let priv;
  try {
    priv = await K.openPriv(rec.priv, await K.aesKey(K.unb64url(secret), ['decrypt']));
  } catch {
    throw new AuthError('bad-invite');
  }
  const data = await openData(await K.unwrapSlot(rec.slot, priv), meta);
  const invite = data.invites.find(i => i.iid === iid);
  if (!invite && !used) throw new AuthError('used-invite');
  return { data, invite };
}

// 암호화된 그림 파일을 풀어서 blob: 주소로 돌려준다
export function fileUrl(f) {
  if (!fileCache.has(f.id)) {
    fileCache.set(f.id, (async () => {
      const r = await fetch('f/' + f.id + '.bin');
      if (!r.ok) throw new Error('file ' + r.status);
      const u = new Uint8Array(await r.arrayBuffer());
      const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, dataKey, u.slice(12));
      return URL.createObjectURL(new Blob([buf], { type: f.type }));
    })());
  }
  return fileCache.get(f.id);
}
