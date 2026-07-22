/**
 * ============================================================
 *  PRESENSI-BARCODE-V4 — script.js
 * ------------------------------------------------------------
 *  Berisi:
 *  - Konfigurasi & penyimpanan pengaturan (API URL, nama acara, device)
 *  - Helper pemanggilan API (apiGet / apiPost)
 *  - Navigasi antar halaman (Scanner / Dashboard / Riwayat / Admin)
 *  - Loader Dashboard (auto refresh)
 *  - Loader Riwayat
 *  - Aksi Admin: export Excel, export PDF, reset presensi, simpan setting
 * ============================================================
 */

// ------------------------------------------------------------
// STORAGE HELPERS (localStorage — aman karena ini website
// yang benar-benar di-hosting, bukan sandbox artifact)
// ------------------------------------------------------------
const STORAGE_KEYS = {
  API_URL: 'presensi_api_url',
  EVENT_NAME: 'presensi_event_name',
  DEVICE_NAME: 'presensi_device_name'
};

function getSetting(key, fallback) {
  return localStorage.getItem(key) || fallback;
}
function setSetting(key, value) {
  localStorage.setItem(key, value);
}

let API_URL = getSetting(STORAGE_KEYS.API_URL, '');
let EVENT_NAME = getSetting(STORAGE_KEYS.EVENT_NAME, 'Nama Acara Anda');
let DEVICE_NAME = getSetting(STORAGE_KEYS.DEVICE_NAME, '');

// ------------------------------------------------------------
// API HELPERS
// ------------------------------------------------------------
async function apiGet(action) {
  if (!API_URL) throw new Error('API URL belum diatur. Buka menu Admin untuk mengatur.');
  const res = await fetch(`${API_URL}?action=${encodeURIComponent(action)}`);
  return res.json();
}

async function apiPost(payload) {
  if (!API_URL) throw new Error('API URL belum diatur. Buka menu Admin untuk mengatur.');
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // hindari CORS preflight ke Apps Script
    body: JSON.stringify(payload)
  });
  return res.json();
}

// ------------------------------------------------------------
// TOAST
// ------------------------------------------------------------
function showToast(message, duration = 2500) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), duration);
}

// ------------------------------------------------------------
// NAVIGASI HALAMAN
// ------------------------------------------------------------
const pages = ['scanner', 'dashboard', 'riwayat', 'admin'];

function goToPage(name) {
  pages.forEach(p => {
    document.getElementById(`page-${p}`).classList.toggle('active', p === name);
  });
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === name);
  });

  if (name === 'dashboard') loadDashboard();
  if (name === 'riwayat') loadRiwayat();
  if (name === 'admin') loadAdminSettingsIntoForm();
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => goToPage(btn.dataset.page));
});

// ------------------------------------------------------------
// DASHBOARD
// ------------------------------------------------------------
let dashboardInterval = null;

async function loadDashboard() {
  try {
    const res = await apiGet('getdashboard');
    if (res.status !== 'ok') { showToast(res.message || 'Gagal memuat dashboard'); return; }

    const { total, hadir, belum, persen } = res.data;
    document.getElementById('dashTotal').textContent = total;
    document.getElementById('dashHadir').textContent = hadir;
    document.getElementById('dashBelum').textContent = belum;
    document.getElementById('dashPersen').textContent = persen + '%';

    const circumference = 440;
    const offset = circumference - (circumference * Math.min(persen, 100) / 100);
    document.getElementById('ringFg').style.strokeDashoffset = offset;

    document.getElementById('lastUpdate').textContent =
      new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (err) {
    showToast(err.message);
  }
}

function startDashboardAutoRefresh() {
  clearInterval(dashboardInterval);
  dashboardInterval = setInterval(() => {
    if (document.getElementById('page-dashboard').classList.contains('active')) {
      loadDashboard();
    }
  }, 10000);
}

// ------------------------------------------------------------
// RIWAYAT
// ------------------------------------------------------------
async function loadRiwayat() {
  const tbody = document.getElementById('logTableBody');
  tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Memuat data...</td></tr>`;
  try {
    const res = await apiGet('getlog');
    if (res.status !== 'ok') { showToast(res.message || 'Gagal memuat riwayat'); return; }

    if (!res.data.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Belum ada riwayat scan.</td></tr>`;
      return;
    }

    tbody.innerHTML = res.data.map(row => `
      <tr>
        <td class="mono">${row.Waktu}</td>
        <td class="mono">${row.Barcode}</td>
        <td>${row.Device}</td>
        <td>${row.Hasil}</td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-danger">${err.message}</td></tr>`;
  }
}
document.getElementById('btnRefreshLog').addEventListener('click', loadRiwayat);

