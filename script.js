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
    pendingScan: null,
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
