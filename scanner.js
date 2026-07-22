/**
 * ============================================================
 *  PRESENSI-BARCODE-V4 — scanner.js
 * ------------------------------------------------------------
 *  - Kamera belakang otomatis + autofocus (bawaan html5-qrcode)
 *  - Mendukung Barcode & QR Code sekaligus
 *  - Auto scan & lanjut ke scan berikutnya otomatis
 *  - Anti "scan ganda tak sengaja" di sisi klien (debounce),
 *    anti double-scan SEBENARNYA tetap divalidasi di server.
 *  - Beep disintesis langsung via Web Audio API
 *    (tidak butuh file mp3 eksternal — lebih ringan & pasti jalan).
 * ============================================================
 */

let html5QrcodeScanner = null;
let isProcessing = false;
let lastCode = null;
let lastCodeTime = 0;
const DEBOUNCE_MS = 3000; // jeda sebelum barcode yg sama boleh discan lagi di HP ini

// ------------------------------------------------------------
// BEEP — disintesis, bukan file audio
// ------------------------------------------------------------
function playBeep(type = 'ok') {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const freq = type === 'ok' ? 880 : type === 'dup' ? 600 : 300;
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);

    osc.start();
    osc.stop(ctx.currentTime + 0.2);

    if (type === 'err') {
      setTimeout(() => {
        const ctx2 = new (window.AudioContext || window.webkitAudioContext)();
        const o2 = ctx2.createOscillator();
        const g2 = ctx2.createGain();
        o2.connect(g2); g2.connect(ctx2.destination);
        o2.frequency.value = 260;
        g2.gain.setValueAtTime(0.15, ctx2.currentTime);
        g2.gain.exponentialRampToValueAtTime(0.001, ctx2.currentTime + 0.2);
        o2.start(); o2.stop(ctx2.currentTime + 0.2);
      }, 180);
    }
  } catch (e) {
    // Web Audio tidak didukung / diblokir — abaikan, tidak fatal
  }
}

// ------------------------------------------------------------
// UI: update kartu status scan
// ------------------------------------------------------------
function setScanStatus(mode, title, sub) {
  const el = document.getElementById('scanStatus');
  el.className = 'scan-status scan-status-' + mode;
  el.querySelector('.scan-status-title').textContent = title;
  el.querySelector('.scan-status-sub').textContent = sub;

  const icon = el.querySelector('i');
  icon.className = mode === 'ok' ? 'bi bi-check-circle-fill'
                  : mode === 'dup' ? 'bi bi-exclamation-triangle-fill'
                  : mode === 'err' ? 'bi bi-x-circle-fill'
                  : 'bi bi-camera2';
}

function showResultCard(nama, rumah, jam) {
  const card = document.getElementById('resultCard');
  card.style.display = 'block';
  document.getElementById('resNama').textContent = nama || '-';
  document.getElementById('resRumah').textContent = rumah || '-';
  document.getElementById('resJam').textContent = jam || '-';
}

// ------------------------------------------------------------
// HANDLER: saat kode berhasil terbaca kamera
// ------------------------------------------------------------
async function onScanSuccess(decodedText) {
  const now = Date.now();

  if (decodedText === lastCode && (now - lastCodeTime) < DEBOUNCE_MS) {
    return;
  }
  if (isProcessing) return;

  lastCode = decodedText;
  lastCodeTime = now;
  isProcessing = true;

  setScanStatus('idle', 'Memproses...', decodedText);

  try {
    const res = await apiPost({
      action: 'presensi',
      barcode: decodedText,
      device: DEVICE_NAME || 'Tidak diketahui'
    });

    if (res.status === 'ok') {
      playBeep('ok');
      setScanStatus('ok', res.data.nama + ' — Presensi berhasil', 'Rumah ' + res.data.rumah);
      showResultCard(res.data.nama, res.data.rumah, res.data.jam);
    } else if (res.status === 'duplikat') {
      playBeep('dup');
      setScanStatus('dup', res.data.nama + ' — Sudah presensi', 'Tercatat jam ' + res.data.jam + ' oleh ' + res.data.device);
      showResultCard(res.data.nama, res.data.rumah, res.data.jam);
    } else if (res.status === 'notfound') {
      playBeep('err');
      setScanStatus('err', 'Barcode tidak terdaftar', decodedText);
      document.getElementById('resultCard').style.display = 'none';
    } else {
      playBeep('err');
      setScanStatus('err', 'Gagal memproses', res.message || 'Terjadi kesalahan');
    }
  } catch (err) {
    playBeep('err');
    setScanStatus('err', 'Gagal terhubung ke server', err.message);
  } finally {
    isProcessing = false;
    setTimeout(() => {
      if (!isProcessing) setScanStatus('idle', 'Menunggu scan...', 'Kamera belakang aktif otomatis');
    }, 2500);
  }
}

function onScanFailure() {
  // Dipanggil terus-menerus saat tidak ada kode terbaca — sengaja dibiarkan
  // kosong supaya tidak membanjiri console/log.
}

// ------------------------------------------------------------
// INISIALISASI KAMERA
// ------------------------------------------------------------
function initScanner() {
  html5QrcodeScanner = new Html5Qrcode('reader');

  const config = {
    fps: 10,
    qrbox: { width: 250, height: 250 },
    aspectRatio: 1.0
  };

  Html5Qrcode.getCameras().then(devices => {
    if (!devices || !devices.length) {
      setScanStatus('err', 'Kamera tidak ditemukan', 'Pastikan browser diberi izin akses kamera');
      return;
    }

    const backCamera = devices.find(d => /back|belakang|environment/i.test(d.label)) || devices[devices.length - 1];

    html5QrcodeScanner.start(
      backCamera.id,
      config,
      onScanSuccess,
      onScanFailure
    ).catch(err => {
      html5QrcodeScanner.start(
        { facingMode: 'environment' },
        config,
        onScanSuccess,
        onScanFailure
      ).catch(err2 => {
        setScanStatus('err', 'Gagal membuka kamera', err2.message || String(err2));
      });
    });
  }).catch(err => {
    setScanStatus('err', 'Izin kamera ditolak', 'Aktifkan izin kamera di pengaturan browser');
  });
}

document.getElementById('btnSaveDevice').addEventListener('click', () => {
  if (!html5QrcodeScanner) initScanner();
});

window.addEventListener('load', () => {
  if (DEVICE_NAME) initScanner();
});
