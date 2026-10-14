// 위키 안 편집: GitHub Contents API로 문서·사진을 저장소에 바로 커밋한다.
// 편집 토큰은 암호화된 위키 데이터 안에 들어 있어서 비밀번호를 아는 사람만 쓸 수 있다.
import { W } from './store.js?v=c8840afc3dfd';

const API = 'https://api.github.com';
const EMAIL = 'editor@blackwiki.invalid';

export const canEdit = () => !!W.site?.editToken;

const enc = encodeURIComponent;
const encPath = p => p.split('/').map(enc).join('/');
const fileUrl = p => `${API}/repos/${enc(W.site.repo.owner)}/${enc(W.site.repo.name)}/contents/${encPath(p)}`;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
  get conflict() {
    return this.status === 409 || (this.status === 422 && /sha/i.test(this.message));
  }
  get friendly() {
    if (this.status === 0) return '인터넷 연결을 확인해 주세요.';
    if (this.status === 401) return '편집 열쇠(토큰)가 만료됐거나 잘못됐어요. 위키 관리자에게 알려 주세요.';
    if (this.status === 403) return '편집 권한이 없거나 잠시 요청이 너무 많았어요. 조금 뒤 다시 시도해 주세요.';
    if (this.conflict) return '다른 사람이 먼저 이 문서를 고쳤어요.';
    return `저장하지 못했어요. (${this.status} ${this.message})`;
  }
}

async function call(method, url, body) {
  let r;
  try {
    r = await fetch(url, {
      method,
      cache: 'no-store',
      headers: {
        Authorization: 'Bearer ' + W.site.editToken,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new ApiError(r.status, j.message || r.statusText);
  }
  return r.status === 204 ? null : r.json();
}

function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromB64 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));

// 저장소의 최신 내용. 없으면 null.
export async function getText(path) {
  try {
    const j = await call('GET', fileUrl(path) + '?ref=' + enc(W.site.repo.branch));
    return { sha: j.sha, text: fromB64(j.content || '') };
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

function put(path, content, sha, message, nick) {
  return call('PUT', fileUrl(path), {
    message, content, branch: W.site.repo.branch,
    ...(sha ? { sha } : {}),
    author: { name: nick, email: EMAIL },
  });
}

export const putText = (path, text, sha, message, nick) => put(path, toB64(new TextEncoder().encode(text)), sha, message, nick);
export const putBytes = (path, u8, message, nick) => put(path, toB64(u8), null, message, nick);

export function remove(path, sha, message, nick) {
  return call('DELETE', fileUrl(path), {
    message, sha, branch: W.site.repo.branch,
    author: { name: nick, email: EMAIL },
  });
}
