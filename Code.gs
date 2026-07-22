const DEFAULT_CONFIG = {
  SHEET_MASTER: "MASTER",
  SHEET_PRESENSI: "PRESENSI",
  SHEET_LOG: "LOG",
  TIMEZONE: "Asia/Jakarta",
  REQUIRE_API_KEY: "false"
};

function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function handleRequest_(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = String(params.action || "health").toLowerCase();

    if (requiresApiKey_(action)) {
      validateApiKey_(params.apiKey || "");
    }

    let payload;
    switch (action) {
      case "health":
        payload = {
          success: true,
          message: "API aktif.",
          data: {
            app: "Presensi Barcode V4",
            time: formatDateTime_(new Date())
          }
        };
        break;

      case "scan":
        payload = {
          success: true,
          message: "Scan diproses.",
          data: processScan_(params)
        };
        break;

      case "stats":
        payload = {
          success: true,
          message: "Statistik berhasil diambil.",
          data: getStatsData_()
        };
        break;

      case "history":
        payload = {
          success: true,
          message: "Riwayat berhasil diambil.",
          data: getHistoryData_(Number(params.limit || 20))
        };
        break;

      case "attendance":
        payload = {
          success: true,
          message: "Data presensi berhasil diambil.",
          data: getAttendanceData_(Number(params.limit || 5000))
        };
        break;

      case "reset_today":
        payload = resetTodayAttendance_(params);
        break;

      default:
        payload = {
          success: false,
          message: "Action tidak dikenali."
        };
    }

    return createOutput_(payload, params.callback);
  } catch (error) {
    const payload = {
      success: false,
      message: error.message || "Terjadi kesalahan pada server."
    };
    return createOutput_(payload, (e && e.parameter && e.parameter.callback) || "");
  }
}

function setupProject() {
  const ss = getSpreadsheet_();
  const config = getConfig_();

  ensureSheetWithHeader_(ss, config.SHEET_MASTER, ["Barcode", "Nama", "Rumah", "Status"]);
  ensureSheetWithHeader_(ss, config.SHEET_PRESENSI, ["Barcode", "Nama", "Rumah", "Tanggal", "Jam", "Status", "Device"]);
  ensureSheetWithHeader_(ss, config.SHEET_LOG, ["Waktu", "Barcode", "Device", "Hasil"]);

  SpreadsheetApp.flush();
  return "Sheet MASTER, PRESENSI, dan LOG siap digunakan.";
}

function seedSampleMaster() {
  const ss = getSpreadsheet_();
  const config = getConfig_();
  const sheet = ss.getSheetByName(config.SHEET_MASTER);
  const samples = [
    ["100001", "Andi", "A1", "Aktif"],
    ["100002", "Budi", "A2", "Aktif"],
    ["100003", "Citra", "B1", "Aktif"],
    ["100004", "Dewi", "B2", "Nonaktif"]
  ];

  if (sheet.getLastRow() <= 1) {
    sheet.getRange(2, 1, samples.length, samples[0].length).setValues(samples);
  }

  return "Contoh data MASTER berhasil ditambahkan.";
}

function processScan_(params) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const barcode = sanitize_(params.barcode);
    const source = sanitize_(params.source || "scanner");
    const device = sanitize_(params.device || "Perangkat Tanpa Nama");

    if (!barcode) {
      throw new Error("Barcode wajib diisi.");
    }

    const ss = getSpreadsheet_();
    const config = getConfig_();
    const masterSheet = ss.getSheetByName(config.SHEET_MASTER);
    const presensiSheet = ss.getSheetByName(config.SHEET_PRESENSI);

    const masterMap = getMasterMap_(masterSheet);
    const peserta = masterMap[barcode];

    if (!peserta) {
      appendLog_(barcode, device, "TIDAK_DITEMUKAN");
      return {
        scan: buildScanResponse_(barcode, "", "", "TIDAK_DITEMUKAN", "Barcode tidak ditemukan di sheet MASTER.", source),
        stats: getStatsData_(),
        history: getHistoryData_(20)
      };
    }

    if (String(peserta.status || "").toLowerCase() !== "aktif") {
      appendLog_(barcode, device, "NONAKTIF");
      return {
        scan: buildScanResponse_(barcode, peserta.nama, peserta.rumah, "NONAKTIF", "Peserta tidak aktif.", source),
        stats: getStatsData_(),
        history: getHistoryData_(20)
      };
    }

    const today = formatDate_(new Date());
    const existing = findTodayAttendanceByBarcode_(presensiSheet, barcode, today);
    if (existing) {
      appendLog_(barcode, device, "SUDAH_HADIR");
      return {
        scan: buildScanResponse_(barcode, peserta.nama, peserta.rumah, "SUDAH_HADIR", "Peserta sudah tercatat hadir hari ini.", source, existing.jam),
        stats: getStatsData_(),
        history: getHistoryData_(20)
      };
    }

    const now = new Date();
    const tanggal = formatDate_(now);
    const jam = formatTime_(now);
    presensiSheet.appendRow([barcode, peserta.nama, peserta.rumah, tanggal, jam, "HADIR", device]);
    appendLog_(barcode, device, "HADIR");

    return {
      scan: buildScanResponse_(barcode, peserta.nama, peserta.rumah, "HADIR", "Presensi berhasil disimpan.", source, jam),
      stats: getStatsData_(),
      history: getHistoryData_(20)
    };
  } finally {
    lock.releaseLock();
  }
}

