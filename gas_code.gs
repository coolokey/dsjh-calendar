// ================================================================
// 大溪國中校內會議(含活動)行事曆 - Google Apps Script 後端
// 版本：2.0（全 GET 模式，無 CORS 問題）
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
    var action = (e.parameter.action || 'list').toLowerCase();
    var data   = {};
    if (e.parameter.data) {
      data = JSON.parse(e.parameter.data);
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
      date:        String(r[2]),
      startTime:   String(r[3]),
      endTime:     String(r[4]),
      location:    String(r[5]),
      organizer:   String(r[6]),
      category:    String(r[7] || ''),
      description: String(r[8] || ''),
      // pwHash 不回傳給前端（安全）
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
  if (t2m(data.endTime) <= t2m(data.startTime)) {
    return jsonResponse({ success: false, error: '結束時間必須晚於開始時間' });
  }

  var sheet = getSheet();

  // 衝突偵測
  var conflict = checkConflict(sheet, data.date, data.startTime, data.endTime, data.location, null);
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
    data.date,
    data.startTime,
    data.endTime,
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

  var sheet        = getSheet();
  var rows         = sheet.getDataRange().getValues();
  var passwordHash = hashPassword(data.password);

  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      if (rows[i][9] !== passwordHash) {
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
    if (String(r[2]) === String(date) &&
        String(r[5]).trim() === String(location).trim()) {
      var exStart = t2m(r[3]);
      var exEnd   = t2m(r[4]);
      if (newStart < exEnd && newEnd > exStart) {
        return { title: String(r[1]), startTime: String(r[3]), endTime: String(r[4]) };
      }
    }
  }
  return null;
}
