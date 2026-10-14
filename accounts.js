// 계정: 초대 링크로 가입, 관리 페이지(초대·회원), 비밀번호 바꾸기
// 계정 파일은 비공개 저장소의 accounts/ 에 커밋되고, 다음 빌드부터 로그인에 쓰인다.
import { W, setData, collator } from './store.js?v=c8840afc3dfd';
import * as G from './github.js?v=c8840afc3dfd';
import * as C from './crypto.js?v=c8840afc3dfd';
import * as K from './keys.js?v=c8840afc3dfd';
import { esc, fmtDate } from './util.js?v=c8840afc3dfd';
import { icon } from './icons.js?v=c8840afc3dfd';
import { toast } from './ui.js?v=c8840afc3dfd';

const INVITE_DAYS = 7;
const MIN_PW = 10;
const userPath = uid => `accounts/users/${uid}.json`;
const invitePath = iid => `accounts/invites/${iid}.json`;
const json = o => JSON.stringify(o, null, 2) + '\n';
const MARK = '<svg class="mark lock-mark" viewBox="0 0 32 32" aria-hidden="true"><rect class="mark-bg" width="32" height="32" rx="8"/><rect class="mark-fg" x="8" y="9" width="16" height="3" rx="1.5"/><rect class="mark-fg" x="8" y="14.5" width="11" height="3" rx="1.5"/><rect class="mark-fg" x="8" y="20" width="6" height="3" rx="1.5"/></svg>';

