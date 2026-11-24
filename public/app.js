'use strict';
// 모든 사용자 입력은 esc()를 거쳐 텍스트로만 그린다 (스크립트 문자열도 그대로 보임)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s) => document.querySelector(s);
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PR = { 1: '높음', 2: '보통', 3: '낮음' };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

const S = { view: 'calendar', cv: 'month', day: null, gt: [], ws: null, today: null, plans: [], tasks: [], rev: null, cal: [], mini: null,
  sel: null, mode: 'review', metric: 'planned', rtab: 'week', tags: [], diary: {}, tagSel: null, tagItems: null, dview: null, mrev: null, trend: null, extra: [], planId: null, key: uid(), meta: null, list: { q: '', status: '', priority: '', tag: '', plan: '', sort: 'due', dir: 'asc' }, listData: null, draftDate: null };

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.startsWith('/auth/')) showAuth(); // 로그인이 풀렸거나 안 한 상태 → 로그인 화면으로
  if (!r.ok) throw new Error(j.error || '요청에 실패했습니다');
  return j;
}

// ── 로그인 · 가입 화면 (로그인하기 전에는 다이어리 자료가 화면에 나오지 않는다) ──
function showAuth(mode = 'login') {
  const old = document.getElementById('authbg'); if (old) old.remove();
  const reg = mode === 'register';
  document.body.insertAdjacentHTML('beforeend', `<div id="authbg" class="authbg"><form class="authbox" id="authform" autocomplete="on">
    <img class="logo" src="/logo.png" alt="WODIA">
    <h2>${reg ? '회원 가입' : '로그인'}</h2>
    <label>아이디<input name="username" autocomplete="username" required minlength="3" maxlength="30" placeholder="영문 소문자·숫자·밑줄 3~30자"></label>
    <label>비밀번호<input name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required minlength="8" maxlength="72" placeholder="8자 이상"></label>
    <div class="autherr" id="autherr" role="alert"></div>
    <button class="btn primary" type="submit">${reg ? '가입하고 시작' : '로그인'}</button>
    <button class="authlink" type="button" id="authswitch">${reg ? '로그인' : '회원가입'}</button>
  </form></div>`);
  $('#authswitch').onclick = () => showAuth(reg ? 'login' : 'register');
  $('#authform').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { await api(reg ? '/auth/register' : '/auth/login', 'POST', f); location.reload(); }
    catch (err) { $('#autherr').textContent = err.message; }
  };
  $('#authform input').focus();
}
// 앱 안에서 뜨는 입력 창 (브라우저의 prompt/confirm 은 일부 브라우저에서 막혀 있고, 비밀번호가 가려지지 않아 쓰지 않는다)
function askDialog({ title, message = '', fields = [], ok = '확인', danger = false, onSubmit }) {
  return new Promise((resolve) => {
    const el = document.createElement('div'); el.className = 'authbg dlg';
    el.innerHTML = `<form class="authbox" autocomplete="off">
      <h2>${esc(title)}</h2>
      ${message ? `<p class="dlgmsg">${esc(message)}</p>` : ''}
      ${fields.map((f) => `<label>${esc(f.label)}<input name="${f.name}" type="password" required minlength="${f.min || 1}" maxlength="72" autocomplete="${f.name === 'current' || f.name === 'password' ? 'current-password' : 'new-password'}"></label>`).join('')}
      ${fields.length ? '<label class="dlgshow"><input type="checkbox" id="dlgshow"> 비밀번호 보기</label>' : ''}
      <div class="autherr" role="alert"></div>
      <div class="dlgbtns"><button type="button" class="btn" data-x>취소</button><button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(ok)}</button></div>
    </form>`;
    document.body.append(el);
    const form = el.querySelector('form'), err = el.querySelector('.autherr');
    const done = (v) => { document.removeEventListener('keydown', onKey); el.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', onKey);
    el.querySelector('[data-x]').onclick = () => done(false);
    const show = el.querySelector('#dlgshow');
    if (show) show.onchange = () => form.querySelectorAll('input[type=password],input[data-pw]').forEach((i) => { i.type = show.checked ? 'text' : 'password'; i.dataset.pw = '1'; });
    form.onsubmit = async (e) => {
      e.preventDefault(); err.textContent = '';
      try { await onSubmit(Object.fromEntries(new FormData(form))); done(true); } catch (x) { err.textContent = x.message; }
    };
    const first = form.querySelector('input'); if (first) first.focus();
  });
}
async function accountAction(kind) {
  if (kind === 'logout') { await api('/auth/logout', 'POST', {}); return location.reload(); }
  if (kind === 'password') {
    const ok = await askDialog({
      title: '비밀번호 변경', ok: '변경',
      fields: [{ name: 'current', label: '현재 비밀번호' }, { name: 'next', label: '새 비밀번호 (8자 이상)', min: 8 }, { name: 'next2', label: '새 비밀번호 한 번 더', min: 8 }],
      onSubmit: async (v) => {
        if (v.next !== v.next2) throw new Error('새 비밀번호 두 칸이 서로 다릅니다');
        await api('/auth/password', 'POST', { current: v.current, next: v.next });
      },
    });
    if (ok) toast('비밀번호를 바꿨어요. 다른 기기의 로그인은 모두 풀렸어요');
    return;
  }
  if (kind === 'delete') {
    const ok = await askDialog({
      title: '계정 삭제', ok: '계정 삭제', danger: true,
      message: '계정을 삭제하면 내 모든 자료도 함께 지워지고 되돌릴 수 없어요. 먼저 "백업 내려받기"로 자료를 저장했는지 확인하세요. 계속하려면 비밀번호를 입력해 주세요.',
      fields: [{ name: 'password', label: '비밀번호' }],
      onSubmit: (v) => api('/auth/delete', 'POST', { password: v.password }),
    });
    if (ok) location.reload();
  }
}
function toast(m, action) {
  const t = $('#toast'); t.textContent = m;
  if (action) { const b = document.createElement('button'); b.textContent = action.label; b.onclick = run(async () => { t.classList.remove('on'); await action.fn(); }); t.append(b); }
  t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), action ? 8000 : 2200);
}
const run = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };

// ── 날짜 도우미 (서버와 같은 규칙: YYYY-MM-DD, 월요일 시작) ──
const toD = (s) => new Date(s + 'T00:00:00Z');
const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
const weekOf = (s) => addDays(s, -toD(s).getUTCDay());   // 일요일 시작
const mmdd = (s) => `${+s.slice(5, 7)}/${+s.slice(8)}`;
const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ' ' + (m % 60) + '분' : ''}` : `${m}분`);

// ── 데이터 로드 ──
async function loadWeek() {
  const we = addDays(S.ws, 6);
  const [t, rev] = await Promise.all([api(`/tasks?from=${S.ws}&to=${we}&sort=due`), api(`/review?week=${S.ws}&to=${S.today}`)]);
  S.tasks = t.tasks; S.rev = rev;
  const m0 = S.mini.slice(0, 7) + '-01', from = weekOf(m0), to = addDays(from, 41);
  S.cal = await api(`/calendar?from=${from}&to=${to}`);
  const g0 = weekOf(S.day.slice(0, 7) + '-01');
  S.gt = (await api(`/tasks?from=${g0}&to=${addDays(g0, 41)}&sort=due`)).tasks;
  const [dl, tg] = await Promise.all([api(`/diary-list?from=${g0}&to=${addDays(g0, 41)}`), api('/tags')]);
  S.diary = Object.fromEntries(dl.map((x) => [x.date, x])); S.tags = tg;
  if (S.rtab === 'month') S.mrev = await api(`/review/month?month=${monthKey()}&to=${S.today}`);
  if (S.rtab === 'trend') S.trend = await api('/trends?weeks=8');
}
const monthKey = () => addDays(S.ws, 3).slice(0, 7);
async function loadList() {
  const q = new URLSearchParams(Object.entries(S.list).filter(([, v]) => v)).toString();
  S.listData = await api('/tasks?' + q);
  S.listDiary = S.list.q ? await api('/diary-search?q=' + encodeURIComponent(S.list.q)) : [];
}
const reload = run(async () => {
  S.plans = await api('/plans');
  await loadWeek();
  if (S.view === 'list') await loadList();
  render();
});
const MOOD = ['', '😞', '🙁', '😐', '🙂', '😄'];
const tagColor = (t) => S.tags.find((x) => x.tag === t)?.color || '';
const chip = (t) => { const c = tagColor(t); return `<span class="tag" data-act="tag" data-t="${esc(t)}" ${/^#[0-9a-f]{6}$/i.test(c) ? `style="background:${c}33"` : ''}>${esc(t)}</span>`; };
const chips = (str) => String(str || '').split(',').filter(Boolean).map(chip).join('');
// 태그 입력: 하나 쓰고 Enter를 누르면 칩으로 추가된다 (쉼표로 구분하지 않음)
const tagChips = (val) => String(val || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => `<span class="tag tchip">${esc(x)}<button type="button" data-act="tagx" data-t="${esc(x)}" title="삭제">×</button></span>`).join('');
// 입력칸은 위에, 추가된 태그 칩은 입력칸 아래(.tagrow)에 나열된다
const tagIn = (val) => `<div class="field">태그<div data-tagin><div class="tagin"><input type="hidden" name="tags" value="${esc(val || '')}"><input type="text" class="tagtxt" placeholder="내용 입력" maxlength="30"></div><div class="tagrow">${tagChips(val)}</div></div></div>`;
const tagGet = (box) => box.querySelector('[name=tags]').value.split(',').map((x) => x.trim()).filter(Boolean);
function tagSet(box, list) { list = [...new Set(list)]; box.querySelector('[name=tags]').value = list.join(','); box.querySelector('.tagrow').innerHTML = tagChips(list.join(',')); }
const tagCommit = (box) => { const i = box.querySelector('.tagtxt'), add = i.value.split(',').map((x) => x.trim()).filter(Boolean); i.value = ''; if (add.length) tagSet(box, [...tagGet(box), ...add]); };
document.addEventListener('keydown', (e) => {
  const i = e.target.closest?.('.tagtxt'); if (!i) return; const box = i.closest('[data-tagin]');
  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); tagCommit(box); }
  else if (e.key === 'Backspace' && !i.value) { const l = tagGet(box); l.pop(); tagSet(box, l); }
});
document.addEventListener('focusout', (e) => { const i = e.target.closest?.('.tagtxt'); if (i) tagCommit(i.closest('[data-tagin]')); });
const tagPicker = () => `<div class="picker">${S.tags.slice(0, 24).map((x) => `<button type="button" class="tag" data-act="addtag" data-t="${esc(x.tag)}">${esc(x.tag)}</button>`).join('')}</div>`;
const onDay = (t, d) => t.due_date <= d && d <= (t.end_date || t.due_date);
const PALETTE = ['#d93025', '#e67c73', '#f4511e', '#f6bf26', '#9a6a12', '#33b679', '#1f6b5e', '#039be5', '#2a62b8', '#7986cb', '#8e24aa', '#616161'];
const swatches = (cur, isTask) => `<div class="field">색상<input type="hidden" name="color" value="${esc(cur)}"><div class="sw">${PALETTE.map((x) => `<button type="button" class="${x === cur ? 'on' : ''}" data-act="swatch" data-c="${x}" style="background:${x}" title="${x}"></button>`).join('')}</div>
  <button type="button" class="swdef ${cur ? '' : 'on'}" data-act="swatch" data-c=""><i></i>${isTask === 'tag' ? '기본 (회색)' : isTask ? '기본 (회색)' : '기본 (우선순위 색)'}</button></div>`;
const taskColor = (t) => t.color || '#a3a399';   // 색을 안 고르면 차분한 회색
const taskById = (id) => S.tasks.find((t) => t.id === id) || S.gt.find((t) => t.id === id) || S.listData?.tasks.find((t) => t.id === id) || S.extra.find((t) => t.id === id);