function resetTodayAttendance_(params) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const ss = getSpreadsheet_();
    const config = getConfig_();
    const presensiSheet = ss.getSheetByName(config.SHEET_PRESENSI);
    const device = sanitize_(params.device || "Admin");
    const today = formatDate_(new Date());
    const lastRow = presensiSheet.getLastRow();

    if (lastRow <= 1) {
      appendLog_("SYSTEM", device, "RESET_TODAY_0");
      return {
        success: true,
        message: "Tidak ada data presensi hari ini untuk direset.",
        data: {
          removed: 0
        }
      };
    }

    const values = presensiSheet.getRange(2, 1, lastRow - 1, 7).getValues();
    let removed = 0;
    for (let i = values.length - 1; i >= 0; i--) {
      if (sanitize_(values[i][3]) === today) {
        presensiSheet.deleteRow(i + 2);
        removed++;
      }
    }

    appendLog_("SYSTEM", device, "RESET_TODAY_" + removed);

    return {
      success: true,
      message: removed > 0 ? "Presensi hari ini berhasil direset." : "Tidak ada data presensi hari ini untuk direset.",
      data: {
        removed: removed,
        stats: getStatsData_()
      }
    };
  } finally {
    lock.releaseLock();
  }
}

function getStatsData_() {
  const ss = getSpreadsheet_();
  const config = getConfig_();
  const masterSheet = ss.getSheetByName(config.SHEET_MASTER);
  const presensiSheet = ss.getSheetByName(config.SHEET_PRESENSI);
  const today = formatDate_(new Date());

  const masterValues = getDataRows_(masterSheet, 4);
  const presensiValues = getDataRows_(presensiSheet, 7);

  let totalAktif = 0;
  masterValues.forEach(function (row) {
    if (String(row[3] || "").toLowerCase() === "aktif") {
      totalAktif++;
    }
  });

  const hadirRows = presensiValues.filter(function (row) {
    return sanitize_(row[3]) === today;
  });

  const hadir = hadirRows.length;
  const belumHadir = Math.max(totalAktif - hadir, 0);
  const persentase = totalAktif > 0 ? (hadir / totalAktif) * 100 : 0;

  return {
    tanggal: today,
    totalPeserta: totalAktif,
    hadir: hadir,
    belumHadir: belumHadir,
    persentase: round_(persentase, 1),
    totalScan: hadirRows.length
  };
}

function getAttendanceData_(limit) {
  const ss = getSpreadsheet_();
  const config = getConfig_();
  const presensiSheet = ss.getSheetByName(config.SHEET_PRESENSI);
  const today = formatDate_(new Date());
  const rows = getDataRows_(presensiSheet, 7)
    .filter(function (row) {
      return sanitize_(row[3]) === today;
    })
    .map(function (row) {
      return {
        barcode: sanitize_(row[0]),
        nama: sanitize_(row[1]),
        rumah: sanitize_(row[2]),
        tanggal: sanitize_(row[3]),
        jam: sanitize_(row[4]),
        status: sanitize_(row[5]),
        device: sanitize_(row[6])
      };
    });

  const safeLimit = Math.min(Math.max(limit || 5000, 1), 5000);
  return rows.slice(0, safeLimit);
}

function getHistoryData_(limit) {
  const ss = getSpreadsheet_();
  const config = getConfig_();
  const masterSheet = ss.getSheetByName(config.SHEET_MASTER);
  const logSheet = ss.getSheetByName(config.SHEET_LOG);
  const masterMap = getMasterMap_(masterSheet);
  const rows = getDataRows_(logSheet, 4);
  const safeLimit = Math.min(Math.max(limit || 20, 1), 200);

  return rows.slice(-safeLimit).reverse().map(function (row) {
    const barcode = sanitize_(row[1]);
    const peserta = masterMap[barcode] || {};
    const waktu = sanitize_(row[0]);
    return {
      waktu: waktu,
      jam: extractTime_(waktu),
      barcode: barcode,
      nama: sanitize_(peserta.nama || ""),
      rumah: sanitize_(peserta.rumah || ""),
      device: sanitize_(row[2]),
      status: sanitize_(row[3])
    };
  });
}

