// 계정 열쇠: 브라우저와 빌드 스크립트(Node)가 같이 쓴다. WebCrypto 만 사용.
//
//  · 회원마다 ECDH(P-256) 열쇠 쌍이 있다. 비밀 열쇠는 그 사람 비밀번호로 잠가 둔다.
//  · 빌드할 때마다 위키 데이터 열쇠(K)를 새로 만들고, 회원·초대마다 공개 열쇠로 따로 잠근다(slot).
//  · 로그인: 이름+비밀번호 → PBKDF2 → (비밀 열쇠를 여는 AES 열쇠, 열쇠 파일 이름)
const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const EC = { name: 'ECDH', namedCurve: 'P-256' };

export const randomBytes = n => globalThis.crypto.getRandomValues(new Uint8Array(n));
export const hex = u8 => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');

export function b64(u8) {
  u8 = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const b64url = u8 => b64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64url = s => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));

// 이름 비교 기준: 앞뒤 공백 제거, 한글 정규화, 영문 소문자
export const normName = name => String(name).trim().normalize('NFC').toLowerCase();

export const aesKey = (raw, usages = ['encrypt', 'decrypt']) => subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usages);

async function seal(key, data) {
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { iv: b64(iv), ct: b64(ct) };
}
const open = (key, box) => subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct));

// 이름+비밀번호 → 비밀 열쇠를 여는 AES 열쇠와 공개 열쇠 파일 이름(lookup)
export async function passKeys(name, password, iterations) {
  const salt = new Uint8Array(await subtle.digest('SHA-256', te.encode('blackwiki:user:' + normName(name))));
  const base = await subtle.importKey('raw', te.encode(String(password).normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 512));
  return { key: await aesKey(bits.slice(0, 32)), lookup: hex(bits.slice(32, 48)) };
}

export async function newKeyPair() {
  const kp = await subtle.generateKey(EC, true, ['deriveBits']);
  const jwk = await subtle.exportKey('jwk', kp.publicKey);
  return { privateKey: kp.privateKey, pub: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } };
}

// 비밀 열쇠를 AES 열쇠로 잠그기/열기 (pkcs8)
export async function sealPriv(privateKey, key) {
  return seal(key, await subtle.exportKey('pkcs8', privateKey));
}
export async function openPriv(box, key) {
  return importPriv(new Uint8Array(await open(key, box)));
}
export const importPriv = pkcs8 => subtle.importKey('pkcs8', pkcs8, EC, true, ['deriveBits']);
export const exportPriv = async privateKey => new Uint8Array(await subtle.exportKey('pkcs8', privateKey));

async function slotKey(myPriv, theirPub) {
  const shared = await subtle.deriveBits({ name: 'ECDH', public: theirPub }, myPriv, 256);
  const hk = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode('blackwiki-slot') },
    hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// 데이터 열쇠(raw 32바이트)를 회원 공개 열쇠로 잠근다 (빌드에서 사용)
export async function wrapFor(pub, rawK) {
  const them = await subtle.importKey('jwk', { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }, EC, false, []);
  const eph = await subtle.generateKey(EC, true, ['deriveBits']);
  const key = await slotKey(eph.privateKey, them);
  const jwk = await subtle.exportKey('jwk', eph.publicKey);
  return { epk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, ...(await seal(key, rawK)) };
}

// 내 비밀 열쇠로 데이터 열쇠를 꺼낸다 (브라우저에서 사용)
export async function unwrapSlot(slot, priv) {
  const eph = await subtle.importKey('jwk', slot.epk, EC, false, []);
  return new Uint8Array(await open(await slotKey(priv, eph), slot));
}
