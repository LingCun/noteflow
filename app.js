/* ─────────────────────────────────────────
   NoteFlow — app.js
   Firebase Auth (Google) + Firestore
───────────────────────────────────────── */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, deleteDoc, getDoc,
  onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBWKsa8Jm6AKZQAszBGUoACMbLzxJaTSGw",
  authDomain: "noteflow-e4230.firebaseapp.com",
  projectId: "noteflow-e4230",
  storageBucket: "noteflow-e4230.firebasestorage.app",
  messagingSenderId: "403144303048",
  appId: "1:403144303048:web:c8a5bbac327f7a802ba0fd",
  measurementId: "G-14BPDTD84P"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

// ── State ──────────────────────────────
let currentUser = null;
let notes = [];
let currentId = null;
let saveTimer = null;
let sidebarOpen = true;
let notesUnsubscribe = null;
let activeDateFilter = null;   // 'YYYY-MM-DD' or null

// ── DOM Refs ───────────────────────────
const notesList      = document.getElementById('notesList');
const noteTitleInput = document.getElementById('noteTitleInput');
const editor         = document.getElementById('editor');
const editorContent  = document.getElementById('editorContent');
const emptyState     = document.getElementById('emptyState');
const noteMeta       = document.getElementById('noteMeta');
const noteMetaTime   = document.getElementById('noteMetaTime');
const noteDateInput  = document.getElementById('noteDateInput');
const noteDateText   = document.getElementById('noteDateText');
const wordCount      = document.getElementById('wordCount');
const searchInput    = document.getElementById('searchInput');
const toast          = document.getElementById('toast');
const modalOverlay   = document.getElementById('modalOverlay');
const sidebar        = document.getElementById('sidebar');
const loginScreen    = document.getElementById('loginScreen');
const appShell       = document.getElementById('appShell');
const googleBtn      = document.getElementById('googleLoginBtn');
const userAvatar     = document.getElementById('userAvatar');
const userName       = document.getElementById('userName');
const logoutBtn      = document.getElementById('logoutBtn');
const filterChip     = document.getElementById('filterChip');
const filterChipText = document.getElementById('filterChipText');
const filterClearBtn = document.getElementById('filterClearBtn');

// ── Helpers ────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function userRef() {
  return doc(db, 'users', currentUser.uid);
}
function userNotesCol() {
  return collection(db, 'users', currentUser.uid, 'notes');
}
function noteRef(id) {
  return doc(db, 'users', currentUser.uid, 'notes', id);
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr  = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffMin < 1)  return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffHr  < 24) return `${diffHr}시간 전`;
  if (diffDay < 7)  return `${diffDay}일 전`;
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getPlainText(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  return div.textContent || div.innerText || '';
}

function updateWordCount() {
  const text = (getPlainText(editor.innerHTML) + noteTitleInput.value).trim();
  const len = text.replace(/\s/g, '').length;
  wordCount.textContent = `${len}자`;
}