function getSpreadsheet_() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = sanitize_(properties.getProperty("SPREADSHEET_ID"));

  if (spreadsheetId) {
    return SpreadsheetApp.openById(spreadsheetId);
  }

  try {
    return SpreadsheetApp.getActiveSpreadsheet();
  } catch (error) {
    throw new Error("SPREADSHEET_ID belum diatur di Script Properties.");
  }
}

function getConfig_() {
  const properties = PropertiesService.getScriptProperties();
  return {
    SHEET_MASTER: sanitize_(properties.getProperty("SHEET_MASTER")) || DEFAULT_CONFIG.SHEET_MASTER,
    SHEET_PRESENSI: sanitize_(properties.getProperty("SHEET_PRESENSI")) || DEFAULT_CONFIG.SHEET_PRESENSI,
    SHEET_LOG: sanitize_(properties.getProperty("SHEET_LOG")) || DEFAULT_CONFIG.SHEET_LOG,
    TIMEZONE: sanitize_(properties.getProperty("TIMEZONE")) || DEFAULT_CONFIG.TIMEZONE,
    API_KEY: sanitize_(properties.getProperty("API_KEY")),
    REQUIRE_API_KEY: String(properties.getProperty("REQUIRE_API_KEY") || DEFAULT_CONFIG.REQUIRE_API_KEY).toLowerCase() === "true"
  };
}

function validateApiKey_(incomingKey) {
  const config = getConfig_();
  if (!config.REQUIRE_API_KEY && !config.API_KEY) {
    return true;
  }
  if (!incomingKey || incomingKey !== config.API_KEY) {
    throw new Error("API key tidak valid.");
  }
  return true;
}

function requiresApiKey_(action) {
  return action !== "health";
}

function ensureSheetWithHeader_(spreadsheet, sheetName, headers) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return;
  }

  const currentHeader = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const mismatch = headers.some(function (header, index) {
    return sanitize_(currentHeader[index]) !== header;
  });

  if (mismatch) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function getDataRows_(sheet, width) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  return sheet.getRange(2, 1, lastRow - 1, width).getValues();
}

function getMasterMap_(sheet) {
  const values = getDataRows_(sheet, 4);
  const map = {};
  values.forEach(function (row) {
    const barcode = sanitize_(row[0]);
    if (!barcode) return;
    map[barcode] = {
      barcode: barcode,
      nama: sanitize_(row[1]),
      rumah: sanitize_(row[2]),
      status: sanitize_(row[3])
    };
  });
  return map;
}

function findTodayAttendanceByBarcode_(sheet, barcode, today) {
  const values = getDataRows_(sheet, 7);
  for (var i = values.length - 1; i >= 0; i--) {
    if (sanitize_(values[i][0]) === barcode && sanitize_(values[i][3]) === today) {
      return {
        barcode: barcode,
        nama: sanitize_(values[i][1]),
        rumah: sanitize_(values[i][2]),
        tanggal: sanitize_(values[i][3]),
        jam: sanitize_(values[i][4]),
        status: sanitize_(values[i][5]),
        device: sanitize_(values[i][6])
      };
    }
  }
  return null;
}

function appendLog_(barcode, device, result) {
  const ss = getSpreadsheet_();
  const config = getConfig_();
  const logSheet = ss.getSheetByName(config.SHEET_LOG);
  logSheet.appendRow([formatDateTime_(new Date()), barcode, device, result]);
}

function buildScanResponse_(barcode, nama, rumah, status, message, source, jam) {
  return {
    barcode: barcode,
    nama: nama || "",
    rumah: rumah || "",
    status: status,
    message: message,
    source: source || "scanner",
    tanggal: formatDate_(new Date()),
    jam: jam || formatTime_(new Date())
  };
}

function createOutput_(payload, callbackName) {
  if (callbackName) {
    const safeCallback = String(callbackName).replace(/[^\w$.]/g, "");
    return ContentService
      .createTextOutput(safeCallback + "(" + JSON.stringify(payload) + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function formatDate_(date) {
  const tz = getConfig_().TIMEZONE;
  return Utilities.formatDate(date, tz, "yyyy-MM-dd");
}

function formatTime_(date) {
  const tz = getConfig_().TIMEZONE;
  return Utilities.formatDate(date, tz, "HH:mm:ss");
}

function formatDateTime_(date) {
  const tz = getConfig_().TIMEZONE;
  return Utilities.formatDate(date, tz, "yyyy-MM-dd HH:mm:ss");
}

function extractTime_(value) {
  const text = sanitize_(value);
  const parts = text.split(" ");
  return parts.length > 1 ? parts[1] : text;
}

function sanitize_(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function round_(value, decimals) {
  const multiplier = Math.pow(10, decimals || 0);
  return Math.round(Number(value || 0) * multiplier) / multiplier;
}