// ------------------------------------------------------------
// ADMIN: EXPORT EXCEL
// ------------------------------------------------------------
document.getElementById('btnExportExcel').addEventListener('click', async () => {
  try {
    showToast('Menyiapkan file Excel...');
    const res = await apiGet('getpresensi');
    if (res.status !== 'ok') { showToast(res.message); return; }

    const ws = XLSX.utils.json_to_sheet(res.data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Presensi');
    XLSX.writeFile(wb, `Presensi_${todayStamp()}.xlsx`);
  } catch (err) {
    showToast(err.message);
  }
});

// ------------------------------------------------------------
// ADMIN: EXPORT PDF
// ------------------------------------------------------------
document.getElementById('btnExportPdf').addEventListener('click', async () => {
  try {
    showToast('Menyiapkan file PDF...');
    const res = await apiGet('getpresensi');
    if (res.status !== 'ok') { showToast(res.message); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text(EVENT_NAME + ' — Daftar Presensi', 14, 16);

    const rows = res.data.map(r => [r.Barcode, r.Nama, r.Rumah, r.Tanggal, r.Jam, r.Status, r.Device]);
    doc.autoTable({
      head: [['Barcode', 'Nama', 'Rumah', 'Tanggal', 'Jam', 'Status', 'Device']],
      body: rows,
      startY: 22,
      styles: { fontSize: 8 }
    });

    doc.save(`Presensi_${todayStamp()}.pdf`);
  } catch (err) {
    showToast(err.message);
  }
});

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
}

// ------------------------------------------------------------
// ADMIN: RESET PRESENSI
// ------------------------------------------------------------
const resetModal = document.getElementById('resetModal');
document.getElementById('btnResetPresensi').addEventListener('click', () => {
  document.getElementById('resetPasswordInput').value = '';
  document.getElementById('resetStatus').textContent = '';
  resetModal.classList.add('show');
});
document.getElementById('btnCancelReset').addEventListener('click', () => {
  resetModal.classList.remove('show');
});
document.getElementById('btnConfirmReset').addEventListener('click', async () => {
  const password = document.getElementById('resetPasswordInput').value.trim();
  const statusEl = document.getElementById('resetStatus');
  if (!password) { statusEl.textContent = 'Masukkan password admin.'; statusEl.style.color = 'var(--color-danger)'; return; }

  statusEl.textContent = 'Memproses...';
  statusEl.style.color = 'var(--color-muted)';
  try {
    const res = await apiPost({ action: 'reset', password });
    if (res.status === 'ok') {
      statusEl.textContent = res.message;
      statusEl.style.color = 'var(--color-success)';
      setTimeout(() => resetModal.classList.remove('show'), 1200);
      showToast('Data presensi berhasil direset.');
    } else {
      statusEl.textContent = res.message;
      statusEl.style.color = 'var(--color-danger)';
    }
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.style.color = 'var(--color-danger)';
  }
});

// ------------------------------------------------------------
// ADMIN: SIMPAN PENGATURAN (API URL & Nama Acara)
// ------------------------------------------------------------
function loadAdminSettingsIntoForm() {
  document.getElementById('apiUrlInput').value = API_URL;
  document.getElementById('eventNameInput').value = EVENT_NAME;
}

document.getElementById('btnSaveSettings').addEventListener('click', () => {
  const newApiUrl = document.getElementById('apiUrlInput').value.trim();
  const newEventName = document.getElementById('eventNameInput').value.trim();

  API_URL = newApiUrl;
  EVENT_NAME = newEventName || 'Nama Acara Anda';

  setSetting(STORAGE_KEYS.API_URL, API_URL);
  setSetting(STORAGE_KEYS.EVENT_NAME, EVENT_NAME);

  document.getElementById('eventNameLabel').textContent = EVENT_NAME;

  const statusEl = document.getElementById('settingStatus');
  statusEl.textContent = 'Pengaturan tersimpan.';
  statusEl.style.color = 'var(--color-success)';
  setTimeout(() => statusEl.textContent = '', 2000);
});

// ------------------------------------------------------------
// DEVICE NAME (modal pertama kali dibuka)
// ------------------------------------------------------------
const deviceModal = document.getElementById('deviceModal');

function ensureDeviceName() {
  if (!DEVICE_NAME) {
    deviceModal.classList.add('show');
  } else {
    document.getElementById('deviceNameLabel').textContent = DEVICE_NAME;
  }
}

document.getElementById('btnSaveDevice').addEventListener('click', () => {
  const val = document.getElementById('deviceNameInput').value.trim();
  if (!val) return;
  DEVICE_NAME = val;
  setSetting(STORAGE_KEYS.DEVICE_NAME, DEVICE_NAME);
  document.getElementById('deviceNameLabel').textContent = DEVICE_NAME;
  deviceModal.classList.remove('show');
});

document.getElementById('deviceChip').addEventListener('click', () => {
  document.getElementById('deviceNameInput').value = DEVICE_NAME;
  deviceModal.classList.add('show');
});

// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------
document.getElementById('eventNameLabel').textContent = EVENT_NAME;
ensureDeviceName();
startDashboardAutoRefresh();

if (!API_URL) {
  showToast('Atur URL API di menu Admin sebelum mulai scan.', 4000);
}
