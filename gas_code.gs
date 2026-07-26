// ================================================================
// 大溪國中校內會議(含活動)行事曆 - Google Apps Script 後端
// 版本：2.3（強化日期與時間字串格式化，避免 Google Sheets 自動轉 Date 物件）
// ================================================================

var SHEET_NAME = '會議資料';

// ── 取得工作表 ────────────────────────────────────────────────────
function getSheet() {
  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = props.getProperty('SPREADSHEET_ID');
  var ss;
  if (spreadsheetId) {
    try {
      ss = SpreadsheetApp.openById(spreadsheetId);
    } catch (e) {
      ss = null;
    }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('大溪國中校內會議行事曆資料庫');
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    var header = ['ID', '標題', '日期', '開始時間', '結束時間', '地點',
                  '主辦單位/部門', '分類', '說明備註', '密碼(Hash)', '建立時間'];
    sheet.appendRow(header);
    sheet.getRange(1, 1, 1, header.length)
         .setFontWeight('bold')
         .setBackground('#1a3c6e')
         .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, 11, 120);
    sheet.setColumnWidth(2, 180);
    sheet.setColumnWidth(6, 150);
  }
  return sheet;
}

// ── 格式化日期與時間 ──────────────────────────────────────────────
function formatDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Taipei', 'yyyy-MM-dd');
  }
  var str = String(val).trim();
  if (str.match(/^\d{4}-\d{2}-\d{2}$/)) return str;
  var cleanStr = str.replace(/\s*\([^)]*\)\s*$/, '');
  var d = new Date(cleanStr);
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd');
  }
  return str;
}

function formatTime(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Taipei', 'HH:mm');
  }
  var str = String(val).trim();
  if (str.match(/^\d{1,2}:\d{2}$/)) {
    var parts = str.split(':');
    return ('0' + parts[0]).slice(-2) + ':' + ('0' + parts[1]).slice(-2);
  }
  var cleanStr = str.replace(/\s*\([^)]*\)\s*$/, '');
  var d = new Date(cleanStr);
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, 'Asia/Taipei', 'HH:mm');
  }
  return str;
}

// ── SHA-256 密碼雜湊 ──────────────────────────────────────────────
function hashPassword(password) {
  var raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password,
    Utilities.Charset.UTF_8
  );
  return raw.map(function(b) {
    return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join('');
}

// ── 時間轉分鐘 ────────────────────────────────────────────────────
function t2m(t) {
  var parts = String(t).split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1] || 0);
}

// ── JSON 回應 ─────────────────────────────────────────────────────
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── 主入口：全部走 doGet，避免 CORS preflight ─────────────────────
function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var action = (params.action || 'list').toLowerCase();
    var data   = {};
    if (params.data) {
      data = JSON.parse(params.data);
    }

    if (action === 'list')   return listEvents();
    if (action === 'add')    return addEvent(data);
    if (action === 'delete') return deleteEvent(data);

    return jsonResponse({ success: false, error: '未知操作：' + action });
  } catch(err) {
    return jsonResponse({ success: false, error: '伺服器錯誤：' + err.message });
  }
}

// ── 列出所有會議 ──────────────────────────────────────────────────
function listEvents() {
  var sheet = getSheet();
  var rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return jsonResponse({ success: true, events: [] });

  var result = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue;
    result.push({
      id:          String(r[0]),
      title:       String(r[1]),
      date:        formatDate(r[2]),
      startTime:   formatTime(r[3]),
      endTime:     formatTime(r[4]),
      location:    String(r[5]),
      organizer:   String(r[6]),
      category:    String(r[7] || ''),
      description: String(r[8] || ''),
      createdAt:   String(r[10] || '')
    });
  }
  return jsonResponse({ success: true, events: result });
}

// ── 新增會議 ──────────────────────────────────────────────────────
function addEvent(data) {
  var required = ['title', 'date', 'startTime', 'endTime', 'location', 'organizer', 'password'];
  for (var i = 0; i < required.length; i++) {
    if (!data[required[i]]) {
      return jsonResponse({ success: false, error: '請填寫所有必填欄位' });
    }
  }
  var cleanDate  = formatDate(data.date);
  var cleanStart = formatTime(data.startTime);
  var cleanEnd   = formatTime(data.endTime);

  if (t2m(cleanEnd) <= t2m(cleanStart)) {
    return jsonResponse({ success: false, error: '結束時間必須晚於開始時間' });
  }

  var sheet = getSheet();

  // 衝突偵測
  var conflict = checkConflict(sheet, cleanDate, cleanStart, cleanEnd, data.location, null);
  if (conflict) {
    return jsonResponse({
      success:  false,
      conflict: true,
      error:    '衝突！地點「' + data.location + '」' +
                conflict.startTime + '–' + conflict.endTime +
                ' 已有「' + conflict.title + '」'
    });
  }

  var id           = Utilities.getUuid();
  var passwordHash = hashPassword(data.password);
  var now          = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm');

  sheet.appendRow([
    id,
    data.title,
    "'" + cleanDate,
    "'" + cleanStart,
    "'" + cleanEnd,
    data.location,
    data.organizer,
    data.category    || '',
    data.description || '',
    passwordHash,
    now
  ]);

  return jsonResponse({ success: true, id: id });
}

// ── 刪除會議 ──────────────────────────────────────────────────────
function deleteEvent(data) {
  if (!data.id || !data.password) {
    return jsonResponse({ success: false, error: '缺少 ID 或密碼' });
  }

  var MASTER_PASSWORD = '680626';
  var sheet        = getSheet();
  var rows         = sheet.getDataRange().getValues();
  var passwordHash = hashPassword(data.password);

  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      var isMaster = (String(data.password).trim() === MASTER_PASSWORD);
      var isOwner  = (rows[i][9] === passwordHash);
      if (!isMaster && !isOwner) {
        return jsonResponse({ success: false, error: '密碼錯誤，無法刪除' });
      }
      sheet.deleteRow(i + 1);
      return jsonResponse({ success: true });
    }
  }
  return jsonResponse({ success: false, error: '找不到此會議資料' });
}

// ── 衝突偵測輔助 ──────────────────────────────────────────────────
function checkConflict(sheet, date, startTime, endTime, location, excludeId) {
  var rows     = sheet.getDataRange().getValues();
  var newStart = t2m(startTime);
  var newEnd   = t2m(endTime);

  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue;
    if (excludeId && String(r[0]) === String(excludeId)) continue;

    var rowDate = formatDate(r[2]);
    var rowLoc  = String(r[5]).trim();
    if (rowDate === date && rowLoc === String(location).trim()) {
      var exStart = t2m(formatTime(r[3]));
      var exEnd   = t2m(formatTime(r[4]));
      if (newStart < exEnd && newEnd > exStart) {
        return { title: String(r[1]), startTime: formatTime(r[3]), endTime: formatTime(r[4]) };
      }
    }
  }
  return null;
}
