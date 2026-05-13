/* ─────────────────────────────────────────
   NoteFlow — app.js
   완전한 메모장 앱 로직
───────────────────────────────────────── */

const STORAGE_KEY = 'noteflow_notes';

// ── State ──────────────────────────────
let notes = [];
let currentId = null;
let saveTimer = null;
let sidebarOpen = true;

// ── DOM Refs ───────────────────────────
const notesList      = document.getElementById('notesList');
const noteTitleInput = document.getElementById('noteTitleInput');
const editor         = document.getElementById('editor');
const editorContent  = document.getElementById('editorContent');
const emptyState     = document.getElementById('emptyState');
const noteMeta       = document.getElementById('noteMeta');
const wordCount      = document.getElementById('wordCount');
const searchInput    = document.getElementById('searchInput');
const toast          = document.getElementById('toast');
const modalOverlay   = document.getElementById('modalOverlay');
const sidebar        = document.getElementById('sidebar');

// ── Helpers ────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    notes = raw ? JSON.parse(raw) : [];
  } catch {
    notes = [];
  }
}

function formatDate(ts) {
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
  div.innerHTML = html;
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

// ── Render Sidebar ─────────────────────
function renderSidebar(query = '') {
  const q = query.toLowerCase().trim();
  const filtered = notes
    .filter(n => !q || n.title.toLowerCase().includes(q) || getPlainText(n.content).toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (filtered.length === 0) {
    notesList.innerHTML = `
      <div class="empty-list">
        <div class="empty-list-icon">📝</div>
        <div>${q ? '검색 결과가 없습니다' : '메모가 없습니다'}</div>
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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Select / Open Note ─────────────────
function selectNote(id) {
  const note = notes.find(n => n.id === id);
  if (!note) return;

  currentId = id;
  noteTitleInput.value = note.title;
  editor.innerHTML = note.content;
  noteMeta.textContent = `마지막 수정: ${formatDate(note.updatedAt)}`;

  emptyState.style.display = 'none';
  editorContent.style.display = 'flex';

  renderSidebar(searchInput.value);
  updateWordCount();
  editor.focus();

  // On mobile, collapse sidebar
  if (window.innerWidth <= 640) {
    setSidebar(false);
  }
}

// ── Create Note ────────────────────────
function createNote() {
  const note = {
    id: genId(),
    title: '',
    content: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  notes.unshift(note);
  save();
  renderSidebar(searchInput.value);
  selectNote(note.id);
  noteTitleInput.focus();
}

// ── Auto-save current note ─────────────
function autoSave() {
  if (!currentId) return;
  const idx = notes.findIndex(n => n.id === currentId);
  if (idx === -1) return;
  notes[idx].title   = noteTitleInput.value;
  notes[idx].content = editor.innerHTML;
  notes[idx].updatedAt = Date.now();
  save();
  noteMeta.textContent = `마지막 수정: 방금 전`;
  renderSidebar(searchInput.value);
}

function scheduleAutoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(autoSave, 800);
}

// ── Manual Save ────────────────────────
function manualSave() {
  if (!currentId) return;
  clearTimeout(saveTimer);
  autoSave();
  showToast('저장되었습니다', 'success', '✓');
}

// ── Delete Note ────────────────────────
function confirmDelete() {
  if (!currentId) return;
  modalOverlay.classList.add('show');
}

function deleteCurrentNote() {
  notes = notes.filter(n => n.id !== currentId);
  save();
  currentId = null;
  editorContent.style.display = 'none';
  emptyState.style.display = '';
  renderSidebar(searchInput.value);
  modalOverlay.classList.remove('show');
  showToast('메모를 삭제했습니다', 'error', '🗑️');
}

// ── Sidebar Toggle ─────────────────────
function setSidebar(open) {
  sidebarOpen = open;
  if (open) {
    sidebar.classList.remove('collapsed');
  } else {
    sidebar.classList.add('collapsed');
  }
}

// ── Toolbar Actions ────────────────────
function execCmd(cmd, value = null) {
  document.execCommand(cmd, false, value);
  editor.focus();
}

// Sync toolbar button active states
function syncToolbar() {
  document.getElementById('boldBtn').classList.toggle('active', document.queryCommandState('bold'));
  document.getElementById('italicBtn').classList.toggle('active', document.queryCommandState('italic'));
  document.getElementById('underlineBtn').classList.toggle('active', document.queryCommandState('underline'));
}

// ── Event Listeners ────────────────────

// New note buttons
document.getElementById('newNoteBtn').addEventListener('click', createNote);
document.getElementById('startBtn').addEventListener('click', createNote);

// Sidebar toggle
document.getElementById('sidebarToggle').addEventListener('click', () => setSidebar(!sidebarOpen));

// Title typing
noteTitleInput.addEventListener('input', () => {
  scheduleAutoSave();
  updateWordCount();
});

noteTitleInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); editor.focus(); }
});

// Editor typing
editor.addEventListener('input', () => {
  scheduleAutoSave();
  updateWordCount();
});

editor.addEventListener('keyup', syncToolbar);
editor.addEventListener('mouseup', syncToolbar);

// Save shortcut
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    manualSave();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    createNote();
  }
});

// Search
searchInput.addEventListener('input', () => renderSidebar(searchInput.value));

// Save button
document.getElementById('saveBtn').addEventListener('click', manualSave);

// Delete button
document.getElementById('deleteBtn').addEventListener('click', confirmDelete);

// Modal
document.getElementById('modalCancel').addEventListener('click', () => {
  modalOverlay.classList.remove('show');
});
document.getElementById('modalConfirm').addEventListener('click', deleteCurrentNote);
modalOverlay.addEventListener('click', e => {
  if (e.target === modalOverlay) modalOverlay.classList.remove('show');
});

// Toolbar buttons
document.getElementById('boldBtn').addEventListener('click', () => { execCmd('bold'); syncToolbar(); });
document.getElementById('italicBtn').addEventListener('click', () => { execCmd('italic'); syncToolbar(); });
document.getElementById('underlineBtn').addEventListener('click', () => { execCmd('underline'); syncToolbar(); });
document.getElementById('listBtn').addEventListener('click', () => { execCmd('insertUnorderedList'); });

document.getElementById('fontSizeSelect').addEventListener('change', function() {
  // execCommand fontSize only supports 1-7, so we use inline style instead
  const size = this.value;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;
  const span = document.createElement('span');
  span.style.fontSize = size;
  try {
    range.surroundContents(span);
  } catch {
    // Ignore partial selection issues
  }
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
  try {
    range.surroundContents(span);
  } catch { }
  editor.focus();
});

// ── Init ───────────────────────────────
load();

if (notes.length === 0) {
  // Create a welcome note
  const welcome = {
    id: genId(),
    title: 'NoteFlow에 오신 걸 환영해요 👋',
    content: `<p>안녕하세요! <strong>NoteFlow</strong>는 당신의 아이디어를 자유롭게 기록하는 공간입니다.</p>
<br>
<p>✦ <strong>새 메모</strong> — 왼쪽 상단 <strong>+</strong> 버튼 또는 <strong>Ctrl+N</strong></p>
<p>✦ <strong>저장</strong> — <strong>저장</strong> 버튼 또는 <strong>Ctrl+S</strong> (입력 시 자동저장도 됩니다)</p>
<p>✦ <strong>서식</strong> — 텍스트를 드래그하고 툴바의 B / I / U 버튼을 눌러보세요</p>
<p>✦ <strong>검색</strong> — 왼쪽 검색창에 키워드를 입력하세요</p>
<br>
<p>지금 바로 여기에 타이핑해 보세요! 🚀</p>`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  notes.push(welcome);
  save();
}

renderSidebar();

// Auto-open first note
if (notes.length > 0) {
  selectNote(notes.sort((a,b) => b.updatedAt - a.updatedAt)[0].id);
}