function nameProblem(name, selfUid = '') {
  const n = name.trim();
  if (n.length < 2 || n.length > 20) return '이름은 2~20자로 정해 주세요.';
  if (/[\\/:*?"<>|#[\]{}@]/.test(n)) return '이름에 \\ / : * ? " < > | # [ ] { } @ 는 쓸 수 없어요.';
  if (W.data.users.some(u => u.uid !== selfUid && K.normName(u.name) === K.normName(n))) return '이미 있는 이름이에요. 다른 이름을 정해 주세요.';
  return '';
}

function pwProblem(pw, pw2) {
  if (pw.length < MIN_PW) return `비밀번호는 ${MIN_PW}자 이상으로 정해 주세요. 단어 몇 개를 이으면 기억하기 쉬워요.`;
  if (pw !== pw2) return '두 번 입력한 비밀번호가 달라요.';
  return '';
}

const errText = e => e?.friendly || e?.message || String(e);

// ── 가입 (초대 링크) ──
const INVITE_ERR = {
  'bad-invite': '초대 링크가 올바르지 않아요. 링크를 끝까지 복사했는지 확인해 주세요.',
  'used-invite': '이미 사용했거나 기한이 지난 초대 링크예요. 방금 받은 링크라면 1~2분 뒤에 다시 열어 주세요.',
};

export async function showJoin(code, meta, start) {
  const box = document.createElement('main');
  box.className = 'lock';
  document.body.appendChild(box);
  const card = inner => { box.innerHTML = `<div class="lock-card">${MARK}<h1>${esc(meta.name)}</h1>${inner}</div>`; };
  card('<p>초대 링크를 확인하는 중…</p>');

  let opened;
  try {
    opened = await C.openInvite(code, meta);
  } catch (e) {
    card(`<p>${esc(INVITE_ERR[e.code] || '초대 링크를 열지 못했어요. 잠시 뒤 다시 시도해 주세요.')}</p>
      <a class="btn btn-block" href="${location.pathname}#/">로그인 화면으로</a>`);
    box.querySelector('a').addEventListener('click', () => setTimeout(() => location.reload(), 0));
    return;
  }
  const { data, invite } = opened;
  setData(data);

  box.innerHTML = `<form class="lock-card" id="join-form">${MARK}
    <h1>${esc(meta.name)}에 오신 걸 환영해요</h1>
    <p>${invite.note ? `<b>${esc(invite.note)}</b>, ` : ''}위키에서 쓸 이름과 비밀번호를 정해 주세요.${invite.admin ? '<br><b>관리자</b> 계정으로 만들어져요.' : ''}</p>
    <div class="fields">
      <input class="field" id="j-name" placeholder="이름 (편집 기록에 남아요)" autocomplete="username" maxlength="20" required>
      <input class="field" id="j-pw" type="password" placeholder="비밀번호 (${MIN_PW}자 이상)" autocomplete="new-password" required>
      <input class="field" id="j-pw2" type="password" placeholder="비밀번호 확인" autocomplete="new-password" required>
    </div>
    <label class="check"><input id="j-remember" type="checkbox" checked> 이 기기에서 로그인 유지</label>
    <button class="btn primary btn-block" type="submit">가입하기</button>
    <div class="lock-err" role="alert"></div>
    <p class="lock-foot">비밀번호는 아무도 다시 찾아 줄 수 없어요. 잊어버리면 관리자에게 새 초대 링크를 받아야 해요.</p>
  </form>`;
  const form = box.querySelector('form');
  const err = box.querySelector('.lock-err');
  const btn = form.querySelector('button');
  form.querySelector('#j-name').focus();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (btn.disabled) return;
    const name = form.querySelector('#j-name').value.trim().normalize('NFC');
    const pw = form.querySelector('#j-pw').value;
    const problem = nameProblem(name) || pwProblem(pw, form.querySelector('#j-pw2').value);
    if (problem) { err.textContent = problem; return; }
    btn.disabled = true;
    btn.textContent = '계정 만드는 중…';
    err.textContent = '';
    try {
      const pk = await K.passKeys(name, pw, meta.iter);
      const kp = await K.newKeyPair();
      const uid = K.hex(K.randomBytes(8));
      const rec = {
        uid, name, admin: !!invite.admin, created: new Date().toISOString(), invite: invite.iid,
        lookup: pk.lookup, pub: kp.pub, priv: await K.sealPriv(kp.privateKey, pk.key),
      };
      await G.putText(userPath(uid), json(rec), null, `회원 가입: ${name}`, name);
      try {
        const cur = await G.getText(invitePath(invite.iid));
        if (cur) await G.remove(invitePath(invite.iid), cur.sha, `초대 사용: ${name}`, name);
      } catch { /* 빌드도 사용한 초대는 버린다 */ }
      C.saveSession({
        uid, name, admin: rec.admin, lookup: pk.lookup, priv: K.b64(await K.exportPriv(kp.privateKey)),
        joined: Date.now(), invite: code,
      }, form.querySelector('#j-remember').checked);
      const me = { uid, name, admin: rec.admin, created: rec.created };
      data.users.push(me);
      data.invites = data.invites.filter(i => i.iid !== invite.iid);
      box.remove();
      history.replaceState(null, '', location.pathname + '#/');
      start(data, me);
      toast(`가입했어요, ${name}님! 다른 기기에서는 1~2분 뒤부터 로그인할 수 있어요.`);
    } catch (x) {
      err.textContent = errText(x);
      btn.disabled = false;
      btn.textContent = '가입하기';
    }
  });
}

// ── 관리 ──
let lastLink = '';
const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

async function createInvite(note, admin) {
  const kp = await K.newKeyPair();
  const secret = K.randomBytes(32);
  const iid = K.hex(K.randomBytes(12));
  const now = new Date();
  const rec = {
    iid, note, admin, by: W.me.uid,
    created: now.toISOString(), expires: new Date(+now + INVITE_DAYS * 864e5).toISOString(),
    pub: kp.pub, priv: await K.sealPriv(kp.privateKey, await K.aesKey(secret)),
  };
  await G.putText(invitePath(iid), json(rec), null, `초대 만듦${note ? ': ' + note : ''}`, W.me.name);
  W.data.invites.push({ iid, note, admin, by: W.me.uid, created: rec.created, expires: rec.expires });
  return `${location.origin}${location.pathname}#/join/${iid}.${K.b64url(secret)}`;
}

