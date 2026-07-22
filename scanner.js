(() => {
  let html5QrCode = null;
  let scannerRunning = false;
  let lastDecodedText = "";
  let lastScanTimestamp = 0;

  const SCAN_COOLDOWN_MS = 1800;

  function getStartButton() {
    return document.getElementById("startScannerBtn");
  }

  function getStopButton() {
    return document.getElementById("stopScannerBtn");
  }

  function getReaderElementId() {
    return "reader";
  }

  function setButtonsState(isRunning) {
    const startBtn = getStartButton();
    const stopBtn = getStopButton();
    if (startBtn) startBtn.disabled = isRunning;
    if (stopBtn) stopBtn.disabled = !isRunning;
  }

function playBeep() {

    const audio = document.getElementById("beepSound");

    if (!audio) return;

    audio.pause();
    audio.currentTime = 0;

    audio.play().catch(err=>{
        console.log(err);
    });

}

  async function pickBackCamera() {
    const devices = await Html5Qrcode.getCameras();
    if (!devices?.length) {
      throw new Error("Kamera tidak ditemukan di perangkat ini.");
    }

    const preferred = devices.find((device) => /back|rear|environment|belakang/i.test(device.label));
    return preferred?.id || devices[0].id;
  }

  async function startScanner() {
    const config = window.App?.getConfig?.();
    if (!config?.apiUrl) {
      window.App?.showAlert?.("Isi URL API terlebih dulu pada menu Pengaturan.", "warning");
      return;
    }

    if (scannerRunning) return;

    try {
      window.App?.setScannerStatus?.("Memulai kamera...", "warning");
      html5QrCode = new Html5Qrcode(getReaderElementId());

      const cameraId = await pickBackCamera();
      await html5QrCode.start(
        cameraId,
        {
          fps: 10,
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            const edge = Math.min(viewfinderWidth, viewfinderHeight) * 0.72;
            return {
              width: Math.max(180, Math.floor(edge)),
              height: Math.max(180, Math.floor(edge))
            };
          },
          aspectRatio: 1.333334,
          rememberLastUsedCamera: true
        },
        onScanSuccess,
        () => {}
      );

      scannerRunning = true;
      setButtonsState(true);
      window.App?.setScannerStatus?.("Scanner aktif", "success");
      window.App?.showAlert?.("Scanner aktif. Arahkan kamera ke barcode atau QR Code.", "success");
    } catch (error) {
      console.error(error);
      scannerRunning = false;
      setButtonsState(false);
      window.App?.setScannerStatus?.("Scanner gagal", "danger");
      window.App?.showAlert?.(`Scanner gagal dimulai: ${error.message}`, "danger", 7000);
      if (html5QrCode) {
        try {
          await html5QrCode.stop();
        } catch (_) {
        }
        html5QrCode = null;
      }
    }
  }

  async function stopScanner() {
    if (!html5QrCode || !scannerRunning) {
      setButtonsState(false);
      window.App?.setScannerStatus?.("Scanner berhenti", "dark");
      return;
    }

    try {
      await html5QrCode.stop();
      await html5QrCode.clear();
    } catch (error) {
      console.warn("Gagal menghentikan scanner:", error);
    } finally {
      html5QrCode = null;
      scannerRunning = false;
      setButtonsState(false);
      window.App?.setScannerStatus?.("Scanner berhenti", "dark");
    }
  }

  async function onScanSuccess(decodedText) {
    const barcode = String(decodedText || "").trim();
    if (!barcode) return;

    const now = Date.now();
    const duplicateLocalScan = barcode === lastDecodedText && now - lastScanTimestamp < SCAN_COOLDOWN_MS;
    if (duplicateLocalScan || window.App?.isScanBusy?.()) {
      return;
    }

    lastDecodedText = barcode;
    lastScanTimestamp = now;

    await window.App?.submitScan?.(barcode, "kamera");
  }

  function bindScannerEvents() {
    getStartButton()?.addEventListener("click", startScanner);
    getStopButton()?.addEventListener("click", stopScanner);
  }

  window.AppScanner = {
    startScanner,
    stopScanner,
    playBeep
  };

  window.addEventListener("DOMContentLoaded", bindScannerEvents);
})();