function showToast(msg, type = 'default', icon = '') {
  toast.innerHTML = `${icon ? `<span>${icon}</span>` : ''}<span>${msg}</span>`;
  toast.className = `toast show ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.className = 'toast'; }, 2200);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Date helpers ──────────────────────
function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function noteDateOf(n) {
  if (n && n.noteDate) return n.noteDate;
  if (n && n.createdAt) return dateKey(new Date(n.createdAt));
  return dateKey(new Date());
}
const DOW_KO = ['일','월','화','수','목','금','토'];
function formatNoteDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dow = DOW_KO[new Date(y, m - 1, d).getDay()];
  return `${y}년 ${m}월 ${d}일 (${dow})`;
}
function formatFilterChipText(key) {
  const [, m, d] = key.split('-').map(Number);
  return `${m}월 ${d}일의 메모`;
}

// ── Auth ───────────────────────────────
googleBtn.addEventListener('click', async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
      showToast(`로그인 실패: ${err.code || err.message}`, 'error', '⚠️');
    }
  }
});

logoutBtn.addEventListener('click', async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    let isNew = false;
    try {
      const existing = await getDoc(userRef());
      isNew = !existing.exists();
      await setDoc(userRef(), {
        uid: user.uid,
        displayName: user.displayName || '',
        email: user.email || '',
        photoURL: user.photoURL || '',
        lastLoginAt: Date.now(),
        ...(isNew ? { createdAt: Date.now() } : {})
      }, { merge: true });
    } catch (err) {
      console.error('User profile save failed:', err);
    }
    showApp();
    subscribeToNotes(isNew);
  } else {
    currentUser = null;
    if (notesUnsubscribe) { notesUnsubscribe(); notesUnsubscribe = null; }
    notes = [];
    currentId = null;
    showLogin();
  }
});

function showLogin() {
  loginScreen.style.display = 'flex';
  appShell.style.display = 'none';
}

function showApp() {
  loginScreen.style.display = 'none';
  appShell.style.display = '';
  if (currentUser.photoURL) {
    userAvatar.src = currentUser.photoURL;
    userAvatar.style.display = '';
  } else {
    userAvatar.style.display = 'none';
  }
  userAvatar.alt = currentUser.displayName || '사용자';
  userName.textContent = currentUser.displayName || currentUser.email || '사용자';
}

// ── Subscribe to notes ─────────────────
function subscribeToNotes(isNewUser) {
  if (notesUnsubscribe) notesUnsubscribe();
  const q = query(userNotesCol(), orderBy('updatedAt', 'desc'));
  let firstSnap = true;
  notesUnsubscribe = onSnapshot(q, async (snap) => {
    notes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSidebar(searchInput.value);
    window.dispatchEvent(new Event('noteflow:notes-updated'));

    if (firstSnap) {
      firstSnap = false;
      if (isNewUser && notes.length === 0) {
        await createWelcomeNote();
        return;
      }
      if (notes.length > 0 && !currentId) {
        selectNote(notes[0].id);
      } else if (notes.length === 0) {
        emptyState.style.display = '';
        editorContent.style.display = 'none';
      }
    }
  }, (err) => {
    console.error('Notes subscription error:', err);
    showToast('동기화 오류', 'error', '⚠️');
  });
}

async function createWelcomeNote() {
  const id = genId();
  try {
    await setDoc(noteRef(id), {
      title: 'NoteFlow에 오신 걸 환영해요 👋',
      content: `<p>안녕하세요! <strong>NoteFlow</strong>는 당신의 아이디어를 자유롭게 기록하는 공간입니다.</p>
<br>
<p>✦ <strong>새 메모</strong> — 오른쪽 상단 <strong>+</strong> 버튼 또는 <strong>Ctrl+N</strong></p>
<p>✦ <strong>달력</strong> — 왼쪽 달력에서 날짜를 클릭하면 그 날의 메모만 보여요</p>
<p>✦ <strong>저장</strong> — 입력하면 자동으로 클라우드에 저장됩니다</p>
<p>✦ <strong>서식</strong> — 텍스트를 드래그하고 툴바의 B / I / U 버튼을 눌러보세요</p>
<br>
<p>다른 기기에서도 같은 Google 계정으로 로그인하면 메모가 그대로 보입니다. 🚀</p>`,
      noteDate: dateKey(new Date()),
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  } catch (err) {
    console.error('Welcome note failed:', err);
  }
}

// ── Render Sidebar ─────────────────────
function renderSidebar(qStr = '') {
  const q = (qStr || '').toLowerCase().trim();

  // Filter chip visibility
  if (activeDateFilter) {
    filterChip.style.display = '';
    filterChipText.textContent = formatFilterChipText(activeDateFilter);
  } else {
    filterChip.style.display = 'none';
  }

  let filtered = notes.filter(n =>
    !q || (n.title || '').toLowerCase().includes(q) || getPlainText(n.content).toLowerCase().includes(q)
  );
  if (activeDateFilter) {
    filtered = filtered.filter(n => noteDateOf(n) === activeDateFilter);
  }
  filtered.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  if (filtered.length === 0) {
    const msg = activeDateFilter
      ? `${formatFilterChipText(activeDateFilter)}가 없습니다`
      : (q ? '검색 결과가 없습니다' : '메모가 없습니다');
    notesList.innerHTML = `
      <div class="empty-list">
        <div class="empty-list-icon">📝</div>
        <div>${msg}</div>
      </div>`;
    return;
  }

  notesList.innerHTML = filtered.map(n => {
    const preview = getPlainText(n.content).slice(0, 60) || '내용 없음';
    return `
      <div class="note-item ${n.id === currentId ? 'active' : ''}"
           data-id="${n.id}" id="item-${n.id}">
        <div class="note-item-title">${escapeHtml(n.title) || '제목 없음'}</div>
        <div class="note-item-preview">${escapeHtml(preview)}</div>
        <div class="note-item-date">${formatDate(n.updatedAt)}</div>
        <div class="note-item-dot"></div>
      </div>`;
  }).join('');

  notesList.querySelectorAll('.note-item').forEach(el => {
    el.addEventListener('click', () => selectNote(el.dataset.id));
  });
}

// ── Select / Open Note ─────────────────
function selectNote(id) {
  const note = notes.find(n => n.id === id);
  if (!note) return;
  currentId = id;
  noteTitleInput.value = note.title || '';
  editor.innerHTML = note.content || '';
  const dk = noteDateOf(note);
  noteDateInput.value = dk;
  noteDateText.textContent = formatNoteDate(dk);
  noteMetaTime.textContent = `마지막 수정: ${formatDate(note.updatedAt)}`;
  emptyState.style.display = 'none';
  editorContent.style.display = 'flex';
  renderSidebar(searchInput.value);
  updateWordCount();
  editor.focus();
  if (window.innerWidth <= 640) setSidebar(false);
}

// ── Create Note ────────────────────────
async function createNote() {
  if (!currentUser) return;
  const id = genId();
  const noteDate = activeDateFilter || dateKey(new Date());
  const data = {
    title: '',
    content: '',
    noteDate,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  notes.unshift({ id, ...data });
  currentId = id;
  selectNote(id);
  window.dispatchEvent(new Event('noteflow:notes-updated'));
  setTimeout(() => noteTitleInput.focus(), 50);
  try {
    await setDoc(noteRef(id), data);
  } catch (err) {
    console.error('Create note failed:', err);
    showToast('메모 생성 실패', 'error', '⚠️');
  }
}

// ── Auto-save current note ─────────────
async function autoSave() {
  if (!currentId || !currentUser) return;
  const idx = notes.findIndex(n => n.id === currentId);
  if (idx === -1) return;
  const data = {
    title: noteTitleInput.value,
    content: editor.innerHTML,
    noteDate: noteDateInput.value || noteDateOf(notes[idx]),
    updatedAt: Date.now()
  };
  notes[idx].title = data.title;
  notes[idx].content = data.content;
  notes[idx].noteDate = data.noteDate;
  notes[idx].updatedAt = data.updatedAt;
  renderSidebar(searchInput.value);
  noteMetaTime.textContent = `마지막 수정: 방금 전`;
  try {
    await setDoc(noteRef(currentId), data, { merge: true });
  } catch (err) {
    console.error('Save failed:', err);
    showToast('저장 실패', 'error', '⚠️');
  }
}

function scheduleAutoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(autoSave, 800);
}

async function manualSave() {
  if (!currentId) return;
  clearTimeout(saveTimer);
  await autoSave();
  showToast('저장되었습니다', 'success', '✓');
}

// ── Delete Note ────────────────────────
function confirmDelete() {
  if (!currentId) return;
  modalOverlay.classList.add('show');
}

async function deleteCurrentNote() {
  if (!currentId || !currentUser) return;
  const id = currentId;
  notes = notes.filter(n => n.id !== id);
  currentId = null;
  editorContent.style.display = 'none';
  emptyState.style.display = '';
  modalOverlay.classList.remove('show');
  renderSidebar(searchInput.value);
  try {
    await deleteDoc(noteRef(id));
    showToast('메모를 삭제했습니다', 'error', '🗑️');
  } catch (err) {
    console.error('Delete failed:', err);
    showToast('삭제 실패', 'error', '⚠️');
  }
}

// ── Sidebar Toggle ─────────────────────
function setSidebar(open) {
  sidebarOpen = open;
  if (open) sidebar.classList.remove('collapsed');
  else sidebar.classList.add('collapsed');
}

// ── Toolbar Actions ────────────────────
function execCmd(cmd, value = null) {
  document.execCommand(cmd, false, value);
  editor.focus();
}

function syncToolbar() {
  document.getElementById('boldBtn').classList.toggle('active', document.queryCommandState('bold'));
  document.getElementById('italicBtn').classList.toggle('active', document.queryCommandState('italic'));
  document.getElementById('underlineBtn').classList.toggle('active', document.queryCommandState('underline'));
}

// ── Event Listeners ────────────────────
document.getElementById('newNoteBtn').addEventListener('click', createNote);
document.getElementById('startBtn').addEventListener('click', createNote);
document.getElementById('rightPanelToggle').addEventListener('click', () => setSidebar(!sidebarOpen));
document.getElementById('rightPanelToggle').classList.add('active');

filterClearBtn.addEventListener('click', () => {
  activeDateFilter = null;
  renderSidebar(searchInput.value);
  // Also clear selectedKey on calendar (handled via custom event so calendar block can listen)
  window.dispatchEvent(new Event('noteflow:filter-cleared'));
});

noteDateInput.addEventListener('change', () => {
  if (!currentId) return;
  const v = noteDateInput.value;
  if (!v) return;
  noteDateText.textContent = formatNoteDate(v);
  scheduleAutoSave();
  const idx = notes.findIndex(n => n.id === currentId);
  if (idx !== -1) notes[idx].noteDate = v;
  window.dispatchEvent(new Event('noteflow:notes-updated'));
});

noteTitleInput.addEventListener('input', () => { scheduleAutoSave(); updateWordCount(); });
noteTitleInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); editor.focus(); }
});

editor.addEventListener('input', () => { scheduleAutoSave(); updateWordCount(); });
editor.addEventListener('keyup', syncToolbar);
editor.addEventListener('mouseup', syncToolbar);

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); manualSave(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); createNote(); }
});

searchInput.addEventListener('input', () => renderSidebar(searchInput.value));
document.getElementById('saveBtn').addEventListener('click', manualSave);
document.getElementById('deleteBtn').addEventListener('click', confirmDelete);
document.getElementById('modalCancel').addEventListener('click', () => modalOverlay.classList.remove('show'));
document.getElementById('modalConfirm').addEventListener('click', deleteCurrentNote);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) modalOverlay.classList.remove('show'); });

document.getElementById('boldBtn').addEventListener('click', () => { execCmd('bold'); syncToolbar(); });
document.getElementById('italicBtn').addEventListener('click', () => { execCmd('italic'); syncToolbar(); });
document.getElementById('underlineBtn').addEventListener('click', () => { execCmd('underline'); syncToolbar(); });
document.getElementById('listBtn').addEventListener('click', () => { execCmd('insertUnorderedList'); });

document.getElementById('fontSizeSelect').addEventListener('change', function() {
  const size = this.value;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;
  const span = document.createElement('span');
  span.style.fontSize = size;
  try { range.surroundContents(span); } catch {}
  editor.focus();
});

document.getElementById('colorPicker').addEventListener('input', function() {
  const color = this.value;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;
  const span = document.createElement('span');
  span.style.color = color;
  try { range.surroundContents(span); } catch {}
  editor.focus();
});

// ── Calendar (mouse-wheel month picker) ──────────────
{
  const calendarPanel      = document.getElementById('calendarPanel');
  const calendarToggleBtn  = document.getElementById('leftPanelToggle');
  const calendarPanelClose = document.getElementById('calendarPanelClose');
  const monthTape          = document.getElementById('monthTape');
  const monthTapeWrap      = document.getElementById('monthTapeWrap');
  const calDaysGrid        = document.getElementById('calDaysGrid');
  const todayBtn           = document.getElementById('todayBtn');
  const monthLabel         = document.getElementById('monthLabel');

  const ITEM_H = 56;
  const VISIBLE_ROWS = 3;

  const todayDate = new Date();
  const todayIdx  = todayDate.getFullYear() * 12 + todayDate.getMonth();
  const range = { from: todayIdx - 60 * 12, to: todayIdx + 30 * 12 };

  let position    = todayIdx;   // float; integer == snapped
  let velocity    = 0;
  let lastWheel   = 0;
  let rafId       = null;
  let snappedIdx  = todayIdx;
  let selectedKey = null;

  const fromIdx = (i) => ({ year: Math.floor(i / 12), month: ((i % 12) + 12) % 12 });

  function renderTapeLabels() {
    const html = [];
    for (let i = range.from; i <= range.to; i++) {
      const { year, month } = fromIdx(i);
      html.push(
        `<div class="month-tape-item" data-idx="${i}" style="height:${ITEM_H}px">
          <span class="tape-year">${year}</span>
          <span class="tape-month">${month + 1}월</span>
        </div>`
      );
    }
    monthTape.innerHTML = html.join('');
  }

  function tapeTransform() {
    const containerH = ITEM_H * VISIBLE_ROWS;
    const centerY = containerH / 2 - ITEM_H / 2;
    const offset = (position - range.from) * ITEM_H;
    monthTape.style.transform = `translateY(${centerY - offset}px)`;
  }

  function markCenter() {
    const centerIdx = Math.round(position);
    const items = monthTape.children;
    for (let k = 0; k < items.length; k++) {
      const el = items[k];
      const idx = parseInt(el.dataset.idx, 10);
      el.classList.toggle('center', idx === centerIdx);
    }
  }

  function setScrolling(s) {
    monthTapeWrap.classList.toggle('scrolling', s);
    calDaysGrid.classList.toggle('scrolling', s);
  }

  function noteDateSet() {
    const set = new Set();
    notes.forEach(n => set.add(noteDateOf(n)));
    return set;
  }

  function renderGrid(idx) {
    const { year, month } = fromIdx(idx);
    const firstDow     = new Date(year, month, 1).getDay();
    const daysInMonth  = new Date(year, month + 1, 0).getDate();
    const todayKey     = dateKey(todayDate);
    const noteDates    = noteDateSet();

    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(`<div class="cal-cell empty"></div>`);
    for (let day = 1; day <= daysInMonth; day++) {
      const key = dateKey(new Date(year, month, day));
      const cls = [
        'cal-cell',
        key === todayKey ? 'today' : '',
        key === selectedKey ? 'selected' : '',
      ].filter(Boolean).join(' ');
      const dot = noteDates.has(key) ? '<span class="cal-dot"></span>' : '';
      cells.push(
        `<div class="${cls}" data-date="${key}">
          <span class="cal-day">${day}</span>${dot}
        </div>`
      );
    }
    calDaysGrid.innerHTML = cells.join('');
    monthLabel.textContent = `${year}년 ${month + 1}월`;

    calDaysGrid.querySelectorAll('.cal-cell:not(.empty)').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.dataset.date;
        selectedKey = key;
        activeDateFilter = key;
        renderGrid(idx);
        renderSidebar(searchInput.value);
        // Open first note from that day if any
        const match = notes.find(n => noteDateOf(n) === key);
        if (match) {
          selectNote(match.id);
        } else {
          currentId = null;
          editorContent.style.display = 'none';
          emptyState.style.display = '';
        }
      });
    });
  }

  function onWheel(e) {
    e.preventDefault();
    const now = performance.now();
    const dt = now - lastWheel;
    lastWheel = now;
    const dir = e.deltaY > 0 ? 1 : -1;
    const boost = dt < 60 ? 0.55 : dt < 120 ? 0.32 : 0.16;
    velocity += dir * boost;
    if (velocity >  2.5) velocity =  2.5;
    if (velocity < -2.5) velocity = -2.5;
    if (rafId === null) loop();
  }

  function loop() {
    rafId = requestAnimationFrame(() => {
      rafId = null;
      position += velocity;
      velocity *= 0.88;

      if (position < range.from) { position = range.from; velocity = 0; }
      if (position > range.to)   { position = range.to;   velocity = 0; }

      const moving = Math.abs(velocity) > 0.02;
      if (!moving) {
        // Snap easing — kill momentum and pull straight toward nearest integer
        velocity = 0;
        const target = Math.round(position);
        const diff   = target - position;
        if (Math.abs(diff) < 0.015) {
          position = target;
          tapeTransform();
          markCenter();
          setScrolling(false);
          if (target !== snappedIdx) {
            snappedIdx = target;
            renderGrid(snappedIdx);
          }
          return;
        }
        position += diff * 0.35;
        setScrolling(false);  // grid sharpens during snap easing
      } else {
        setScrolling(true);
      }
      tapeTransform();
      markCenter();
      loop();
    });
  }

  function animateTo(target) {
    velocity = 0;
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    const startPos  = position;
    const startTime = performance.now();
    const dur = 600;
    function tween() {
      const t = Math.min(1, (performance.now() - startTime) / dur);
      const ease = 1 - Math.pow(1 - t, 3);
      position = startPos + (target - startPos) * ease;
      setScrolling(t < 0.95);
      tapeTransform();
      markCenter();
      if (t >= 1) {
        position = target;
        setScrolling(false);
        if (target !== snappedIdx) {
          snappedIdx = target;
          renderGrid(snappedIdx);
        }
        return;
      }
      requestAnimationFrame(tween);
    }
    requestAnimationFrame(tween);
  }

  // Init
  renderTapeLabels();
  tapeTransform();
  markCenter();
  renderGrid(snappedIdx);

  monthTapeWrap.addEventListener('wheel', onWheel, { passive: false });

  todayBtn.addEventListener('click', () => {
    const t = new Date();
    selectedKey = null;
    activeDateFilter = null;
    renderSidebar(searchInput.value);
    const target = t.getFullYear() * 12 + t.getMonth();
    if (target === snappedIdx) renderGrid(snappedIdx);  // already on this month: just clear selection
    else animateTo(target);
  });

  window.addEventListener('noteflow:filter-cleared', () => {
    selectedKey = null;
    renderGrid(snappedIdx);
  });

  function setCalendarOpen(open) {
    calendarPanel.classList.toggle('collapsed', !open);
    calendarPanel.style.width    = open ? '' : '0px';
    calendarPanel.style.minWidth = open ? '' : '0px';
    calendarToggleBtn.classList.toggle('active', open);
  }
  calendarToggleBtn.addEventListener('click', () => {
    setCalendarOpen(calendarPanel.classList.contains('collapsed'));
  });
  calendarPanelClose.addEventListener('click', () => setCalendarOpen(false));
  // start open + button active
  setCalendarOpen(true);
  // auto-collapse on narrow screens
  if (window.innerWidth <= 1100) setCalendarOpen(false);

  window.addEventListener('noteflow:notes-updated', () => renderGrid(snappedIdx));
}
