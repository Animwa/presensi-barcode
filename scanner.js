(() => {
  let html5QrCode = null;
  let scannerRunning = false;
  let scannerPausedForPending = false;
  let lastDecodedText = "";
  let lastScanTimestamp = 0;
  let audioContext = null;
  let audioUnlocked = false;

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

  function ensureAudioReady() {
    try {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return false;
      if (!audioContext) {
        audioContext = new AudioCtor();