export function adminView() {
  if (!W.me?.admin) return { title: '관리', body: '<p class="empty">관리자만 볼 수 있어요.</p>' };
  const users = [...W.data.users].sort((a, b) => collator.compare(a.name, b.name));
  const invites = [...W.data.invites].sort((a, b) => b.created.localeCompare(a.created));
  const inviteRows = invites.map(i => `<li class="row">
      <div class="row-main"><b>${esc(i.note || '메모 없음')}</b>${i.admin ? '<span class="badge">관리자</span>' : ''}
        <button type="button" class="btn sm danger row-act" data-cancel="${esc(i.iid)}">취소</button></div>
      <div class="row-sub">만든 날 ${esc(fmtDate(i.created))} · 만료 ${esc(fmtDate(i.expires))}</div></li>`).join('');
  const userRows = users.map(u => `<li class="row">
      <div class="row-main"><b>${esc(u.name)}</b>${u.admin ? '<span class="badge">관리자</span>' : ''}${u.uid === W.me.uid
        ? '<span class="badge new">나</span>'
        : `<button type="button" class="btn sm danger row-act" data-remove="${esc(u.uid)}" data-name="${esc(u.name)}">내보내기</button>`}</div>
      <div class="row-sub">가입 ${esc(fmtDate(u.created))}</div></li>`).join('');
  const body = `<div class="admin">
    <section>
      <h2 class="sec-title first">초대 링크 만들기</h2>
      <p class="desc">링크는 <b>한 번만</b> 쓸 수 있고 ${INVITE_DAYS}일 뒤 만료돼요. 만든 뒤 1~2분이 지나야 열려요.</p>
      <div class="inline-form">
        <input class="field sm grow" id="inv-note" maxlength="30" placeholder="누구에게 보낼 건가요? (메모, 선택)">
        <label class="check inline"><input type="checkbox" id="inv-admin"> 관리자로 초대</label>
        <button type="button" class="btn primary" id="inv-make">${icon('plus')}<span>링크 만들기</span></button>
      </div>
      ${lastLink ? `<div class="invite-box">
        <input class="field sm grow" id="inv-link" readonly value="${esc(lastLink)}" aria-label="초대 링크">
        <button type="button" class="btn" id="inv-copy">복사</button>
      </div>
      <p class="desc">이 링크는 이 화면에서만 볼 수 있어요. 받을 사람에게만 보내 주세요. 잃어버리면 취소하고 새로 만들면 돼요.</p>` : ''}
    </section>
    <section>
      <h2 class="sec-title">기다리는 초대 <span class="count">${invites.length}</span></h2>
      ${invites.length ? `<ul class="rows">${inviteRows}</ul>` : '<p class="desc">기다리는 초대가 없어요.</p>'}
    </section>
    <section>
      <h2 class="sec-title">회원 <span class="count">${users.length}</span></h2>
      <ul class="rows">${userRows}</ul>
      <p class="desc">내보낸 회원은 다음 배포(1~2분 뒤)부터 위키를 열 수 없어요. 믿을 수 없는 사람을 내보냈다면 편집 토큰도 새로 바꿔 주세요.</p>
    </section></div>`;
  return { title: '관리', body, mount: mountAdmin };
}

