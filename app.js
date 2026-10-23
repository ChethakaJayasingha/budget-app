'use strict';

const STORE_KEY = 'budget.entries.v1';
const LONG_PRESS_MS = 600;

const $ = (selector) => document.querySelector(selector);
const wholeFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const centsFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const dayYearFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

// Each entry: { id, type: 'cr' | 'de', cents, purpose, date (ISO string) }, kept oldest first.
// Amounts are whole cents so balances never pick up floating-point drift.
let entries = load();
let openedFromHome = false;
let toastTimer;

/* ---------- Storage ---------- */

function isValidEntry(e) {
  return Boolean(e)
    && typeof e.id === 'string'
    && (e.type === 'cr' || e.type === 'de')
    && Number.isSafeInteger(e.cents) && e.cents > 0
    && typeof e.purpose === 'string'
    && !Number.isNaN(Date.parse(e.date));
}

function byDate(a, b) {
  return Date.parse(a.date) - Date.parse(b.date);
}

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY));
    return Array.isArray(data) ? data.filter(isValidEntry).sort(byDate) : [];
  } catch {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(entries));
  } catch {
    toast('Could not save. Storage is full or blocked.');
  }
}

/* ---------- Formatting ---------- */

// 5000000 -> "50,000", 125050 -> "1,250.50". Callers add the sign.
function digits(cents) {
  const abs = Math.abs(cents);
  return (abs % 100 === 0 ? wholeFmt : centsFmt).format(abs / 100);
}

function formatMoney(cents) {
  return (cents < 0 ? '−' : '') + digits(cents);
}

function rupees(cents) {
  return `${cents < 0 ? '−' : ''}Rs. ${digits(cents)}`;
}

function signedAmount(entry) {
  return (entry.type === 'cr' ? '+' : '−') + digits(entry.cents);
}

function formatDay(date) {
  return (date.getFullYear() === new Date().getFullYear() ? dayFmt : dayYearFmt).format(date);
}

// Accepts "1,250", "530", "12.5"; returns whole cents, or null if invalid.
function parseAmount(text) {
  const clean = text.replace(/[,\s]/g, '');
  if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(clean)) return null;
  const cents = Math.round(Number(clean) * 100);
  return cents > 0 && cents <= 1e13 ? cents : null;
}

/* ---------- Rendering ---------- */

function cell(className, text) {
  const td = document.createElement('td');
  td.className = className;
  td.textContent = text;
  return td;
}

function render() {
  let balance = 0;
  const rows = entries.map((entry) => {
    balance += entry.type === 'cr' ? entry.cents : -entry.cents;
    const date = new Date(entry.date);

    const when = cell('date', '');
    const day = document.createElement('span');
    const time = document.createElement('small');
    day.textContent = formatDay(date);
    time.textContent = timeFmt.format(date);
    when.append(day, time);

    const tr = document.createElement('tr');
    tr.className = entry.type;
    tr.dataset.id = entry.id;
    tr.append(
      when,
      cell('type', entry.type === 'cr' ? 'Cr +' : 'De −'),
      cell('num amt', signedAmount(entry)),
      cell('reason', entry.purpose || '—'),
      cell(balance < 0 ? 'num neg' : 'num', formatMoney(balance)),
    );
    return tr;
  });

  $('#rows').replaceChildren(...rows.reverse()); // newest first

  const total = $('#balance');
  total.textContent = rupees(balance);
  total.classList.toggle('negative', balance < 0);

  const empty = entries.length === 0;
  $('#table').hidden = empty;
  $('#empty').hidden = !empty;
  $('#hint').hidden = empty;
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- Screens ---------- */

function showScreen() {
  const onHistory = location.hash === '#history';
  if (!onHistory) openedFromHome = false;
  $('#home').hidden = onHistory;
  $('#history').hidden = !onHistory;
  window.scrollTo(0, 0);
}

$('#open-history').addEventListener('click', () => {
  openedFromHome = true;
  location.hash = 'history';
});

$('#back').addEventListener('click', () => {
  if (openedFromHome) {
    history.back();
  } else {
    history.replaceState(null, '', location.pathname + location.search);
    showScreen();
  }
});

/* ---------- Adding entries ---------- */

const form = $('#entry-form');

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const { type, amount, purpose } = form.elements;

  const cents = parseAmount(amount.value);
  if (cents === null) {
    $('#error').textContent = 'Enter an amount greater than 0 (up to 2 decimals).';
    amount.focus();
    return;
  }

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    type: type.value,
    cents,
    purpose: purpose.value.trim(),
    date: new Date().toISOString(),
  };
  entries.push(entry);
  save();
  render();

  amount.value = '';
  purpose.value = '';
  $('#error').textContent = '';
  document.activeElement?.blur(); // close the keyboard
  const sign = entry.type === 'cr' ? '+' : '−';
  toast(`Added ${sign}${rupees(cents)}${entry.purpose ? ` · ${entry.purpose}` : ''}`);
});