// ── 렌더 ──
function render() { renderRail(); renderSide(); renderMain(); renderPanel(); renderBanner(); }
function renderRail() { document.querySelectorAll('.rail button[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === S.view));
  $('#tgDark')?.classList.toggle('on', document.documentElement.dataset.theme === 'dark'); $('#tgBell')?.classList.toggle('on', notifyOn()); }
const notifyOn = () => localStorage.getItem('pds-notify') === '1' && 'Notification' in window && Notification.permission === 'granted';

function renderSide() {
  const m = toD(S.mini), y = m.getUTCFullYear(), mo = m.getUTCMonth();
  const first = weekOf(fmt(new Date(Date.UTC(y, mo, 1))));
  const by = Object.fromEntries(S.cal.map((c) => [c.d, c]));
  let cells = WD.map((w) => `<div class="dh">${w}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = addDays(first, i), c = by[d], cls = ['d', toD(d).getUTCMonth() !== mo && 'out', d === S.today && 'today', weekOf(d) === S.ws && 'inweek', HOL[d] && 'hol'].filter(Boolean).join(' ');
    cells += `<button class="${cls}" data-act="goto" data-d="${d}"${HOL[d] ? ` title="${esc(HOL[d])}"` : ''}>${+d.slice(8)}${c ? `<i class="${c.done === c.total ? 'all' : ''}"></i>` : ''}</button>`;
  }
  $('#mini').innerHTML = `<div class="hd"><button data-act="mini" data-n="-1">‹</button><span>${y}년 ${mo + 1}월</span><button data-act="mini" data-n="1">›</button></div><div class="grid7">${cells}</div>`;
  const td = S.tasks.filter((t) => onDay(t, S.today));
  renderDD();
  $('#sideToday').innerHTML = td.length ? td.map((t) => `<button class="srow" data-act="pick" data-id="${t.id}"><span class="t">${esc(t.title)}</span><span class="m">${t.status === 'done' ? '✓' : esc(t.due_time)}</span></button>`).join('') : '<div class="muted">일정 없음</div>';
}

function cardHtml(t) {
  const est = t.est_min ? `-${hm(t.est_min)}` : '';
  const tags = chips(t.tags);
  const flags = (t.overdue ? '<span class="tag red">지연</span>' : '') + (t.blocked ? '<span class="tag red">막힘</span>' : '') + (t.original_date && t.original_date !== t.due_date ? `<span class="tag">${mmdd(t.original_date)}에서 이동</span>` : '');
  const actual = t.status === 'done' ? ` · 실제 ${hm(t.actual_min)}` : '';
  return `<button class="card ${t.status} ${S.sel === t.id ? 'sel' : ''}" data-act="pick" data-id="${t.id}" data-p="${t.priority}">
    <div class="tm">${esc(t.due_time || '하루')}<small>${esc(t.end_date ? '~' + mmdd(t.end_date) : est)}</small></div>
    <div class="bar" style="border-color:${taskColor(t)}"><div class="tt">${esc(t.title)}</div><div class="dt">${esc(t.detail)}${actual}</div><div>${tags}${flags}</div></div>
    <div class="chk" data-act="toggle" data-id="${t.id}">${t.status === 'done' ? '✓' : t.status === 'skipped' ? '↷' : ''}</div></button>`;
}

function renderMain() {
  const main = $('#main');
  if (S.view === 'list') return renderList(main);
  if (S.view === 'tags') return renderTags(main);
  if (S.view === 'trash') return renderTrash(main);
  if (S.view === 'calendar' && S.cv === 'year') return renderYear(main);
  if (S.view === 'review') return (main.innerHTML = `<div class="revmain">${reviewPanel()}</div>`);
  const m = toD(S.day), mo = m.getUTCMonth();
  const month = S.cv === 'month', first = month ? weekOf(S.day.slice(0, 7) + '-01') : S.ws;
  const rows = month ? (toD(addDays(first, 35)).getUTCMonth() === mo ? 6 : 5) : 1, max = month ? 3 : 8;
  let h = `<div class="top"><h2>${mo + 1}월 <span>${m.getUTCFullYear()}</span></h2>
    <div class="seg"><button class="${month ? 'on' : ''}" data-act="cv" data-k="month">월</button><button class="${month ? '' : 'on'}" data-act="cv" data-k="week">주</button><button data-act="cv" data-k="year">연</button></div>
    <button class="ico" data-act="nav" data-n="-1">‹</button><button class="btn" data-act="goto" data-d="${S.today}">오늘</button><button class="ico" data-act="nav" data-n="1">›</button>
    </div>`;
  h += `<div class="mgrid ${month ? '' : 'wk'}"><div class="mhead">${WD.map((w, i) => `<div class="mh ${i === 0 ? 'sun' : ''}">${w}</div>`).join('')}</div>`;
  const diff = (a, b) => Math.round((toD(a) - toD(b)) / 86400000);
  for (let w = 0; w < rows; w++) {
    const ws = addDays(first, w * 7), we = addDays(ws, 6);
    // 며칠에 걸친 이벤트는 칸마다 따로 그리지 않고, 그 주 안에서 이어지는 한 줄 막대로 그린다 (애플 캘린더처럼)
    const lanes = [], bars = [];
    S.gt.filter((t) => t.end_date && t.end_date > t.due_date && t.due_date <= we && t.end_date >= ws)
      .sort((a, b) => a.due_date.localeCompare(b.due_date) || b.end_date.localeCompare(a.end_date) || a.id - b.id)
      .forEach((t) => {
        const s = Math.max(0, diff(t.due_date, ws)), e = Math.min(6, diff(t.end_date, ws));
        let ln = lanes.findIndex((last) => last < s); if (ln < 0) ln = lanes.length;
        if (ln >= 4) return;   // 막대가 너무 많이 겹치면 나머지는 날짜 칸 안에 일반 막대로 둔다
        lanes[ln] = e; bars.push({ t, s, e, ln, cs: t.due_date < ws, ce: t.end_date > we });
      });
    const barIds = new Set(bars.map((b) => b.t.id));
    h += `<div class="mweek">`;
    for (let k = 0; k < 7; k++) {
      const d = addDays(ws, k), ts = S.gt.filter((t) => onDay(t, d) && !barIds.has(t.id));
      const cls = ['mc', month && toD(d).getUTCMonth() !== mo && 'out', d === S.today && 'today', d === S.day && 'sel', HOL[d] && 'hol'].filter(Boolean).join(' ');
      h += `<div class="${cls}" data-act="selday" data-d="${d}"><span class="n">${+d.slice(8)}</span>${HOL[d] ? `<span class="hn">${esc(HOL[d])}</span>` : ''}${ddOn(d).map((x) => `<span class="dn" title="${esc(x.title)} · ${ddLabel(x.date)}">★ ${esc(x.title)}</span>`).join('')}${S.diary[d] ? `<span class="dm" title="일기">${MOOD[S.diary[d].mood || 0] || '✎'}</span>` : ''}
        ${lanes.length ? `<div style="height:${lanes.length * 21}px"></div>` : ''}
        ${ts.slice(0, max).map((t) => `<div class="ch ${t.status}" draggable="true" style="--pc:${taskColor(t)}" data-act="pick" data-id="${t.id}" title="${esc((t.due_time ? t.due_time + ' ' : '') + t.title)}"><span>${esc(t.title)}</span></div>`).join('')}
        ${ts.length > max ? `<div class="more">+${ts.length - max}개 더</div>` : ''}</div>`;
    }
    h += `<div class="mbars">${bars.map((b) => `<div class="ch bar ${b.t.status} ${b.cs ? 'cs' : ''} ${b.ce ? 'ce' : ''}" style="--pc:${taskColor(b.t)};grid-column:${b.s + 1}/${b.e + 2};grid-row:${b.ln + 1}" data-act="pick" data-id="${b.t.id}" title="${esc(b.t.title)}"><span>${esc(b.t.title)}</span></div>`).join('')}</div></div>`;
  }
  main.innerHTML = h + '</div><div id="monthnote" class="mnote"></div>';
  loadMonthNote();
}
function dayPanel() {
  const d = S.day, ts = S.gt.filter((t) => onDay(t, d)), m = toD(d);
  return `<h2>${m.getUTCMonth() + 1}월 ${m.getUTCDate()}일 <span class="muted">${WD[m.getUTCDay()]}</span>${HOL[d] ? ` <span class="tag red">${esc(HOL[d])}</span>` : ''}</h2>
  <div id="mealmemo"></div>${diaryCard(d)}<h3 class="evh">이벤트 <button class="ico plus" data-act="new" data-d="${d}" title="이벤트 추가">+</button></h3><div class="cards">${ts.length ? ts.map(cardHtml).join('') : '<div class="empty">일정 없음</div>'}</div>`;
}

// 노트: 날짜마다 따로 저장되는 메모장 (입력을 멈추면 자동 저장). 평소엔 그냥 글상자, 클릭하면 서식 도구가 나타남
const NOTE_MARK = '<!--rt-->';
const NOTE_OK = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'UL', 'OL', 'LI', 'BR', 'DIV', 'P', 'IMG']);
const NOTE_DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'LINK', 'META', 'TEMPLATE']);
// 저장된 HTML은 화면에 그리기 전에 반드시 허용 목록으로 걸러낸다 (링크를 아는 누구나 메모를 쓸 수 있으므로)
function cleanNote(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = (n) => [...n.childNodes].forEach((c) => {
    if (c.nodeType === 3) return;
    if (c.nodeType !== 1 || NOTE_DROP.has(c.tagName.toUpperCase())) return c.remove();
    walk(c);
    if (!NOTE_OK.has(c.tagName)) return c.replaceWith(...c.childNodes);
    const src = c.tagName === 'IMG' ? c.getAttribute('src') || '' : '';
    [...c.attributes].forEach((a) => c.removeAttribute(a.name));
    if (c.tagName === 'IMG') { if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(src)) c.setAttribute('src', src); else c.remove(); }
  });
  walk(doc.body); return doc.body.innerHTML;
}
const noteHtml = (b) => (b.startsWith(NOTE_MARK) ? cleanNote(b.slice(NOTE_MARK.length)) : esc(b).replace(/\n/g, '<br>'));
const shrinkImg = (file) => new Promise((ok, no) => {
  const url = URL.createObjectURL(file), im = new Image();
  im.onload = () => { const k = Math.min(1, 560 / im.width), cv = document.createElement('canvas'); cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
    const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height); x.drawImage(im, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url); ok(cv.toDataURL('image/jpeg', 0.72)); };
  im.onerror = () => no(new Error('이미지를 열 수 없어요')); im.src = url;
});
const NOTE_TOOLS = [['bold', '굵게', '<b>B</b>'], ['italic', '기울임', '<i>I</i>'], ['underline', '밑줄', '<u>U</u>'], ['strikeThrough', '취소선', '<s>S</s>'], ['insertUnorderedList', '목록', '☰'], ['image', '이미지', '▣']];
// 노트 편집기 (날짜 노트·달 노트 공용): el 안에 그리고, 내용이 바뀌면 put(body)로 저장
// 지금 커서(또는 선택한 글자)에 적용된 서식을 도구 줄에 표시한다 (굵게가 켜져 있으면 B가 어둡게)
const NOTE_STATE = ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList'];
function syncTools(ed) { ed.parentElement.querySelectorAll('.ntools [data-cmd]').forEach((b) => { if (NOTE_STATE.includes(b.dataset.cmd)) b.classList.toggle('on', document.queryCommandState(b.dataset.cmd)); }); }
document.addEventListener('selectionchange', () => {
  const n = getSelection().anchorNode, ed = (n && (n.nodeType === 1 ? n : n.parentElement))?.closest?.('.nedit'); if (ed) syncTools(ed);
});
function mountNote(el, title, r, put) {
  el.innerHTML = `<div class="memo note"><b>${esc(title)} <span class="mini2 nstate">${r.saved ? '저장됨' : ''}</span></b>
    <div class="ntools">${NOTE_TOOLS.map(([k, t, h]) => `<button type="button" data-cmd="${k}" title="${t}">${h}</button>`).join('')}<input type="file" class="nimg" accept="image/*" hidden></div>
    <div class="nedit" contenteditable="true" data-ph="내용 입력">${noteHtml(r.body)}</div></div>`;
  const box = el.firstElementChild, ed = box.querySelector('.nedit'), st = box.querySelector('.nstate'), file = box.querySelector('.nimg'); let t, range = null;
  const save = run(async () => { clearTimeout(t); const empty = !ed.textContent.trim() && !ed.querySelector('img');
    await put(empty ? '' : NOTE_MARK + cleanNote(ed.innerHTML)); st.textContent = '저장됨'; });
  const changed = () => { st.textContent = '저장 중…'; clearTimeout(t); t = setTimeout(save, 600); };
  ed.addEventListener('input', changed);
  ed.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
  box.addEventListener('focusin', () => { box.classList.add('on'); syncTools(ed); });
  box.addEventListener('focusout', (e) => { if (!box.contains(e.relatedTarget)) { box.classList.remove('on'); if (st.textContent === '저장 중…') save(); } });
  box.querySelector('.ntools').addEventListener('mousedown', (e) => e.preventDefault());
  box.querySelector('.ntools').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]'); if (!b) return;
    if (b.dataset.cmd === 'image') { const s = getSelection(); range = s.rangeCount ? s.getRangeAt(0).cloneRange() : null; return file.click(); }
    ed.focus(); document.execCommand('styleWithCSS', false, false); document.execCommand(b.dataset.cmd); syncTools(ed); changed();
  });
  file.addEventListener('change', run(async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const url = await shrinkImg(f); ed.focus();
    if (range) { const s = getSelection(); s.removeAllRanges(); s.addRange(range); }
    document.execCommand('insertImage', false, url); changed();
  }));
}
const loadMeal = run(async () => {
  const d = S.day, r = await api('/day-note?date=' + d), el = $('#mealmemo');
  if (!el || S.day !== d) return;
  mountNote(el, '노트', r, (body) => api('/day-note', 'PUT', { date: d, body }));
});
const loadMonthNote = run(async () => {
  const k = S.day.slice(0, 7), r = await api('/month-note?month=' + k), el = $('#monthnote');
  if (!el || S.day.slice(0, 7) !== k) return;
  mountNote(el, `${+k.slice(5)}월 노트`, r, (body) => api('/month-note', 'PUT', { month: k, body }));
});

function diaryCard(d) {
  const e = S.diary[d];
  if (!e) return `<button class="dlink" style="align-self:flex-start" data-act="opendiary" data-d="${d}">＋ 일기 쓰기</button>`;
  return `<button class="card diary ${S.mode === 'diary' && S.dview?.date === d ? 'sel' : ''}" data-act="opendiary" data-d="${d}"><div class="tm">${MOOD[e.mood || 0] || '✎'}<small>일기</small></div>
    <div class="bar"><div class="tt">${esc(e.body.slice(0, 80))}${e.body.length > 80 ? '…' : ''}</div><div>${chips(e.tags)}</div></div><div></div></button>`;
}
function renderTags(main) {
  if (S.tagSel && S.tagItems) return renderTagItems(main);
  main.innerHTML = `<div class="top"><h2>태그</h2></div><form data-form="addtag" class="plan"><label class="field">새 태그 이름<input name="tag" maxlength="20" required style="max-width:260px"></label>${swatches('', 'tag')}<button class="btn pri">+ 태그 추가</button></form>
  <div class="sortnote">태그를 누르면 그 태그가 붙은 이벤트와 일기를 모아 봐요 · 이름을 이미 있는 태그로 바꾸면 합쳐져요 · 시간 차이는 완료한 일의 (실제 − 예상)</div>
  <table><tr><th>색</th><th>태그</th><th>이벤트</th><th>일기</th><th>완료율</th><th>시간 차이</th><th></th></tr>
  ${S.tags.map((x) => `<tr><td><details class="tagsw"><summary style="background:${/^#[0-9a-f]{6}$/i.test(x.color) ? x.color : '#8a8a80'}" title="색 바꾸기"></summary><div class="sw">${PALETTE.map((c) => `<button type="button" class="${c === x.color ? 'on' : ''}" data-act="tagsw" data-t="${esc(x.tag)}" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div></details></td><td>${chip(x.tag)}</td><td>${x.tasks}</td><td>${x.diary}</td>
    <td>${x.tasks ? x.rate + '%' : '–'}</td><td>${x.done ? `<span class="${x.delta_min > 5 ? 'late' : x.delta_min < -5 ? 'good' : ''}">${x.delta_min > 0 ? '+' : ''}${x.delta_min}분</span>` : '–'}</td>
    <td><button class="btn" data-act="tagrename" data-t="${esc(x.tag)}">이름 바꾸기</button> <button class="btn warn" data-act="tagdel" data-t="${esc(x.tag)}">삭제</button></td></tr>`).join('') || '<tr><td colspan="7">아직 태그가 없어요</td></tr>'}</table>`;
}
function renderTagItems(main) {
  const it = S.tagItems, st = S.tags.find((x) => x.tag === it.tag);
  main.innerHTML = `<div class="top"><h2>${chip(it.tag)} <span style="font-size:15px">이벤트 ${it.tasks.length} · 일기 ${it.diary.length}</span></h2><button class="btn" data-act="tagback">← 태그 목록</button></div>
  ${st && st.done ? `<div class="sortnote">완료율 ${st.rate}% · 시간 차이 ${st.delta_min > 0 ? '+' : ''}${st.delta_min}분 (완료한 일 기준, 실제 − 예상)</div>` : ''}
  <h3>일기</h3>${it.diary.map((x) => `<button class="line" data-act="opendiary" data-d="${x.date}"><b>${esc(x.date)}</b> ${MOOD[x.mood || 0]}<small>${esc(x.body.slice(0, 100))}</small></button>`).join('') || '<div class="muted">이 태그의 일기가 없어요</div>'}
  <h3>이벤트</h3><table><tr><th>이벤트</th><th>마감</th><th>상태</th><th>예상</th><th>실제</th></tr>${it.tasks.map((t) => `<tr class="r ${S.sel === t.id ? 'sel' : ''}" data-act="pick" data-id="${t.id}"><td>${esc(t.title)}</td><td>${mmdd(t.due_date)} ${esc(t.due_time)}</td>
    <td>${t.status === 'done' ? '완료' : t.status === 'skipped' ? '건너뜀' : t.overdue ? '지연' : '진행 전'}</td><td>${t.est_min}분</td><td>${t.status === 'done' ? t.actual_min + '분' : '–'}</td></tr>`).join('')}</table>`;
}
const openTag = run(async (t) => { S.view = 'tags'; S.tagSel = t; S.tagItems = await api('/tag-items?tag=' + encodeURIComponent(t)); S.extra = S.tagItems.tasks; S.mode = 'review'; render(); });
function renderList(main) {
  const L = S.list, tasks = S.listData?.tasks || [], so = S.listData?.sort;
  const tags = [...new Set(tasks.flatMap((t) => t.tags.split(',')).filter(Boolean))];
  const opt = (v, l, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`;
  main.innerHTML = `<div class="top"><h2>목록</h2><button class="ico plus" data-act="new" data-d="${S.today}" title="이벤트 추가">+</button></div>
  <div class="bar2">
    <input id="f-q" placeholder="검색 (이름·메모·태그·일기)" value="${esc(L.q)}">
    <select data-f="status">${opt('', '상태 전체', L.status)}${opt('todo', '진행 전', L.status)}${opt('done', '완료', L.status)}${opt('skipped', '건너뜀', L.status)}${opt('overdue', '지연', L.status)}</select>
    <select data-f="priority">${opt('', '우선순위 전체', L.priority)}${[1, 2, 3].map((n) => opt(String(n), PR[n], L.priority)).join('')}</select>
    <select data-f="tag">${opt('', '태그 전체', L.tag)}${S.tags.map((x) => opt(x.tag, x.tag, L.tag)).join('')}</select>
    <select data-f="sort">${opt('due', '마감일순', L.sort)}${opt('priority', '우선순위순', L.sort)}${opt('est', '예상 시간순', L.sort)}${opt('title', '이름순', L.sort)}${opt('status', '상태순', L.sort)}</select>
    <select data-f="dir">${opt('asc', '오름차순', L.dir)}${opt('desc', '내림차순', L.dir)}</select></div>
  <div class="sortnote">${tasks.length}건${L.q ? ` · 일기 ${(S.listDiary || []).length}건` : ''}</div>
  ${(() => {
    const by = L.sort === 'due';   // 마감일순이면 날짜별로 묶어서 보여준다
    const KD = ['일', '월', '화', '수', '목', '금', '토'], cnt = {};
    tasks.forEach((t) => { cnt[t.due_date] = (cnt[t.due_date] || 0) + 1; });
    let last = '';
    const rows = tasks.map((t) => {
      const head = by && t.due_date !== last ? `<tr class="gh"><td colspan="7"><b>${mmdd(t.due_date)}</b> ${KD[toD(t.due_date).getUTCDay()]}${t.due_date === S.today ? ' <span class="tag">오늘</span>' : ''}<span class="muted"> · ${cnt[t.due_date]}개</span></td></tr>` : '';
      last = t.due_date;
      return head + `<tr class="r ${S.sel === t.id ? 'sel' : ''}" data-act="pick" data-id="${t.id}"><td><button class="chk" data-act="toggle" data-id="${t.id}">${t.status === 'done' ? '✓' : ''}</button></td>
    <td>${esc(t.title)} ${t.overdue ? '<span class="tag red">지연</span>' : ''}${t.status === 'skipped' ? '<span class="tag">건너뜀</span>' : ''}</td>
    <td>${by ? (t.due_time ? fmtTime(t.due_time) : '종일') : mmdd(t.due_date) + ' ' + esc(t.due_time)}</td><td>${PR[t.priority]}</td><td>${chips(t.tags)}</td>
    <td>${t.est_min}분</td><td>${t.status === 'done' ? t.actual_min + '분' : '–'}</td></tr>`;
    }).join('');
    return `<table><tr><th></th><th>이벤트</th><th>${by ? '시각' : '마감'}</th><th>우선</th><th>태그</th><th>예상</th><th>실제</th></tr>${rows}</table>`;
  })()}`;
  const q = $('#f-q'); q.oninput = () => { clearTimeout(renderList.t); renderList.t = setTimeout(run(async () => { S.list.q = q.value; await loadList(); const pos = q.selectionStart; renderMain(); const n = $('#f-q'); n.focus(); n.setSelectionRange(pos, pos); }), 250); };
}

// ── 오른쪽 패널 ──
function renderPanel() {
  const p = $('#panel');
  const cal = S.view === 'calendar', open = S.mode !== 'review' || cal;
  p.hidden = !open; document.querySelector('.app').classList.toggle('nopanel', !open);
  if (!open) return (p.innerHTML = '');
  if (S.mode === 'review') { p.innerHTML = dayPanel(); loadMeal(); return; }
  if (S.mode === 'task') { p.innerHTML = taskPanel(taskById(S.sel)); loadCk(); return; }
  if (S.mode === 'new') return (p.innerHTML = taskForm(null));
  if (S.mode === 'diary') return (p.innerHTML = diaryPanel());
}
function diaryPanel() {
  const v = S.dview; if (!v) return '';
  const e = v.entry || { body: '', mood: null, tags: '' };
  const row = (x, label) => x ? `<button class="line" data-act="opendiary" data-d="${x.date}"><b>${label} · ${mmdd(x.date)}</b> ${MOOD[x.mood || 0]}<small>${esc(x.body.slice(0, 60))}</small><small>${chips(x.tags)}</small></button>` : '';
  return `<button class="btn" data-act="back">← 닫기</button><h2 style="margin-top:12px">${mmdd(v.date)} 일기</h2>
  <div class="muted">그 날 이벤트 ${v.summary.done}/${v.summary.total} 완료${v.summary.late ? ' · 지연 ' + v.summary.late : ''}</div>
  <form data-form="diary" data-d="${esc(v.date)}"><label class="field">오늘의 한 줄 (공개돼도 괜찮은 내용만)<textarea name="body" rows="5" maxlength="1000">${esc(e.body)}</textarea></label>
  <label class="field">기분<select name="mood"><option value="">선택 안 함</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${e.mood === n ? 'selected' : ''}>${MOOD[n]} ${n}</option>`).join('')}</select></label>
  ${tagIn(e.tags)}${tagPicker()}<div class="actions"><button class="btn pri">저장</button><span class="mini2" style="align-self:center">모두 비우고 저장하면 일기가 지워져요</span></div></form>
  <h3>돌아보기</h3>${row(v.month_ago, '한 달 전 오늘') || '<div class="muted">한 달 전 같은 날 일기가 없어요</div>'}${v.same_tag.map((x) => row(x, '같은 태그')).join('')}`;
}
function diarySection(r) {
  if (!r.diary || !r.diary.length) return '<h3>일기</h3><div class="muted">이 기간 일기가 없어요</div>';
  const lo = r.mood_effect.low, hi = r.mood_effect.high, sg = (n) => (n > 0 ? '+' : '') + n;
  const eff = lo && hi ? `<div class="suggest">기분이 낮은 날(${lo.days}일) 완료한 일은 평균 ${sg(lo.avg_delta)}분, 높은 날(${hi.days}일)은 ${sg(hi.avg_delta)}분 (실제 − 예상)</div>` : '';
  return `<h3>일기 <span class="muted">${r.mood_avg ? '평균 기분 ' + r.mood_avg : ''}</span></h3><div>${r.diary_tags.map((x) => `${chip(x.tag)}<span class="mini2">×${x.count}</span> `).join('')}</div>${eff}
  ${r.diary.map((x) => `<button class="line" data-act="opendiary" data-d="${x.date}"><b>${mmdd(x.date)}</b> ${MOOD[x.mood || 0]}<small>${esc(x.body.slice(0, 50))}</small></button>`).join('')}`;
}
function reviewPanel() {
  const tabs = `<div class="tabs">${[['week', '주간'], ['month', '월간'], ['trend', '추이']].map(([k, l]) => `<button class="${S.rtab === k ? 'on' : ''}" data-act="rtab" data-k="${k}">${l}</button>`).join('')}</div>`;
  if (S.rtab === 'trend') return tabs + trendPanel();
  // 회고는 그 기간이 끝난 뒤에만 보여준다 (주: 토요일까지, 월: 말일까지)
  const isM = S.rtab === 'month', mk = monthKey();
  const endD = isM ? fmt(new Date(Date.UTC(+mk.slice(0, 4), +mk.slice(5, 7), 0))) : addDays(S.ws, 6);
  const startD = isM ? mk + '-01' : S.ws;
  if (S.today < startD) {   // 아직 시작하지 않은 주·달은 볼 게 없으니 안내만
    return tabs + `<div class="notyet"><h2>아직 시작하지 않은 ${isM ? '달' : '주'}이에요</h2><p class="muted">${isM ? mk.slice(0, 4) + '년 ' + +mk.slice(5, 7) + '월' : mmdd(S.ws) + ' – ' + mmdd(endD)}은 ${mmdd(startD)}부터 기록이 쌓여요</p><button class="btn pri" data-act="revprev">${isM ? '지난달' : '지난주'} 회고 보기</button></div>`;
  }
  const live = S.today <= endD, wdn = ['일', '월', '화', '수', '목', '금', '토'][toD(S.today).getUTCDay()];
  const liveNote = live ? `<div class="revlive"><b>진행 중</b> · ${mmdd(S.today)}(${wdn})까지의 기록이에요. 내일이 되면 내일 것도 함께 더해져요.</div>` : '';
  const r = S.rtab === 'month' ? S.mrev : S.rev;
  return r ? tabs + liveNote + summaryPanel(r, S.rtab === 'month') : tabs + '<div class="empty">불러오는 중…</div>';
}
function summaryPanel(r, month) {
  const m = r.metrics, tiles = [['planned', '계획 수', m.planned], ['done', '완료', m.done], ['delayed', '지연', m.delayed], ['blocked', '막힘', m.blocked],
    ['est', '예상 시간', hm(m.est_min)], ['actual', '실제 시간', hm(m.actual_min)], ['diff', '차이 (실제 − 예상)', (m.diff_min > 0 ? '+' : '') + m.diff_min + '분']];
  const rows = r.items[S.metric] || [];
  const maxR = Math.max(1, ...r.reasons.map((x) => x.count));
  return `<h2>${month ? '월간' : '주간'} 회고</h2><div class="muted">${month ? esc(r.month) : mmdd(r.week_start) + ' – ' + mmdd(r.week_end)}</div>
  <div class="dots"><b>${esc(r.diligence)}</b></div>
  ${(r.estimates || []).map((x) => `<div class="suggest"><b>${esc(x.title)}</b> — 최근 ${x.samples}번 평균 ${x.avg_min}분 (예상 ${x.est_min}분)<br>
    <button class="btn" style="margin-top:4px" data-act="applyest" data-t="${esc(x.title)}" data-m="${x.suggested_min}">앞으로 ${x.suggested_min}분으로 바꾸기 (${x.upcoming}건)</button></div>`).join('')}
  <div class="tiles">${tiles.map(([k, l, v]) => `<button class="tile ${S.metric === k ? 'sel' : ''}" data-act="metric" data-k="${k}"><b>${v}</b><span>${l}</span></button>`).join('')}</div>
  ${month ? `<h3>주별 완료율</h3>${r.weeks.map((w) => `<div class="rbar"><span>${mmdd(w.from)}–${mmdd(w.to)}</span><i style="width:${w.rate * 0.9}px"></i><span>${w.rate}%</span></div>`).join('')}` : ''}
  <h3>막힘 사유 통계</h3>${r.reasons.length ? r.reasons.map((x) => `<div class="rbar"><span>${esc(x.reason)}</span><i style="width:${(x.count / maxR) * 80}px"></i><span>${x.count}회</span></div>`).join('') : '<div class="muted">막힘 사유 기록이 없어요</div>'}
  ${diarySection(r)}
  <h3>근거 기록 <span class="muted">위 숫자를 누르면 바뀌어요</span></h3>
  ${rows.map((x) => `<button class="line" data-act="pick" data-id="${x.id}"><b>${mmdd(x.due_date)} ${esc(x.title)}</b>
    <small>${esc(x.verdict)} · 예상 ${x.est_min}분${x.status === 'done' ? ` · 실제 ${x.actual_min}분 <span class="${x.delta > 5 ? 'late' : x.delta < -5 ? 'good' : ''}">(${x.delta > 0 ? '+' : ''}${x.delta}분${x.delta > 5 ? ' 늦음' : x.delta < -5 ? ' 빠름' : ''})</span>` : ''}</small>
    ${x.reasons.length ? `<small>막힘: ${x.reasons.map(esc).join(' / ')}</small>` : ''}</button>`).join('') || '<div class="empty">해당 기록이 없어요</div>'}`;
}
function trendPanel() {
  const t = S.trend; if (!t) return '<div class="empty">불러오는 중…</div>';
  const W = 320, H = 110, n = t.weeks.length, bw = W / n;
  const bars = t.weeks.map((w, i) => { const h = Math.round((w.rate / 100) * 70);
    return `<rect x="${i * bw + 6}" y="${92 - h}" width="${bw - 12}" height="${h}" rx="3" fill="var(--c1)"/><text x="${i * bw + bw / 2}" y="${88 - h}" text-anchor="middle">${w.rate}</text><text x="${i * bw + bw / 2}" y="106" text-anchor="middle">${mmdd(w.week_start)}</text>`; }).join('');
  return `<h2>주간 추이</h2><div class="streak"><span>연속 운동 달성<br><span class="mini2">최고 ${t.best_streak}일</span></span><b>${t.streak}일</b></div>
  <div class="mini2">주별 완료율(%)</div><svg viewBox="0 0 ${W} ${H}" width="100%">${bars}</svg>
  <div class="mini2" style="margin:8px 0 4px">완료한 일의 시간 차이 (실제 − 예상) · 누르면 그 주로 이동</div>
  ${t.weeks.map((w) => `<button class="line" data-act="goto" data-d="${w.week_start}"><b>${mmdd(w.week_start)} 주</b><small>완료 ${w.done}/${w.planned} · 지연 ${w.delayed} · <span class="${w.done_diff_min > 5 ? 'late' : w.done_diff_min < -5 ? 'good' : ''}">${w.done_diff_min > 0 ? '+' : ''}${w.done_diff_min}분</span></small></button>`).join('')}`;
}
// 운동 이름은 목록에서 고른다. 할 일 태그에 부위(어깨, 가슴 …)가 있으면 그 부위의 운동만 나오고, 부위 태그가 없으면 전체가 나온다.
const partsOf = (t) => t.tags.split(',').filter((x) => BODY_PARTS.includes(x));
function exOptions(t, cur, eq = '') {
  const parts = partsOf(t), list = EXERCISES.filter((e) => (!parts.length || parts.includes(e.part)) && (!eq || e.eq === eq || e.name === cur));
  const known = new Set(list.map((e) => e.name));
  const groups = (parts.length ? parts : BODY_PARTS).map((pt) => ({ pt, items: list.filter((e) => e.part === pt).sort((a, b) => b.rec - a.rec || a.no - b.no) })).filter((g) => g.items.length);
  const opt = (e) => `<option value="${esc(e.name)}" ${e.name === cur ? 'selected' : ''}>${e.rec ? '● ' : ''}${esc(e.name)}${e.pp ? ' · ' + e.pp : ''}</option>`;
  return `<option value="">운동 선택</option><option value="__custom__">✎ 직접 입력</option>${cur && !known.has(cur) ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : ''}`
    + groups.map((g) => (parts.length === 1 ? g.items.map(opt).join('') : `<optgroup label="${g.pt}">${g.items.map(opt).join('')}</optgroup>`)).join('');
}
const setRow = (x = {}, t = taskById(S.sel)) => `<div class="setrow"><select name="exercise">${exOptions(t, x.exercise, document.getElementById('eqf')?.value || '')}</select><input name="weight_kg" type="number" step="0.5" min="0" placeholder="kg" value="${x.weight_kg ?? ''}"><input name="reps" type="number" min="0" placeholder="회" value="${x.reps ?? ''}"><button type="button" class="x" data-act="delset">×</button></div>`;
function setsHtml(t) {
  if (!t.tags.split(',').includes('운동')) return '';
  const done = t.runs.find((r) => r.status === 'done'), parts = partsOf(t);
  return `<h3>운동 기록 <span class="muted">세트 · 무게 · 횟수</span></h3>
  <form data-form="sets" class="sets"><select id="eqf" class="eqf"><option value="">장비 전체</option>${EQUIPMENTS.map((q) => `<option>${q}</option>`).join('')}</select><div id="setrows">${t.sets.map((x) => setRow(x, t)).join('')}</div>
  <div class="actions"><button type="button" class="btn" data-act="addset">+ 세트</button></div>
  <label class="field">컨디션 (1 나쁨 ~ 5 좋음)<select name="condition_score"><option value="">선택 안 함</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${done?.condition_score === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
  <div id="exinfo">${exInfo(t.sets.map((x) => x.exercise))}</div>
  <button class="btn pri">운동 기록 저장</button></form>`;
}
// 고른 운동의 장비 · 자세 요약
function exInfo(names) {
  const list = [...new Set(names.filter(Boolean))].map((n) => EXERCISES.find((e) => e.name === n)).filter(Boolean);
  return list.map((e) => `<div class="exinfo"><b>${esc(e.name)}</b> <span class="muted">${esc(e.part)}${e.pp ? ' · ' + e.pp : ''} · ${esc(e.eq)}</span><div>${esc(e.how)}</div>${exImg(e.no) ? `<img class="exphoto" src="${exImg(e.no)}" alt="${esc(e.name)} 자세" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"><div class="excred">사진: fitwill.app (비슷한 동작의 사진일 수 있어요)</div>` : ''}</div>`).join('');
}
const updExInfo = () => { const box = $('#exinfo'); if (box) box.innerHTML = exInfo([...document.querySelectorAll('#setrows [name=exercise]')].map((x) => x.value.trim())); };
document.addEventListener('change', (e) => {
  if (e.target.matches?.('#setrows select[name=exercise]')) {
    if (e.target.value === '__custom__') { // 목록에 없는 운동은 이름만 직접 적는다
      const inp = document.createElement('input'); inp.name = 'exercise'; inp.placeholder = '운동 이름'; inp.maxLength = 60;
      e.target.replaceWith(inp); inp.focus();
    }
    return updExInfo();
  }
  if (e.target.id === 'eqf') {
    const t = taskById(S.sel); if (!t) return;
    document.querySelectorAll('#setrows select[name=exercise]').forEach((sel) => { const cur = sel.value; sel.innerHTML = exOptions(t, cur, e.target.value); });
  }
});
function setsPayload(form) {
  const sets = [...form.querySelectorAll('.setrow')].map((r) => ({ exercise: r.querySelector('[name=exercise]').value.trim(), weight_kg: r.querySelector('[name=weight_kg]').value || 0, reps: r.querySelector('[name=reps]').value || 0 })).filter((x) => x.exercise);
  return { sets, condition_score: form.querySelector('[name=condition_score]').value };
}
// 시각 선택: 브라우저 기본 시계는 스크롤하면 계속 반복되므로, 생김새는 같고 반복되지 않는 선택창을 직접 만든다
const fmtTime = (v) => { const m = /^(\d\d):(\d\d)$/.exec(v || ''); if (!m) return '시간 선택'; const H = +m[1]; return `${H < 12 ? '오전' : '오후'} ${String(H % 12 || 12).padStart(2, '0')}:${m[2]}`; };
const timePick = (name, val, cls = '', clear = false) => `<span class="tp ${cls}" data-tp ${clear ? 'data-clear' : ''}><input type="hidden" name="${name}" value="${esc(val || '')}"><button type="button" class="tpbtn"><span>${fmtTime(val)}</span> <i>◷</i></button></span>`;
const closeTP = () => document.getElementById('tppop')?.remove();
function openTP(tp) {
  closeTP();
  const inp = tp.querySelector('input'), btn = tp.querySelector('.tpbtn');
  const cur = () => { const m = /^(\d\d):(\d\d)$/.exec(inp.value); return m ? { H: +m[1], M: +m[2] } : null; };
  const col = (k, items) => `<div class="tpcol">${items.map(([v, l]) => `<button type="button" data-k="${k}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const pop = document.createElement('div'); pop.id = 'tppop'; pop.className = 'tppop';
  pop.innerHTML = col('a', [['am', '오전'], ['pm', '오후']]) + col('h', Array.from({ length: 12 }, (_, i) => [i + 1, String(i + 1).padStart(2, '0')])) + col('m', Array.from({ length: 60 }, (_, i) => [i, String(i).padStart(2, '0')]))
    + (tp.hasAttribute('data-clear') ? '<button type="button" class="tpclr" data-k="x">지우기</button>' : '');
  document.body.append(pop);
  const r = btn.getBoundingClientRect(), h = pop.offsetHeight;
  pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 8) + 'px';
  pop.style.top = (r.bottom + 4 + h > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
  const mark = () => { const t = cur(); pop.querySelectorAll('.tpcol button').forEach((b) => b.classList.toggle('on', !!t && (b.dataset.k === 'a' ? b.dataset.v === (t.H < 12 ? 'am' : 'pm') : b.dataset.k === 'h' ? +b.dataset.v === (t.H % 12 || 12) : +b.dataset.v === t.M))); btn.firstElementChild.textContent = fmtTime(inp.value); };
  mark();
  pop.querySelectorAll('.tpcol').forEach((cl) => { const on = cl.querySelector('.on'); if (on) cl.scrollTop = on.offsetTop - cl.clientHeight / 2 + on.offsetHeight / 2; });
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.k === 'x') { inp.value = ''; mark(); return closeTP(); }
    const apply = (k, v) => {
      const t = cur() || { H: 9, M: 0 }; let pm = t.H >= 12, h12 = t.H % 12 || 12, mi = t.M;
      if (k === 'a') pm = v === 'pm'; else if (k === 'h') h12 = +v; else mi = +v;
      inp.value = `${String((h12 % 12) + (pm ? 12 : 0)).padStart(2, '0')}:${String(mi).padStart(2, '0')}`; mark();
    };
    // 이미 선택된 시·분을 한 번 더 누르면 직접 입력
    if (b.classList.contains('on') && b.dataset.k !== 'a') {
      const k = b.dataset.k, max = k === 'h' ? 12 : 59, min = k === 'h' ? 1 : 0, i = document.createElement('input');
      i.className = 'tpin'; i.inputMode = 'numeric'; i.maxLength = 2; i.value = b.textContent; b.replaceWith(i); i.focus(); i.select();
      const done = (ok) => { const n = parseInt(i.value, 10); i.replaceWith(b); if (ok && n >= min && n <= max) { apply(k, n); const cl = b.parentElement; cl.scrollTop = b.offsetTop - cl.clientHeight / 2 + b.offsetHeight / 2; } };
      i.oninput = () => { i.value = i.value.replace(/\D/g, ''); if (i.value.length === 2) done(true); };
      i.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); done(true); } else if (ev.key === 'Escape') { ev.stopPropagation(); done(false); } };
      i.onblur = () => { if (i.isConnected) done(true); };
      return;
    }
    apply(b.dataset.k, b.dataset.v);
  });
}
document.addEventListener('click', (e) => { const b = e.target.closest('.tpbtn'); if (b) { e.stopPropagation(); return openTP(b.closest('[data-tp]')); } if (!e.target.closest('#tppop')) closeTP(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTP(); });
document.addEventListener('scroll', (e) => { if (!e.target.closest?.('#tppop')) closeTP(); }, true);
const fld = (label, name, val, type = 'text', extra = '') => type === 'time' ? `<label class="field">${label}${timePick(name, val, '', name !== 'started_time')}</label>` : `<label class="field">${label}<input name="${name}" type="${type}" value="${esc(val)}" ${extra}></label>`;
function taskPanel(t) {
  if (!t) return '';
  const runs = t.runs;
  const rec = t.status === 'todo' ? `<div class="row2">${fld('시작 시각', 'started_time', t.due_time || '', 'time')}${fld('소요 시간(분)', 'actual_min', t.est_min, 'number', 'min="0"')}</div>
    <label class="field">막힘 사유 (건너뛸 때는 필수)<input name="block_reason" maxlength="300"></label>
    <div class="actions"><button class="btn pri" data-act="complete">완료</button><button class="btn" data-act="skip">건너뛰기</button></div>`
    : `<div class="actions"><button class="btn" data-act="undo">${t.status === 'done' ? '완료 취소' : '건너뜀 취소'}</button></div>`;
  const state = t.status === 'done' ? '완료' : t.status === 'skipped' ? '건너뜀' : '진행 전';
  const when = `${mmdd(t.due_date)}${t.end_date ? ' ~ ' + mmdd(t.end_date) : ''} · ${t.due_time ? fmtTime(t.due_time) : '종일'}${!t.end_date && t.est_min ? ' · ' + hm(t.est_min) : ''} · ${state}`;
  const bar = `<div class="tbar"><button class="btn" data-act="back">← 닫기</button><span style="flex:1"></span>${S.editing ? '' : '<button class="btn" data-act="edit">수정</button><button class="btn warn" data-act="del">삭제</button>'}</div>`;
  if (S.editing) return `${bar}<h2 style="margin-top:12px">이벤트 수정</h2>${taskForm(t, true)}`;
  return `${bar}
  <h2 class="ttitle" style="margin-top:12px">${esc(t.title)}${t.tags ? `<span class="ttags">${chips(t.tags)}</span>` : ''}</h2><div class="muted">${esc(when)}${t.repeat_freq ? ' · 반복 ' + (FREQ[t.repeat_freq] || '') + (t.repeat_count ? ` ${t.repeat_count}회` : t.repeat_until ? ` ${mmdd(t.repeat_until)}까지` : '') : ''}</div>
  <div class="memobox"><b>메모</b><div>${t.detail ? esc(t.detail).replace(/\n/g, '<br>') : '<span class="muted">메모 없음</span>'}</div></div>
  <div id="cklist"></div>
  <form data-form="rec">${rec}</form>${setsHtml(t)}
  <h3>실행 기록</h3>${runs.length ? runs.map((r) => `<div class="line" style="cursor:default"><b>${r.status === 'done' ? '완료' : r.status === 'skipped' ? '건너뜀' : '취소됨'}</b> · 계획일 ${mmdd(r.planned_date)}
    <small>${r.started_at ? `시작 ${esc(r.started_at.slice(11, 16))} · 종료 ${esc(r.ended_at.slice(11, 16))} · ${r.actual_min}분` : ''} ${r.condition_score ? '컨디션 ' + r.condition_score + '/5 ' : ''}${r.block_reason ? '막힘: ' + esc(r.block_reason) : ''}</small></div>`).join('') : '<div class="muted">아직 기록이 없어요</div>'}`;
}
const repeatFields = (t) => `<div class="rpbox ${t.repeat_freq ? 'rep' : ''} ${t.repeat_freq && t.repeat_until ? 'repd' : ''} ${t.repeat_freq && t.repeat_count ? 'repn' : ''}">
  <label class="field">반복<select name="rep"><option value="">안 함</option>${Object.entries(FREQ).map(([k, l]) => `<option value="${k}" ${t.repeat_freq === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
  <label class="field rpend">반복 종료<select name="repend"><option value="">안 함</option><option value="date" ${t.repeat_until ? 'selected' : ''}>날짜 지정</option><option value="count" ${t.repeat_count ? 'selected' : ''}>횟수 지정</option></select></label>
  <label class="field rpend rpdate">종료일<input type="date" name="until" value="${esc(t.repeat_until || addDays(t.due_date, 30))}"></label>
  <label class="field rpend rpcount">횟수<input type="number" name="count" min="2" max="400" value="${t.repeat_count || 10}"></label></div>`;
document.addEventListener('change', (e) => {
  const b = e.target.closest?.('.rpbox'); if (!b || !['rep', 'repend'].includes(e.target.name)) return;
  const r = b.querySelector('[name=rep]').value, d = b.querySelector('[name=repend]').value;
  b.classList.toggle('rep', !!r); b.classList.toggle('repd', !!r && d === 'date'); b.classList.toggle('repn', !!r && d === 'count');
});
function taskForm(t, inner = false) {
  const d = t || { title: '', detail: '', tags: '', due_date: S.draftDate || S.today, due_time: '', priority: 2, est_min: 30, plan_id: '' };
  // 순서: 이름 → 메모 → 날짜 → 반복 → 태그 → 색상 (우선순위는 맨 끝)
  const prio = `<input type="hidden" name="plan_id" value="${esc(d.plan_id || '')}">
  <label class="field">우선순위<select name="priority">${[1, 2, 3].map((n) => `<option value="${n}" ${n === d.priority ? 'selected' : ''}>${PR[n]}</option>`).join('')}</select></label>`;
  return `${inner ? '' : '<h2>새 이벤트</h2>'}<form data-form="task" data-id="${t?.id || ''}">${fld('이름', 'title', d.title, 'text', 'maxlength="120" required')}
  <label class="field">메모<textarea name="detail" rows="2" maxlength="400">${esc(d.detail)}</textarea></label>
  <div class="row2">${fld('시작일', 'due_date', d.due_date, 'date', 'required')}${fld('시작 시각 (선택)', 'due_time', d.due_time, 'time')}</div>
  <div class="row2">${fld('종료일 (선택)', 'end_date', d.end_date || '', 'date')}${fld('소요 시간(분)', 'est_min', d.est_min, 'number', 'min="0"')}</div>
  ${t ? repeatFields(t) : ''}
  <label class="ddchk"><input type="checkbox" name="dday" ${t && ddFor(t) ? 'checked' : ''}><span>D-day에 추가<small>시작일 기준 · 이름·날짜를 바꾸면 D-day도 같이 바뀔어요</small></span></label>
  ${tagIn(d.tags)}${tagPicker()}
  ${swatches(t?.color || '', true)}
  ${prio}
  <div class="actions"><button class="btn pri">${t ? '저장' : '추가'}</button>${t ? '<button type="button" class="btn" data-act="editcancel">취소</button>' : '<button type="button" class="btn" data-act="back">취소</button>'}</div></form>`;
}

function renderBanner() {
  const r = S.rev, n = r.note;
  $('#banner').innerHTML = `<b>이번 주 개선점 1가지</b>
  <input id="imp" maxlength="300" value="${esc(n ? n.improvement : r.suggestion)}">
  <button data-act="saveimp">${n ? '반영됨 · 다시 저장' : '다음 주에 반영'}</button>`;
}

// ── 새 이벤트 (아이폰 캘린더의 + 처럼 시트로 열림) ──
function openEvent(d) {
  closeEvent();
  document.body.insertAdjacentHTML('beforeend', `<div class="sheetbg" id="sheet"><form class="sheet" data-form="newevent">
    <div class="sh-top"><button type="button" class="sh-l" data-act="sheetclose">취소</button><b>새로운 이벤트</b><button class="sh-r">추가</button></div>
    <div class="grp"><input name="title" placeholder="제목" maxlength="120" required autofocus><input name="detail" placeholder="메모" maxlength="400"></div>
    <div class="grp">
      <label class="rowx"><span>종일</span><span class="tgl"><input type="checkbox" name="allday"><i></i></span></label>
      <div class="rowx"><span>시작</span><span class="dt2"><input type="date" name="due_date" value="${d}" required>${timePick('start', '09:00', 'tm')}</span></div>
      <div class="rowx"><span>종료</span><span class="dt2"><input type="date" name="end_date" value="${d}" required>${timePick('end', '10:00', 'tm')}</span></div>
    </div>
    <div class="grp">
      <label class="rowx"><span>반복</span><select name="rep"><option value="">안 함</option>${Object.entries(FREQ).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label class="rowx repend"><span>반복 종료</span><select name="repend"><option value="">안 함</option><option value="date">날짜 지정</option><option value="count">횟수 지정</option></select></label>
      <div class="rowx repend repdate"><span>종료일</span><span class="dt2"><input type="date" name="until" value="${addDays(d, 30)}"></span></div>
      <div class="rowx repend repcount"><span>횟수</span><span class="dt2 dur2"><input type="number" name="count" min="2" max="400" value="10"> 회</span></div>
    </div>
    <div class="grp pad">${tagIn('')}</div>
    <div class="grp">
      <label class="rowx"><span>D-day에 추가<small class="rowhint">시작 날짜 기준으로 저장돼요</small></span><span class="tgl"><input type="checkbox" name="dday"><i></i></span></label>
    </div>
    <div class="grp pad">${swatches('', false).replace('기본 (우선순위 색)', '기본 (회색)')}</div>
  </form></div>`);
  $('#sheet').addEventListener('mousedown', (e) => { if (e.target.id === 'sheet') closeEvent(); });
}
const closeEvent = () => document.getElementById('sheet')?.remove();
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeEvent(); });
document.addEventListener('change', (e) => {
  const f = e.target.closest?.('.sheet'); if (!f) return;
  if (e.target.name === 'rep' || e.target.name === 'repend') { const r = f.querySelector('[name=rep]').value, e2 = f.querySelector('[name=repend]').value; f.classList.toggle('rep', !!r); f.classList.toggle('repd', !!r && e2 === 'date'); f.classList.toggle('repn', !!r && e2 === 'count'); return; }
  const sd = f.querySelector('[name=due_date]'), ed = f.querySelector('[name=end_date]');
  if (e.target.name === 'due_date' && ed.value < sd.value) ed.value = sd.value;   // 시작일을 뒤로 옮기면 종료일도 함께
  if (e.target.name === 'end_date' && sd.value && ed.value < sd.value) ed.value = sd.value;
});
document.addEventListener('change', (e) => { if (e.target.name === 'allday') e.target.closest('.sheet').classList.toggle('allday', e.target.checked); });

// 반복 이벤트를 고치거나 지울 때: 이 이벤트만 / 이후 모든 이벤트 (애플 캘린더와 같은 방식)
function askScope(msg) {
  return new Promise((ok) => {
    closeEvent();
    document.body.insertAdjacentHTML('beforeend', `<div class="sheetbg" id="sheet"><div class="sheet ask"><p>${esc(msg)}</p>
      <button class="btn" data-s="this">이 이벤트만</button><button class="btn" data-s="future">이후 모든 이벤트</button><button class="btn" data-s="">취소</button></div></div>`);
    $('#sheet').addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (b || e.target.id === 'sheet') { closeEvent(); ok(b ? b.dataset.s : ''); } });
  });
}
const FREQ = { daily: '매일', weekly: '매주', biweekly: '2주마다', monthly: '매월', yearly: '매년' };

// 설정 (톱니바퀴): 다크 모드, 알림, 백업
function openSettings() {
  closeEvent();
  document.body.insertAdjacentHTML('beforeend', `<div class="sheetbg" id="sheet"><div class="sheet">
    <div class="sh-top"><b>설정</b><button type="button" class="sh-l" data-act="sheetclose">닫기</button></div>
    <div class="grp">
      <div class="rowx"><span>다크 모드</span><button type="button" class="tglb" id="tgDark" data-act="theme"><i></i></button></div>
      <div class="rowx"><span>알림</span><button type="button" class="tglb" id="tgBell" data-act="bell"><i></i></button></div>
    </div>
    <div class="grp">
      <div class="rowx"><span>백업 내려받기</span><a class="btn" href="/api/export?scope=all">내려받기</a></div>
      <div class="rowx"><span>백업 불러오기</span><label class="btn">불러오기<input type="file" accept=".json,application/json" id="impfile" hidden></label></div>
    </div>
    <div class="grp">
      <div class="rowx"><span>계정: <b>${esc(S.meta && S.meta.user ? S.meta.user.username : '')}</b></span><button type="button" class="btn danger" data-acc="logout">로그아웃</button></div>
      <div class="rowx"><span>비밀번호 변경</span><button type="button" class="btn" data-acc="password">변경</button></div>
      <div class="rowx"><span>계정 삭제 (내 자료도 함께 삭제)</span><button type="button" class="btn danger" data-acc="delete">삭제</button></div>
    </div></div></div>`);
  $('#sheet').addEventListener('mousedown', (e) => { if (e.target.id === 'sheet') closeEvent(); });
  $('#sheet').querySelectorAll('[data-acc]').forEach((b) => { b.onclick = run(() => accountAction(b.dataset.acc)); });
  renderRail();
}

// ── 이벤트 ──
const setWeek = run(async (d) => { S.day = d; S.ws = weekOf(d); S.mini = d; S.mode = 'review'; S.sel = null; await loadWeek(); render(); });
const pick = async (id) => { if (!taskById(id)) S.extra = [await api('/tasks/' + id)]; S.sel = id; S.mode = 'task'; S.editing = false; S.key = uid(); renderMain(); renderPanel(); };
const recVals = () => Object.fromEntries(new FormData(document.querySelector('[data-form=rec]')));
async function afterTask(msg, t) { toast(msg); S.key = uid(); await loadWeek(); if (S.view === 'list') await loadList(); if (S.view === 'tags' && S.tagSel) { S.tagItems = await api('/tag-items?tag=' + encodeURIComponent(S.tagSel)); S.extra = S.tagItems.tasks; } S.sel = t ? t.id : S.sel; render(); }

document.addEventListener('click', run(async (e) => {
  const rb = e.target.closest('.rail button[data-view]'); if (rb) { S.view = rb.dataset.view; S.mode = 'review'; if (S.view === 'trash') S.trash = await api('/trash'); if (S.view === 'list') await loadList(); if (S.view === 'tags') { S.tagSel = null; S.tags = await api('/tags'); } return render(); }
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act, id = Number(el.dataset.id);
  if (a === 'toggle') {
    e.stopPropagation(); const t = taskById(id);
    const r = t.status !== 'todo' ? await api(`/tasks/${id}/undo`, 'POST') : await api(`/tasks/${id}/complete`, 'POST', { idempotency_key: uid(), started_time: t.due_time || '00:00', actual_min: t.est_min });
    return afterTask(t.status !== 'todo' ? '되돌렸어요' : '완료로 기록했어요', r.task);
  }
  if (a === 'tagsw') { await api('/tags/color', 'PUT', { tag: el.dataset.t, color: el.dataset.c }); S.tags = await api('/tags'); return render(); }
  if (a === 'swatch') { const f = el.closest('.field'); f.querySelector('[name=color]').value = el.dataset.c; f.querySelectorAll('[data-act=swatch]').forEach((b) => b.classList.toggle('on', b === el)); return; }
  if (a === 'edit') { S.editing = true; return renderPanel(); }
  if (a === 'editcancel') { S.editing = false; return renderPanel(); }
  if (a === 'pick') return pick(id);
  if (a === 'tag') { e.stopPropagation(); return openTag(el.dataset.t); }
  if (a === 'tagback') { S.tagSel = null; return render(); }
  if (a === 'opendiary') { S.mode = 'diary'; S.dview = await api('/diary?date=' + el.dataset.d); renderMain(); return renderPanel(); }
  if (a === 'addtag') { const box = el.closest('form').querySelector('[data-tagin]'), cur = tagGet(box); if (!cur.includes(el.dataset.t)) cur.push(el.dataset.t); tagSet(box, cur); return; }
  if (a === 'tagx') { const box = el.closest('[data-tagin]'); tagSet(box, tagGet(box).filter((x) => x !== el.dataset.t)); return; }
  if (a === 'tagrename') {
    const t = el.dataset.t, to = (prompt('새 이름 (이미 있는 태그 이름이면 합쳐져요)', t) || '').trim(); if (!to || to === t) return;
    if (S.tags.some((x) => x.tag === to) && !confirm(`"${t}"을(를) 기존 "${to}" 태그와 합칠까요?`)) return;
    const r = await api('/tags/rename', 'POST', { from: t, to }); toast(`${r.changed}곳의 태그를 바꿨어요`); await loadWeek(); return render();
  }
  if (a === 'tagdel') { if (!confirm(`"${el.dataset.t}" 태그를 모든 이벤트와 일기에서 지울까요? (이벤트와 일기 자체는 남아요)`)) return; const r = await api('/tags/delete', 'POST', { tag: el.dataset.t }); toast(`${r.changed}곳에서 지웠어요`); await loadWeek(); return render(); }
  if (a === 'goto') { S.view = ['tags'].includes(S.view) ? 'calendar' : S.view; return setWeek(el.dataset.d); }
  if (a === 'week') return setWeek(addDays(S.ws, 7 * Number(el.dataset.n)));
  if (a === 'selday') { if (weekOf(el.dataset.d) === S.ws && el.dataset.d.slice(0, 7) === S.day.slice(0, 7)) { S.day = el.dataset.d; S.mode = 'review'; S.sel = null; return render(); } return setWeek(el.dataset.d); }
  if (a === 'cv') { S.cv = el.dataset.k; return renderMain(); }
  if (a === 'nav') { const n = Number(el.dataset.n), d = toD(S.day); if (S.cv === 'year') { d.setUTCFullYear(d.getUTCFullYear() + n, 0, 1); return setWeek(fmt(d)); } if (S.cv === 'month') { d.setUTCMonth(d.getUTCMonth() + n, 1); return setWeek(fmt(d)); } return setWeek(addDays(S.day, 7 * n)); }
  if (a === 'mini') { const d = toD(S.mini); d.setUTCMonth(d.getUTCMonth() + Number(el.dataset.n), 1); S.mini = fmt(d); await loadWeek(); return renderSide(); }
  if (a === 'new') return openEvent(el.dataset.d);
  if (a === 'sheetclose') return closeEvent();
  if (a === 'settings') return openSettings();
  if (a === 'back') { S.mode = 'review'; S.sel = null; return render(); }
  if (a === 'metric') { S.metric = el.dataset.k; return renderMain(); }
  if (a === 'complete') {
    const v = recVals(), sf = document.querySelector('[data-form=sets]'), sp = sf ? setsPayload(sf) : null;
    const r = await api(`/tasks/${S.sel}/complete`, 'POST', { ...v, condition_score: sp?.condition_score, idempotency_key: S.key });
    if (sp && (sp.sets.length || sp.condition_score)) await api(`/tasks/${S.sel}/sets`, 'PUT', sp);
    return afterTask(r.duplicate ? '이미 기록된 완료예요 (중복 저장 안 됨)' : '완료로 기록했어요', r.task); }
  if (a === 'skip') {
    const v = recVals(); const r = await api(`/tasks/${S.sel}/skip`, 'POST', { block_reason: v.block_reason, idempotency_key: S.key });
    return afterTask(r.moved?.length ? `운동 순서를 유지하며 ${r.moved.length}건을 하루씩 뒤로 밀었어요` : '건너뛰기로 기록했어요', r.task);
  }
  if (a === 'undo') { const r = await api(`/tasks/${S.sel}/undo`, 'POST'); return afterTask('되돌렸어요', r.task); }
  if (a === 'del') {
    const snap = structuredClone(taskById(S.sel));
    if (snap.series_id) {
      const sc = await askScope('반복 이벤트입니다. 어느 범위를 삭제할까요?'); if (!sc) return;
      if (sc === 'future') { const r = await api(`/tasks/${S.sel}?scope=future`, 'DELETE'); S.mode = 'review'; S.sel = null; await loadWeek(); if (S.view === 'list') await loadList(); render(); return toast(`반복 이벤트 ${r.deleted}개를 삭제했어요`); }
    }
    const ckSnap = await api(`/tasks/${S.sel}/checklist`).catch(() => []);
    await api('/trash', 'POST', { task: snap, runs: snap.runs, sets: snap.sets, checklist: ckSnap }).catch(() => {});
    await api(`/tasks/${S.sel}`, 'DELETE'); S.mode = 'review'; S.sel = null;
    await loadWeek(); if (S.view === 'list') await loadList(); render();
    return toast('삭제했어요 (휴지통에서도 복구할 수 있어요)', { label: '되돌리기', fn: async () => { await api('/tasks/restore', 'POST', { task: snap, runs: snap.runs, sets: snap.sets }); if (ckSnap.length) await api(`/tasks/${snap.id}/checklist`, 'PUT', { items: ckSnap }); const tl = await api('/trash').catch(() => []); const hit = tl.find((x) => x.task_id === snap.id); if (hit) await api('/trash/' + hit.id, 'DELETE'); toast('복원했어요'); await loadWeek(); if (S.view === 'list') await loadList(); render(); } });
  }
  if (a === 'ddedit') { S.ddEdit = Number(el.dataset.id); S.ddForm = true; renderDD(); return void $('#dd-title')?.focus(); }
  if (a === 'ddnew') { S.ddForm = !S.ddForm; S.ddEdit = null; renderDD(); return void $('#dd-title')?.focus(); }
  if (a === 'ddhide') { localStorage.setItem('pds-dd-hide', JSON.stringify([...ddHidden(), id])); return renderDD(); }
  if (a === 'ddunhide') { localStorage.removeItem('pds-dd-hide'); return renderDD(); }
  if (a === 'ddadd') return ddAdd();
  if (a === 'dddel') { S.dd = await api('/ddays/' + el.dataset.id, 'DELETE'); renderDD(); return renderMain(); }
  if (a === 'yday') { S.cv = 'month'; return setWeek(el.dataset.d); }
  if (a === 'ckt' || a === 'ckd' || a === 'cka') return ckAction(a, el);
  if (a === 'trashrestore' || a === 'trashdel') return trashAction(a, Number(el.dataset.tid));
  if (a === 'kbhelp') return toggleKbHelp();
  if (a === 'copyprev') { const r = await api('/copy-day', 'POST', { from: addDays(el.dataset.d, -1), to: el.dataset.d }); toast(r.created ? `전날 일정 ${r.created}개를 복사했어요` : '복사할 새 일정이 없어요 (같은 이름·시각은 건너뜀)'); await loadWeek(); return render(); }
  if (a === 'revprev') return setWeek(S.rtab === 'month' ? addDays(monthKey() + '-01', -15) : addDays(S.ws, -7));
  if (a === 'rtab') { S.rtab = el.dataset.k; await loadWeek(); renderPanel(); return renderMain(); }
  if (a === 'applyest') { const r = await api('/apply-estimate', 'POST', { title: el.dataset.t, est_min: Number(el.dataset.m) }); toast(`앞으로의 ${r.changed}건 예상 시간을 바꿨어요`); await loadWeek(); return render(); }
  if (a === 'addset') { $('#setrows').insertAdjacentHTML('beforeend', setRow()); return; }
  if (a === 'delset') { el.closest('.setrow').remove(); return updExInfo(); }
  if (a === 'theme') { const d = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = d; localStorage.setItem('pds-theme', d); return renderRail(); }
  if (a === 'bell') {
    if (!('Notification' in window)) return toast('이 브라우저는 알림을 지원하지 않아요');
    if (notifyOn()) { localStorage.setItem('pds-notify', '0'); toast('알림을 껐어요'); }
    else if ((await Notification.requestPermission()) === 'granted') { localStorage.setItem('pds-notify', '1'); toast('알림을 켰어요 (이 탭이 열려 있는 동안 작동)'); new Notification('Plan · Do · See', { body: '알림이 켜졌어요' }); }
    else toast('브라우저에서 알림이 차단되어 있어요');
    return renderRail();
  }
  if (a === 'export') {
    const d = prompt('날짜(YYYY-MM-DD)를 입력하면 그 날의 상세 목록을, 비워두면 달력 전체를 저장해요', '');
    if (d === null) return; location.href = '/api/export' + (d.trim() ? '?date=' + encodeURIComponent(d.trim()) : '');
    return;
  }
  if (a === 'saveimp') { await api('/review', 'PUT', { week_start: S.ws, improvement: $('#imp').value }); toast('다음 주에 반영했어요'); S.plans = await api('/plans'); await loadWeek(); return render(); }
}));
document.addEventListener('change', run(async (e) => {
  if (e.target.id === 'impfile') {
    const file = e.target.files[0]; if (!file) return;
    const data = JSON.parse(await file.text());
    if (!confirm('지금 데이터가 이 파일의 내용으로 교체돼요. 계속할까요?')) { e.target.value = ''; return; }
    const r = await api('/import', 'POST', data);
    toast(`불러왔어요 (계획 ${r.imported.plans} · 이벤트 ${r.imported.tasks} · 실행 기록 ${r.imported.runs})`);
    S.mode = 'review'; S.sel = null; return reload();
  }
  if (e.target.dataset.tagcolor) { await api('/tags/color', 'PUT', { tag: e.target.dataset.tagcolor, color: e.target.value }); S.tags = await api('/tags'); return render(); }
  const f = e.target.dataset.f; if (!f) return;
  S.list[f] = e.target.value; await loadList(); renderMain();
}));
document.addEventListener('submit', run(async (e) => {
  e.preventDefault();
  const form = e.target, kind = form.dataset.form, v = Object.fromEntries(new FormData(form)), id = form.dataset.id;
  if (kind === 'diary') { const d = form.dataset.d; S.dview = await api('/diary', 'PUT', { ...v, date: d }); toast(S.dview.entry ? '일기를 저장했어요' : '일기를 지웠어요'); await loadWeek(); return render(); }
  if (kind === 'addtag') { const r = await api('/tags', 'POST', v); toast(`"${r.tag}" 태그를 추가했어요`); await loadWeek(); return render(); }
  if (kind === 'newevent') {
    const all = !!v.allday;
    const same = v.end_date === v.due_date, mins = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
    if (v.end_date < v.due_date) throw new Error('종료일은 시작일보다 빠를 수 없어요');
    if (!all && same && (!v.start || !v.end || mins(v.end) < mins(v.start))) throw new Error('종료 시각은 시작 시각보다 빠를 수 없어요');
    const nt = await api('/tasks', 'POST', { title: v.title, detail: v.detail, tags: v.tags || '', due_date: v.due_date, due_time: all ? '' : v.start, end_date: v.end_date, end_time: '', est_min: all || !same ? 0 : mins(v.end) - mins(v.start), priority: 2, color: v.color, repeat: v.rep ? { freq: v.rep, until: v.repend === 'date' ? v.until : '', count: v.repend === 'count' ? +v.count : 0 } : null });
    if (v.dday) { S.dd = await api('/ddays', 'POST', { title: v.title.trim().slice(0, 30), date: v.due_date, task_id: nt && nt.id ? nt.id : undefined }); renderDD(); }
    closeEvent(); toast(v.dday ? '이벤트를 추가하고 D-day에도 저장했어요' : '이벤트를 추가했어요'); S.view = 'calendar'; S.mode = 'review'; return setWeek(v.due_date);
  }
  if (kind === 'sets') { const t = await api(`/tasks/${S.sel}/sets`, 'PUT', setsPayload(form)); S.extra = [t]; toast('운동 기록을 저장했어요'); await loadWeek(); return render(); }
  if (kind === 'task') {
    let sc = 'this', body = v;
    const old = id ? taskById(+id) : null;
    if (old) {
      const rep = v.rep || '', until = rep && v.repend === 'date' ? v.until : '', count = rep && v.repend === 'count' ? +v.count : 0;
      const rchanged = rep !== (old.repeat_freq || '') || (rep && (until !== (old.repeat_until || '') || count !== (old.repeat_count || 0)));
      if (rchanged) { body = { ...v, repeat: rep ? { freq: rep, until, count } : null }; if (old.series_id) sc = 'future'; }   // 반복을 바꾸면 이후 모든 이벤트에 적용
      else if (old.series_id) { sc = await askScope('반복 이벤트입니다. 어느 범위에 적용할까요?'); if (!sc) return; }
    }
    const ex0 = old ? ddFor(old) : null;
    const t = id ? await api(`/tasks/${id}?scope=${sc}`, 'PUT', body) : await api('/tasks', 'POST', v);
    if (form.querySelector('[name=dday]')) await ddSync(t, !!v.dday, ex0);
    toast(id ? '수정했어요' : '추가했어요'); S.mode = 'task'; S.editing = false; S.sel = t.id; S.key = uid();
    await loadWeek(); if (S.view === 'list') await loadList(); return render();
  }
}));

// 알림: 탭이 열려 있는 동안 30초마다 오늘 이벤트의 시각을 확인 (서울 시각 기준)
const notified = new Set();
setInterval(run(async () => {
  if (!notifyOn()) return;
  const [d, t] = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).split(' '), now = +t.slice(0, 2) * 60 + +t.slice(3, 5);
  const list = await api(`/tasks?from=${d}&to=${d}&status=todo`);
  list.tasks.filter((x) => x.due_time).forEach((x) => {
    const at = +x.due_time.slice(0, 2) * 60 + +x.due_time.slice(3, 5), k = x.id + d;
    if (now >= at && now - at < 5 && !notified.has(k)) { notified.add(k); new Notification(`${x.due_time} ${x.title}`, { body: x.detail || '시작할 시간이에요' }); }
  });
}), 30000);

(async () => {
  const me = await fetch('/api/auth/me');
  if (!me.ok) return showAuth(); // 로그인 전: 자료를 요청하지 않고 로그인 화면만 보여 준다
  S.meta = await api('/meta'); S.today = S.meta.today; S.day = S.today; S.ws = weekOf(S.today); S.mini = S.today;
  await reload();
})();

// ── 체크리스트 (이벤트 안의 세부 항목) ──
const loadCk = run(async () => {
  if (!$('#cklist') || S.sel == null) return;
  const id = S.sel, items = await api(`/tasks/${id}/checklist`);
  if (S.sel !== id || !$('#cklist')) return;
  S.ck = items;
  const done = items.filter((x) => x.done).length;
  $('#cklist').innerHTML = `<h3>체크리스트 ${items.length ? `<span class="muted">${done}/${items.length}</span>` : ''}</h3>`
    + items.map((x, i) => `<div class="ckrow ${x.done ? 'done' : ''}"><button class="ckb" data-act="ckt" data-i="${i}" title="체크">${x.done ? '✓' : ''}</button><span>${esc(x.text)}</span><button class="ckx" data-act="ckd" data-i="${i}" title="삭제">×</button></div>`).join('')
    + `<div class="ckadd"><input id="ck-in" maxlength="100" placeholder="세부 항목 입력 후 Enter"><button class="btn" data-act="cka">추가</button></div>`;
});
async function ckAction(a, el) {
  const items = (S.ck || []).map((x) => ({ text: x.text, done: x.done })), i = Number(el.dataset.i);
  if (a === 'ckt') items[i].done = items[i].done ? 0 : 1;
  else if (a === 'ckd') items.splice(i, 1);
  else { const inp = $('#ck-in'), v = inp ? inp.value.trim() : ''; if (!v) return inp && inp.focus(); items.push({ text: v, done: 0 }); }
  S.ck = await api(`/tasks/${S.sel}/checklist`, 'PUT', { items });
  await loadCk();
  if (a === 'cka') { const n = $('#ck-in'); if (n) n.focus(); }
}
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'ck-in' && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); ckAction('cka', e.target).catch((er) => toast(er.message)); }
});

// ── 연간 보기 ──
function renderYear(main) { yearImpl(main).catch((e) => toast(e.message)); }
async function yearImpl(main) {
  const y = S.day.slice(0, 4), pad = (n) => String(n).padStart(2, '0');
  const head = `<div class="top"><h2>${y}년</h2><div class="seg"><button data-act="cv" data-k="month">월</button><button data-act="cv" data-k="week">주</button><button class="on" data-act="cv" data-k="year">연</button></div>
    <button class="ico" data-act="nav" data-n="-1">‹</button><button class="btn" data-act="goto" data-d="${S.today}">오늘</button><button class="ico" data-act="nav" data-n="1">›</button></div>`;
  main.innerHTML = head + '<div class="muted" style="padding:20px">불러오는 중…</div>';
  const [tr, dl] = await Promise.all([api(`/tasks?from=${y}-01-01&to=${y}-12-31&sort=due`), api(`/diary-list?from=${y}-01-01&to=${y}-12-31`)]);
  if (S.cv !== 'year' || S.view !== 'calendar' || S.day.slice(0, 4) !== y) return;
  const dset = new Set(dl.map((x) => x.date)), cnt = {};
  tr.tasks.forEach((t) => { let d = t.due_date; const end = t.end_date || t.due_date; for (let k = 0; k < 62 && d <= end; k++) { cnt[d] = (cnt[d] || 0) + 1; d = addDays(d, 1); } });
  let months = '';
  for (let mo = 0; mo < 12; mo++) {
    const lead = new Date(Date.UTC(+y, mo, 1)).getUTCDay(), days = new Date(Date.UTC(+y, mo + 1, 0)).getUTCDate();
    let cells = WD.map((w) => `<i class="yh">${w[0]}</i>`).join('') + '<i></i>'.repeat(lead);
    for (let d = 1; d <= days; d++) {
      const ds = `${y}-${pad(mo + 1)}-${pad(d)}`, n = cnt[ds] || 0;
      cells += `<button class="yd l${Math.min(n, 3)} ${ds === S.today ? 'today' : ''} ${HOL[ds] ? 'hol' : ''} ${dset.has(ds) ? 'hasd' : ''}" data-act="yday" data-d="${ds}" title="${mmdd(ds)}${HOL[ds] ? ` ${esc(HOL[ds])}` : ''} · 이벤트 ${n}개${dset.has(ds) ? ' · 일기 있음' : ''}">${d}</button>`;
    }
    months += `<div class="ym"><button class="ymt" data-act="yday" data-d="${y}-${pad(mo + 1)}-01">${mo + 1}월</button><div class="yg">${cells}</div></div>`;
  }
  main.innerHTML = head + `<div class="sortnote">진할수록 이벤트가 많은 날이에요 · 점은 일기를 쓴 날 · 날짜를 누르면 그 달로 이동해요</div><div class="ygrid">${months}</div>`;
}

// ── 휴지통 ──
function renderTrash(main) {
  const L = S.trash || [];
  main.innerHTML = `<div class="top"><h2>휴지통</h2></div><div class="sortnote">삭제한 이벤트를 최근 100개까지 보관해요 · 복구하면 원래 날짜로 돌아와요</div>`
    + (L.length ? `<table><tr><th>이벤트</th><th>원래 날짜</th><th>삭제한 시각</th><th></th></tr>${L.map((x) => `<tr><td>${esc(x.title)}</td><td>${mmdd(x.due_date)}</td><td>${esc(x.deleted_at.slice(5, 16).replace('T', ' '))}</td><td><button class="btn" data-act="trashrestore" data-tid="${x.id}">복구</button> <button class="btn warn" data-act="trashdel" data-tid="${x.id}">완전 삭제</button></td></tr>`).join('')}</table>` : '<div class="muted" style="padding:16px">휴지통이 비어 있어요</div>');
}
async function trashAction(a, tid) {
  const it = (S.trash || []).find((x) => x.id === tid); if (!it) return;
  if (a === 'trashrestore') {
    const s = it.snapshot;
    await api('/tasks/restore', 'POST', { task: s.task, runs: s.runs || s.task.runs, sets: s.sets || s.task.sets });
    if ((s.checklist || []).length) await api(`/tasks/${s.task.id}/checklist`, 'PUT', { items: s.checklist });
    toast('복구했어요');
  } else if (!confirm('완전히 삭제할까요? 되돌릴 수 없어요.')) return;
  await api('/trash/' + tid, 'DELETE'); S.trash = await api('/trash'); await loadWeek(); render();
}

// ── 드래그로 일정 날짜 옮기기 (월간·주간 달력) ──
let dragId = null;
document.addEventListener('dragstart', (e) => {
  const c = e.target.closest?.('.ch[draggable=true]'); if (!c) return;
  dragId = Number(c.dataset.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragId));
});
const clearDrop = () => document.querySelectorAll('.mc.dropt').forEach((x) => x.classList.remove('dropt'));
document.addEventListener('dragend', () => { dragId = null; clearDrop(); });
document.addEventListener('dragover', (e) => {
  const c = e.target.closest?.('.mc[data-d]'); if (!c || dragId == null) return;
  e.preventDefault(); if (!c.classList.contains('dropt')) { clearDrop(); c.classList.add('dropt'); }
});
document.addEventListener('drop', run(async (e) => {
  const c = e.target.closest?.('.mc[data-d]'); if (!c || dragId == null) return;
  e.preventDefault(); const id = dragId; dragId = null; clearDrop();
  const t = taskById(id), nd = c.dataset.d; if (!t || t.due_date === nd) return;
  const prev = { ...t }, span = t.end_date ? Math.round((toD(t.end_date) - toD(t.due_date)) / 86400000) : 0;
  await api('/tasks/' + id, 'PUT', { ...t, due_date: nd, end_date: span ? addDays(nd, span) : '' });
  await loadWeek(); render();
  toast(`${mmdd(nd)}(으)로 옮겼어요`, { label: '되돌리기', fn: async () => { await api('/tasks/' + id, 'PUT', prev); await loadWeek(); render(); } });
}));

// ── 키보드 단축키 ──
const KB = [['← / →', '이전 / 다음 (달·주·연)'], ['T', '오늘로 이동'], ['M · W · Y', '월 · 주 · 연 보기'], ['N', '새 이벤트'], ['/', '일정·일기 검색'], ['1 ~ 5', '달력 · 목록 · 태그 · 회고 · 휴지통'], ['?', '이 도움말 열기/닫기'], ['Esc', '닫기']];
function toggleKbHelp() {
  const old = $('#kbhelp'); if (old) return old.remove();
  const h = document.createElement('div'); h.id = 'kbhelp';
  h.innerHTML = `<div class="kbbox"><h3>키보드 단축키</h3><table>${KB.map(([k, d]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(d)}</td></tr>`).join('')}</table><p class="muted">글자를 입력하는 중에는 동작하지 않아요</p><button class="btn" data-act="kbhelp">닫기</button></div>`;
  h.addEventListener('click', (e) => { if (e.target === h) h.remove(); });
  document.body.append(h);
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#kbhelp')) return $('#kbhelp').remove();
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  if (e.target.closest?.('input,textarea,select,button[role=combobox],[contenteditable]:not([contenteditable=false])')) return;
  const k = e.key, click = (s) => document.querySelector(s)?.click(), cal = S.view === 'calendar';
  if (k === '?') { e.preventDefault(); return toggleKbHelp(); }
  if (cal && k === 'ArrowLeft') return click('#main [data-act=nav][data-n="-1"]');
  if (cal && k === 'ArrowRight') return click('#main [data-act=nav][data-n="1"]');
  const low = k.toLowerCase();
  if (cal && low === 't') return click('#main [data-act=goto]');
  if (cal && low === 'm') return click('#main [data-act=cv][data-k=month]');
  if (cal && low === 'w') return click('#main [data-act=cv][data-k=week]');
  if (cal && low === 'y') return click('#main [data-act=cv][data-k=year]');
  if (low === 'n') return click('#panel [data-act=new]');
  if (k === '/') { e.preventDefault(); click('.rail [data-view=list]'); return void setTimeout(() => $('#f-q')?.focus(), 400); }
  const v = { 1: 'calendar', 2: 'list', 3: 'tags', 4: 'review', 5: 'trash' }[k]; if (v) click(`.rail [data-view=${v}]`);
});

// ── D-day / D+day (내가 직접 저장한 날짜) ──
S.dd = []; S.ddForm = false;
const ddOn = (d) => (S.dd || []).filter((x) => x.date === d);
function ddLabel(date) {
  const n = Math.round((toD(date) - toD(S.today)) / 86400000);
  return n === 0 ? 'D-Day' : n > 0 ? `D-${n}` : `D+${-n}`;
}
// 자동 D-day: 반복이 아닌 한 번짜리 일정(공연, 졸업식 등)은 다가오면 알아서 D-day에 나타난다 (60일 이내, 최대 6개)
const ddHidden = () => { try { return JSON.parse(localStorage.getItem('pds-dd-hide') || '[]'); } catch { return []; } };
function loadAutoDD() {
  if (!S.today) return; S.autoAt = Date.now();
  api(`/tasks?from=${S.today}&to=${addDays(S.today, 60)}&sort=due`).then((r) => {
    S.dda = r.tasks.filter((t) => !t.series_id && !t.repeat_freq && t.status === 'todo').map((t) => ({ id: t.id, title: t.title, date: t.due_date, kind: 'a' }));
    renderDD(); if (S.view === 'calendar') renderMain();
  }).catch(() => {});
}
function renderDD() {
  const box = $('#ddlist'); if (!box || !S.today) return;
  if (!S.autoAt || Date.now() - S.autoAt > 3000) loadAutoDD();
  const hid = ddHidden(), manual = (S.dd || []).map((x) => ({ ...x, kind: 'm' }));
  const auto = (S.dda || []).filter((x) => !hid.includes(x.id) && !manual.some((m) => m.title === x.title && m.date === x.date)).slice(0, 6);
  const nHid = (S.dda || []).filter((x) => hid.includes(x.id)).length;
  const list = [...manual, ...auto].sort((a, b) => {   // 다가오는 날(가까운 순) 먼저, 지난 날(최근 순)은 뒤에
    const fa = a.date >= S.today, fb = b.date >= S.today;
    return fa !== fb ? (fa ? -1 : 1) : fa ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
  });
  const ed = S.ddEdit ? (S.dd || []).find((x) => x.id === S.ddEdit) : null;
  const form = S.ddForm ? `<div class="ddform"><label class="field">이름<input id="dd-title" maxlength="30" placeholder="예: 공연, 사귄 날" value="${ed ? esc(ed.title) : ''}"></label><label class="field">날짜<input id="dd-date" type="date" value="${ed ? ed.date : S.today}"></label>${ed && ed.task_id ? '<div class="ddhint">일정과 연결돼 있어요 (일정에서 이름·날짜를 바꾸면 같이 바뀔어요)</div>' : '<label class="ddchk"><input type="checkbox" id="dd-event"><span>일정에도 추가<small>달력에 하루짜리 일정으로 만들어요</small></span></label>'}<div class="ddbtn"><button class="btn" data-act="ddnew">취소</button><button class="btn pri" data-act="ddadd">저장</button></div></div>` : '';
  const row = (x) => `<div class="ddrow ${x.date < S.today ? 'past' : x.date === S.today ? 'now' : ''}"><span class="ddb">${ddLabel(x.date)}</span><span class="ddt">${esc(x.title)}<small>${mmdd(x.date)}${x.kind === 'a' ? ' · 일정에서 자동' : ''}</small></span>`
    + (x.kind === 'a' ? `<button class="ckx" data-act="ddhide" data-id="${x.id}" title="D-day에서 숨기기">×</button>` : `<button class="ckx ddedit" data-act="ddedit" data-id="${x.id}" title="수정">✎</button><button class="ckx" data-act="dddel" data-id="${x.id}" title="삭제">×</button>`) + '</div>';
  box.innerHTML = form + (list.length ? list.map(row).join('') : (S.ddForm ? '' : '<div class="ddempty">다가오는 일정이 없어요<br>+ 를 눌러 기념일·약속을 추가해 보세요</div>'))
    + (nHid ? `<button class="ddunhide" data-act="ddunhide">숨긴 자동 일정 ${nHid}개 다시 보기</button>` : '');
}async function ddAdd() {
  const t = $('#dd-title').value.trim(), d = $('#dd-date').value;
  if (!t) { toast('이름을 입력해 주세요'); return $('#dd-title').focus(); }
  if (!d) return toast('날짜를 골라 주세요');
  const eid = S.ddEdit, wantEv = !!$('#dd-event')?.checked;
  let tid;
  if (wantEv) { const nt = await api('/tasks', 'POST', { title: t, detail: '', tags: '', due_date: d, due_time: '', end_date: '', end_time: '', est_min: 0, priority: 2, color: '', repeat: null }); tid = nt && nt.id; }
  S.dd = eid ? await api('/ddays/' + eid, 'PUT', { title: t, date: d, task_id: tid }) : await api('/ddays', 'POST', { title: t, date: d, task_id: tid });
  S.ddForm = false; S.ddEdit = null; renderDD();
  if (wantEv) { await loadWeek(); render(); } else renderMain();
  toast(wantEv ? 'D-day와 일정에 함께 저장했어요' : eid ? '수정했어요' : '저장했어요');
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing && (e.target.id === 'dd-title' || e.target.id === 'dd-date')) { e.preventDefault(); ddAdd().catch((er) => toast(er.message)); }
});
api('/ddays').then((v) => { S.dd = v; renderDD(); if (S.today) renderMain(); }).catch(() => {});

// 이벤트 ↔ D-day 연결 (수정 화면의 "D-day에 추가" 스위치)
const ddFor = (t) => (S.dd || []).find((x) => x.task_id === t.id) || (S.dd || []).find((x) => x.title === String(t.title).trim().slice(0, 30) && x.date === t.due_date);
async function ddSync(t, want, ex) {
  const title = String(t.title).trim().slice(0, 30);
  if (want && ex) S.dd = await api('/ddays/' + ex.id, 'PUT', { title, date: t.due_date, task_id: t.id });
  else if (want) S.dd = await api('/ddays', 'POST', { title, date: t.due_date, task_id: t.id });
  else if (ex) S.dd = await api('/ddays/' + ex.id, 'DELETE');
  renderDD();
}

// 태그 색 고르는 팝업이 표 안에서 잘리지 않게: 화면 기준(fixed)으로 띄우고, 아래 공간이 모자라면 위로 연다
document.addEventListener('toggle', (e) => {
  const d = e.target; if (!d.classList?.contains('tagsw') || !d.open) return;
  document.querySelectorAll('details.tagsw[open]').forEach((o) => { if (o !== d) o.open = false; });
  const sw = d.querySelector('.sw'), r = d.getBoundingClientRect(), h = sw.offsetHeight || 90, w = sw.offsetWidth || 200;
  const below = window.innerHeight - r.bottom - 12 >= h;
  sw.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
  sw.style.top = (below ? r.bottom + 6 : Math.max(8, r.top - h - 6)) + 'px';
}, true);
document.addEventListener('scroll', () => document.querySelectorAll('details.tagsw[open]').forEach((o) => { o.open = false; }), true);
document.addEventListener('click', (e) => { if (!e.target.closest?.('details.tagsw')) document.querySelectorAll('details.tagsw[open]').forEach((o) => { o.open = false; }); });