function mountAdmin(root) {
  const status = msg => toast(msg, 'error');
  root.querySelector('#inv-make').addEventListener('click', async e => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      lastLink = await createInvite(root.querySelector('#inv-note').value.trim(), root.querySelector('#inv-admin').checked);
      rerender();
      toast('초대 링크를 만들었어요.');
    } catch (x) {
      status(errText(x));
      b.disabled = false;
    }
  });
  root.querySelector('#inv-copy')?.addEventListener('click', async () => {
    const input = root.querySelector('#inv-link');
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.select();
      document.execCommand('copy');
    }
    toast('복사했어요.');
  });
  // root(본문 칸)는 다시 그려도 남아 있으므로, 매번 새로 그려지는 .admin 에 단다
  root.querySelector('.admin').addEventListener('click', async e => {
    const cancel = e.target.closest('[data-cancel]');
    const remove = e.target.closest('[data-remove]');
    if (!cancel && !remove) return;
    const b = cancel || remove;
    if (remove && !confirm(`'${remove.dataset.name}' 님을 내보낼까요?\n다음 배포부터 이 계정으로 위키를 열 수 없어요.`)) return;
    b.disabled = true;
    try {
      const p = cancel ? invitePath(cancel.dataset.cancel) : userPath(remove.dataset.remove);
      const cur = await G.getText(p);
      if (cur) await G.remove(p, cur.sha, cancel ? '초대 취소' : `회원 내보냄: ${remove.dataset.name}`, W.me.name);
      if (cancel) W.data.invites = W.data.invites.filter(i => i.iid !== cancel.dataset.cancel);
      else W.data.users = W.data.users.filter(u => u.uid !== remove.dataset.remove);
      lastLink = '';
      rerender();
      toast(cancel ? '초대를 취소했어요.' : '내보냈어요. 1~2분 뒤부터 적용돼요.');
    } catch (x) {
      status(errText(x));
      b.disabled = false;
    }
  });
}

// ── 내 계정 ──
export function accountView() {
  const body = `
    <section>
      <h2 class="sec-title first">비밀번호 바꾸기</h2>
      <form id="pw-form" class="stack-form">
        <input type="text" autocomplete="username" value="${esc(W.me.name)}" hidden>
        <input class="field" id="pw-cur" type="password" placeholder="지금 비밀번호" autocomplete="current-password" required>
        <input class="field" id="pw-new" type="password" placeholder="새 비밀번호 (${MIN_PW}자 이상)" autocomplete="new-password" required>
        <input class="field" id="pw-new2" type="password" placeholder="새 비밀번호 확인" autocomplete="new-password" required>
        <button class="btn primary" type="submit">${icon('check')}<span>바꾸기</span></button>
        <div class="ed-status" id="pw-status" role="status"></div>
      </form>
    </section>
    <section>
      <h2 class="sec-title">로그아웃</h2>
      <p class="desc">이 기기에 저장된 로그인 정보를 지워요.</p>
      <button type="button" class="btn" id="logout">${icon('lock')}<span>로그아웃</span></button>
    </section>`;
  return { title: W.me.name, sub: '내 계정', body, mount: mountAccount };
}

function mountAccount(root) {
  root.querySelector('#logout').addEventListener('click', () => {
    C.forget();
    location.href = location.pathname + '#/';
    location.reload();
  });
  const form = root.querySelector('#pw-form');
  const st = root.querySelector('#pw-status');
  const say = (msg, error = false) => { st.textContent = msg; st.classList.toggle('error', error); };
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button');
    const cur = form.querySelector('#pw-cur').value;
    const next = form.querySelector('#pw-new').value;
    const problem = pwProblem(next, form.querySelector('#pw-new2').value);
    if (problem) { say(problem, true); return; }
    btn.disabled = true;
    say('확인하는 중…');
    try {
      const s = C.getSession();
      const iter = W.meta.iter;
      if ((await K.passKeys(W.me.name, cur, iter)).lookup !== s.lookup) throw new Error('지금 비밀번호가 맞지 않아요.');
      const nk = await K.passKeys(W.me.name, next, iter);
      const priv = await K.importPriv(K.unb64(s.priv));
      const file = await G.getText(userPath(W.me.uid));
      if (!file) throw new Error('계정 파일을 찾지 못했어요. 관리자에게 알려 주세요.');
      const rec = JSON.parse(file.text);
      rec.lookup = nk.lookup;
      rec.priv = await K.sealPriv(priv, nk.key);
      await G.putText(userPath(W.me.uid), json(rec), file.sha, `비밀번호 변경: ${W.me.name}`, W.me.name);
      C.saveSession({ ...s, lookup: nk.lookup, oldLookup: s.lookup });
      form.reset();
      say('비밀번호를 바꿨어요. 다른 기기에서는 1~2분 뒤부터 새 비밀번호로 로그인하세요.');
    } catch (x) {
      say(errText(x), true);
    } finally {
      btn.disabled = false;
    }
  });
}
