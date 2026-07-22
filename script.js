(() => {
  const STORAGE_KEY = "presensi-barcode-v4-config";
  const state = {
    config: {
      apiUrl: "",
      apiKey: "",
      deviceName: ""
    },
    stats: null,
    history: [],
    attendance: [],
    scanBusy: false,
    refreshTimer: null
  };

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function initElements() {
    [
      "alertBox",
      "apiStatusBadge",
      "scannerStatusBadge",
      "deviceNameText",
      "browserInfoText",
      "apiUrlPreview",
      "apiKeyPreview",
      "adminDeviceNameText",
      "apiKeyPreview",
      "manualBarcodeInput",
      "manualSubmitBtn",
      "refreshHistoryBtn",
      "refreshDashboardBtn",
      "exportExcelBtn",
      "exportPdfBtn",
      "resetPresensiBtn",
      "saveSettingsBtn",
      "apiUrlInput",
      "apiKeyInput",
      "deviceNameInput",
      "historyTableBody",
      "lastScanCard",
      "lastDashboardUpdate",
      "totalPesertaText",
      "hadirText",
      "belumHadirText",
      "persentaseText",
      "dashboardDateText",
      "dashboardTotalScanText",
      "attendanceProgressBar"
    ].forEach((id) => {
      els[id] = $(id);
    });
  }

  function loadConfig() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      state.config = {
        apiUrl: parsed.apiUrl || "",
        apiKey: parsed.apiKey || "",
        deviceName: parsed.deviceName || ""
      };
    } catch (error) {
      console.error("Gagal membaca konfigurasi:", error);
    }
  }

  function saveConfig() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
  }

  function maskApiKey(value) {
    if (!value) return "Belum diatur";
    if (value.length <= 4) return "****";
    return `${value.slice(0, 2)}••••${value.slice(-2)}`;
  }

  function getBrowserInfo() {
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) return "Android Browser";
    if (/iPhone|iPad|iPod/i.test(ua)) return "iPhone / iPad";
    if (/Edg/i.test(ua)) return "Microsoft Edge";
    if (/Chrome/i.test(ua)) return "Google Chrome";
    if (/Safari/i.test(ua)) return "Safari";
    if (/Firefox/i.test(ua)) return "Mozilla Firefox";
    return "Browser tidak dikenal";
  }

  function buildDefaultDeviceName() {
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) return "Panitia - Android";
    if (/iPhone|iPad|iPod/i.test(ua)) return "Panitia - iPhone";
    return "Panitia - Laptop";
  }

  function showAlert(message, type = "info", timeout = 4500) {
    if (!els.alertBox) return;
    const typeClass = {
      success: "alert-success",
      warning: "alert-warning",
      danger: "alert-danger",
      info: "alert-primary"
    }[type] || "alert-primary";

    els.alertBox.innerHTML = `
      <div class="alert ${typeClass} alert-dismissible fade show shadow-sm border-0" role="alert">
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Tutup"></button>
      </div>
    `;

    if (timeout > 0) {
      setTimeout(() => {
        els.alertBox.innerHTML = "";
      }, timeout);
    }
  }

  function updateConnectionUI() {
    const hasApi = Boolean(state.config.apiUrl);
    els.apiStatusBadge.textContent = hasApi ? "API siap" : "API belum dikonfigurasi";
    els.apiStatusBadge.className = `badge ${hasApi ? "text-bg-success" : "text-bg-secondary"}`;
    els.deviceNameText.textContent = state.config.deviceName || "Belum diatur";
    els.adminDeviceNameText.textContent = state.config.deviceName || "Belum diatur";
    els.browserInfoText.textContent = getBrowserInfo();
    els.apiUrlPreview.textContent = state.config.apiUrl || "Belum diatur";
    els.apiKeyPreview.textContent = maskApiKey(state.config.apiKey);
    els.apiKeyPreview.title = state.config.apiKey ? "API key tersimpan di browser perangkat ini" : "";
    $("apiKeyPreview").textContent = maskApiKey(state.config.apiKey);
  }

  function fillSettingsForm() {
    els.apiUrlInput.value = state.config.apiUrl;
    els.apiKeyInput.value = state.config.apiKey;
    els.deviceNameInput.value = state.config.deviceName || buildDefaultDeviceName();
  }

  function sanitizeBarcode(value) {
    return String(value || "").trim();
  }

  function buildUrl(action, extraParams = {}) {
    if (!state.config.apiUrl) {
      throw new Error("URL API belum diatur.");
    }

    const url = new URL(state.config.apiUrl);
    const callbackName = `jsonpCallback_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const params = {
      action,
      apiKey: state.config.apiKey || "",
      device: state.config.deviceName || buildDefaultDeviceName(),
      ...extraParams,
      callback: callbackName
    };
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    });
    return { url: url.toString(), callbackName };
  }

  function jsonpRequest(action, extraParams = {}) {
    return new Promise((resolve, reject) => {
      let timeoutId;
      let script;
      const { url, callbackName } = buildUrl(action, extraParams);

      window[callbackName] = (payload) => {
        cleanup();
        resolve(payload);
      };

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        if (script && script.parentNode) script.parentNode.removeChild(script);
        delete window[callbackName];
      };

      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Permintaan ke API timeout. Periksa deploy Apps Script."));
      }, 15000);

      script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.onerror = () => {
        cleanup();
        reject(new Error("Gagal memuat API. Periksa URL Web App dan izin deploy."));
      };
      document.body.appendChild(script);
    });
  }

  function getResultVariant(status) {
    const normalized = String(status || "").toUpperCase();
    if (normalized === "HADIR") return "success";
    if (normalized === "SUDAH_HADIR") return "warning";
    return "error";
  }

  function getStatusBadge(status) {
    const normalized = String(status || "").toUpperCase();
    const map = {
      HADIR: ["Hadir", "badge-soft-success"],
      SUDAH_HADIR: ["Sudah hadir", "badge-soft-warning"],
      TIDAK_DITEMUKAN: ["Tidak ditemukan", "badge-soft-danger"],
      NONAKTIF: ["Nonaktif", "badge-soft-secondary"],
      ERROR: ["Error", "badge-soft-danger"]
    };
    const [label, cls] = map[normalized] || [normalized || "-", "badge-soft-secondary"];
    return `<span class="badge ${cls}">${label}</span>`;
  }

  function renderLastScan(result) {
    if (!result) {
      els.lastScanCard.className = "result-card empty-state";
      els.lastScanCard.textContent = "Belum ada scan.";
      return;
    }

    const variant = getResultVariant(result.status);
    const personName = result.nama || "-";
    const rumah = result.rumah || "-";
    const barcode = result.barcode || "-";
    const message = result.message || "";
    const jam = result.jam || "-";

    els.lastScanCard.className = `result-card ${variant}`;
    els.lastScanCard.innerHTML = `
      <div class="d-flex justify-content-between align-items-start gap-3 mb-3">
        <div>
          <h3 class="h5 mb-1">${personName}</h3>
          <div class="text-secondary small">Barcode: ${barcode}</div>
        </div>
        ${getStatusBadge(result.status)}
      </div>
      <div class="info-panel">
        <div><span class="label">Rumah</span><span>${rumah}</span></div>
        <div><span class="label">Jam</span><span>${jam}</span></div>
        <div><span class="label">Pesan</span><span>${message}</span></div>
      </div>
    `;
  }

  function renderHistory(rows) {
    state.history = Array.isArray(rows) ? rows : [];
    if (!state.history.length) {
      els.historyTableBody.innerHTML = `<tr><td colspan="4" class="text-center text-secondary py-4">Belum ada data.</td></tr>`;
      return;
    }

    els.historyTableBody.innerHTML = state.history.map((item) => `
      <tr>
        <td>${item.jam || "-"}</td>
        <td>${item.barcode || "-"}</td>
        <td>${item.nama || "-"}</td>
        <td>${getStatusBadge(item.status)}</td>
      </tr>
    `).join("");
  }

  function renderStats(stats) {
    state.stats = stats || null;
    if (!state.stats) return;

    const total = Number(state.stats.totalPeserta || 0);
    const hadir = Number(state.stats.hadir || 0);
    const belum = Number(state.stats.belumHadir || Math.max(total - hadir, 0));
    const persentase = Number(state.stats.persentase || 0);

    els.totalPesertaText.textContent = total;
    els.hadirText.textContent = hadir;
    els.belumHadirText.textContent = belum;
    els.persentaseText.textContent = `${persentase.toFixed(1)}%`;
    els.dashboardDateText.textContent = state.stats.tanggal || "-";
    els.dashboardTotalScanText.textContent = state.stats.totalScan || 0;
    els.attendanceProgressBar.style.width = `${Math.min(persentase, 100)}%`;
    els.attendanceProgressBar.textContent = `${persentase.toFixed(1)}%`;
    els.lastDashboardUpdate.textContent = `Update ${new Date().toLocaleTimeString("id-ID")}`;
  }

  function parseApiResponse(payload) {
    if (typeof payload === "string") {
      try {
        return JSON.parse(payload);
      } catch (error) {
        throw new Error("Respons API tidak valid.");
      }
    }
    return payload;
  }

  async function healthCheck(showSuccess = false) {
    if (!state.config.apiUrl) return;
    try {
      const response = parseApiResponse(await jsonpRequest("health"));
      if (!response.success) throw new Error(response.message || "Health check gagal.");
      if (showSuccess) {
        showAlert("Koneksi API berhasil.", "success");
      }
    } catch (error) {
      showAlert(error.message, "warning", 6500);
    }
  }

  async function fetchStats() {
    const response = parseApiResponse(await jsonpRequest("stats"));
    if (!response.success) throw new Error(response.message || "Gagal memuat statistik.");
    renderStats(response.data);
  }

  async function fetchHistory() {
    const response = parseApiResponse(await jsonpRequest("history", { limit: 20 }));
    if (!response.success) throw new Error(response.message || "Gagal memuat riwayat.");
    renderHistory(response.data);
  }

  async function fetchAttendance() {
    const response = parseApiResponse(await jsonpRequest("attendance", { limit: 5000 }));
    if (!response.success) throw new Error(response.message || "Gagal memuat data presensi.");
    state.attendance = response.data || [];
  }

  async function refreshAllData(options = {}) {
    if (!state.config.apiUrl) return;
    try {
      await Promise.all([fetchStats(), fetchHistory(), fetchAttendance()]);
      if (options.showSuccess) {
        showAlert("Data berhasil diperbarui.", "success");
      }
    } catch (error) {
      showAlert(error.message, "warning", 6000);
    }
  }

  async function submitScan(barcode, source = "scanner") {
    const cleanBarcode = sanitizeBarcode(barcode);
    if (!cleanBarcode) {
      showAlert("Barcode tidak boleh kosong.", "warning");
      return;
    }
    if (!state.config.apiUrl) {
      showAlert("Silakan isi pengaturan API terlebih dulu.", "warning");
      return;
    }
    if (state.scanBusy) return;

    state.scanBusy = true;
    try {
      const response = parseApiResponse(await jsonpRequest("scan", {
        barcode: cleanBarcode,
        source
      }));

      if (!response.success) {
        throw new Error(response.message || "Scan gagal diproses.");
      }

      renderLastScan(response.data.scan);
      if (response.data.stats) renderStats(response.data.stats);
      if (response.data.history) renderHistory(response.data.history);
      await fetchAttendance();

      const resultStatus = response.data.scan?.status;
      if (window.AppScanner?.playBeep && resultStatus === "HADIR") {
        window.AppScanner.playBeep();
      }
      showAlert(response.data.scan?.message || "Scan berhasil diproses.", resultStatus === "HADIR" ? "success" : "warning");
    } catch (error) {
      renderLastScan({
        status: "ERROR",
        message: error.message,
        barcode: cleanBarcode,
        nama: "Gagal diproses",
        rumah: "-"
      });
      showAlert(error.message, "danger", 7000);
    } finally {
      setTimeout(() => {
        state.scanBusy = false;
      }, 900);
    }
  }

  function downloadCsv(filename, rows) {
    const csv = [
      ["Barcode", "Nama", "Rumah", "Tanggal", "Jam", "Status", "Device"],
      ...rows.map((item) => [
        item.barcode || "",
        item.nama || "",
        item.rumah || "",
        item.tanggal || "",
        item.jam || "",
        item.status || "",
        item.device || ""
      ])
    ].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function buildPrintHtml() {
    const stats = state.stats || {};
    const rowsHtml = (state.attendance || []).map((item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${item.barcode || "-"}</td>
        <td>${item.nama || "-"}</td>
        <td>${item.rumah || "-"}</td>
        <td>${item.tanggal || "-"}</td>
        <td>${item.jam || "-"}</td>
        <td>${item.device || "-"}</td>
      </tr>
    `).join("");

    return `
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <title>Laporan Presensi</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #111827; }
          h1 { margin-bottom: 8px; }
          .meta { margin-bottom: 20px; color: #4b5563; }
          .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
          .stats div { border: 1px solid #d1d5db; border-radius: 10px; padding: 12px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #d1d5db; padding: 8px; font-size: 12px; text-align: left; }
          th { background: #f3f4f6; }
        </style>
      </head>
      <body>
        <h1>Laporan Presensi</h1>
        <div class="meta">Tanggal laporan: ${stats.tanggal || "-"} | Dicetak: ${new Date().toLocaleString("id-ID")}</div>
        <div class="stats">
          <div><strong>Total Peserta</strong><br>${stats.totalPeserta || 0}</div>
          <div><strong>Hadir</strong><br>${stats.hadir || 0}</div>
          <div><strong>Belum Hadir</strong><br>${stats.belumHadir || 0}</div>
          <div><strong>Persentase</strong><br>${Number(stats.persentase || 0).toFixed(1)}%</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>No</th>
              <th>Barcode</th>
              <th>Nama</th>
              <th>Rumah</th>
              <th>Tanggal</th>
              <th>Jam</th>
              <th>Device</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || `<tr><td colspan="7">Belum ada data.</td></tr>`}
          </tbody>
        </table>
      </body>
      </html>
    `;
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    state.refreshTimer = window.setInterval(() => {
      if (!state.config.apiUrl) return;
      const dashboardVisible = $("dashboard-panel").classList.contains("show");
      const scannerVisible = $("scanner-panel").classList.contains("show");
      if (dashboardVisible || scannerVisible) {
        refreshAllData();
      }
    }, 15000);
  }

  function stopAutoRefresh() {
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
  }

  function bindEvents() {
    els.saveSettingsBtn.addEventListener("click", async () => {
      state.config.apiUrl = els.apiUrlInput.value.trim();
      state.config.apiKey = els.apiKeyInput.value.trim();
      state.config.deviceName = els.deviceNameInput.value.trim() || buildDefaultDeviceName();
      saveConfig();
      updateConnectionUI();
      await healthCheck(true);
      await refreshAllData();
    });

    els.manualSubmitBtn.addEventListener("click", () => {
      submitScan(els.manualBarcodeInput.value, "manual");
      els.manualBarcodeInput.value = "";
      els.manualBarcodeInput.focus();
    });

    els.manualBarcodeInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        els.manualSubmitBtn.click();
      }
    });

    els.refreshHistoryBtn.addEventListener("click", () => refreshAllData({ showSuccess: true }));
    els.refreshDashboardBtn.addEventListener("click", () => refreshAllData({ showSuccess: true }));

    els.exportExcelBtn.addEventListener("click", async () => {
      try {
        await fetchAttendance();
        const date = (state.stats?.tanggal || new Date().toISOString().slice(0, 10)).replace(/[^0-9-]/g, "");
        downloadCsv(`presensi-${date}.csv`, state.attendance);
      } catch (error) {
        showAlert(error.message, "danger");
      }
    });

    els.exportPdfBtn.addEventListener("click", async () => {
      try {
        await Promise.all([fetchStats(), fetchAttendance()]);
        const printWindow = window.open("", "_blank", "width=1080,height=760");
        if (!printWindow) {
          throw new Error("Popup diblokir browser. Izinkan popup untuk export PDF.");
        }
        printWindow.document.write(buildPrintHtml());
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => printWindow.print(), 500);
      } catch (error) {
        showAlert(error.message, "danger");
      }
    });

    els.resetPresensiBtn.addEventListener("click", async () => {
      const confirmed = window.confirm("Yakin ingin menghapus presensi hari ini? Data log tidak akan dihapus.");
      if (!confirmed) return;

      try {
        const response = parseApiResponse(await jsonpRequest("reset_today"));
        if (!response.success) throw new Error(response.message || "Reset gagal.");
        showAlert(response.message || "Presensi hari ini berhasil direset.", "success", 6500);
        renderLastScan(null);
        await refreshAllData();
      } catch (error) {
        showAlert(error.message, "danger", 7000);
      }
    });

    document.querySelectorAll('[data-bs-toggle="tab"]').forEach((button) => {
      button.addEventListener("shown.bs.tab", () => {
        refreshAllData();
      });
    });
  }

  function setScannerStatus(text, variant = "dark") {
    els.scannerStatusBadge.textContent = text;
    els.scannerStatusBadge.className = `badge text-bg-${variant}`;
  }

  async function init() {
    initElements();
    loadConfig();
    if (!state.config.deviceName) {
      state.config.deviceName = buildDefaultDeviceName();
      saveConfig();
    }
    fillSettingsForm();
    updateConnectionUI();
    bindEvents();
    startAutoRefresh();

    if (state.config.apiUrl) {
      await healthCheck();
      await refreshAllData();
    } else {
      showAlert("Isi URL Web App dan nama perangkat pada menu Pengaturan sebelum mulai scan.", "info", 7000);
    }
  }

  window.App = {
    getConfig: () => ({ ...state.config }),
    submitScan,
    showAlert,
    setScannerStatus,
    isScanBusy: () => state.scanBusy
  };

  window.addEventListener("DOMContentLoaded", init);
})();