form.elements.amount.addEventListener('input', () => {
  $('#error').textContent = '';
});

/* ---------- Deleting (long-press a row) ---------- */

function confirmDelete(id) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  const summary = `${formatDay(new Date(entry.date))} · ${signedAmount(entry)} · ${entry.purpose || 'no purpose'}`;
  if (!confirm(`Delete this entry?\n\n${summary}`)) return;
  entries = entries.filter((e) => e.id !== id);
  save();
  render();
  toast('Entry deleted');
}

function setupLongPress(tbody) {
  let timer = null;
  let startX = 0;
  let startY = 0;

  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    tbody.querySelector('.pressing')?.classList.remove('pressing');
  };

  tbody.addEventListener('pointerdown', (event) => {
    const row = event.target.closest('tr[data-id]');
    if (!row) return;
    cancel();
    startX = event.clientX;
    startY = event.clientY;
    row.classList.add('pressing');
    timer = setTimeout(() => {
      cancel();
      confirmDelete(row.dataset.id);
    }, LONG_PRESS_MS);
  });

  // Moving the finger means the user is scrolling, not pressing.
  tbody.addEventListener('pointermove', (event) => {
    if (timer && Math.hypot(event.clientX - startX, event.clientY - startY) > 10) cancel();
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    tbody.addEventListener(type, cancel);
  }
  tbody.addEventListener('contextmenu', (event) => event.preventDefault());
}

/* ---------- Backup ---------- */

async function exportBackup() {
  const name = `budget-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const json = JSON.stringify({ app: 'budget', version: 1, entries }, null, 2);
  const file = new File([json], name, { type: 'application/json' });

  // On iPhone this opens the share sheet, where "Save to Files" keeps the backup.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
    } catch (err) {
      if (err.name !== 'AbortError') toast('Could not share the backup');
    }
    return;
  }

  const url = URL.createObjectURL(file);
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importBackup(file) {
  let list;
  try {
    const data = JSON.parse(await file.text());
    list = Array.isArray(data) ? data : data.entries;
    if (!Array.isArray(list) || !list.every(isValidEntry)) throw new Error('invalid');
  } catch {
    toast('That file is not a valid backup');
    return;
  }
  if (entries.length > 0
      && !confirm(`Replace your ${entries.length} current entries with the ${list.length} in this backup?`)) {
    return;
  }
  entries = list.sort(byDate);
  save();
  render();
  toast(`Restored ${list.length} entries`);
}

$('#export').addEventListener('click', exportBackup);
$('#import-button').addEventListener('click', () => $('#import').click());
$('#import').addEventListener('change', (event) => {
  const [file] = event.target.files;
  event.target.value = '';
  if (file) importBackup(file);
});

/* ---------- Start ---------- */

setupLongPress($('#rows'));
window.addEventListener('hashchange', showScreen);
render();
showScreen();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// Ask the browser not to clear our data when space runs low.
if (navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {});
}
