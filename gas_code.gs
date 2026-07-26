// ================================================================
// 大溪國中校內會議(含活動)行事曆 - Google Apps Script 後端
// ================================================================
//
// 【部署步驟】
// 1. 開啟 Google 試算表，建立一個新的試算表（名稱隨意）
// 2. 點選上方選單「擴充功能」→「Apps Script」
// 3. 將本檔案全部內容貼入 Code.gs（覆蓋原有內容）
// 4. 儲存後，點選「部署」→「新增部署」
// 5. 類型選「網路應用程式」
//    - 描述：會議行事曆 API
//    - 執行身分：我（你的 Gmail）
//    - 存取權限：所有人（含匿名使用者）
// 6. 點「部署」，複製取得的「網路應用程式 URL」
// 7. 將此 URL 貼入 index.html 頂部的 GAS_URL 變數
// ================================================================

var SHEET_NAME = '會議資料';

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    var header = ['ID', '標題', '日期', '開始時間', '結束時間',
                  '地點', '主辦單位/部門', '分類', '說明備註', '密碼(Hash)', '建立時間'];
    sheet.appendRow(header);
    sheet.getRange(1, 1, 1, header.length)
         .setFontWeight('bold')
         .setBackground('#1a3c6e')
         .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 220);
    sheet.setColumnWidth(2, 160);
    sheet.setColumnWidth(3, 100);
    sheet.setColumnWidth(10, 220);
  }
  return sheet;
}

function hashPassword(password) {
  var rawHash = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password,
    Utilities.Charset.UTF_8
  );
  return rawHash.map(function(b) {
    return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join('');
}

function timeToMinutes(timeStr) {
  var parts = String(timeStr).split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1] || 0);
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    var sheet = getSheet();
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return jsonResponse({ success: true, events: [] });
    var eventsArr = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      eventsArr.push({
        id: String(row[0]), title: String(row[1]), date: String(row[2]),
        startTime: String(row[3]), endTime: String(row[4]), location: String(row[5]),
        organizer: String(row[6]), category: String(row[7] || ''),
        description: String(row[8] || ''), createdAt: String(row[10] || '')
      });
    }
    return jsonResponse({ success: true, events: eventsArr });
  } catch(err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.action === 'add') return addEvent(data);
    if (data.action === 'delete') return deleteEvent(data);
    return jsonResponse({ success: false, error: '未知的操作類型' });
  } catch(err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function addEvent(data) {
  var required = ['title', 'date', 'startTime', 'endTime', 'location', 'organizer', 'password'];
  for (var i = 0; i < required.length; i++) {
    if (!data[required[i]]) return jsonResponse({ success: false, error: '請填寫所有必填欄位' });
  }
  if (timeToMinutes(data.endTime) <= timeToMinutes(data.startTime))
    return jsonResponse({ success: false, error: '結束時間必須晚於開始時間' });

  var sheet = getSheet();
  var conflict = checkConflict(sheet, data.date, data.startTime, data.endTime, data.location, null);
  if (conflict) {
    return jsonResponse({
      success: false, conflict: true,
      error: '衝突！地點「' + data.location + '」該時段已有：「' + conflict.title + '」（' + conflict.startTime + '–' + conflict.endTime + '）'
    });
  }
  var id = Utilities.getUuid();
  var passwordHash = hashPassword(data.password);
  var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([id, data.title, data.date, data.startTime, data.endTime, data.location,
    data.organizer, data.category || '', data.description || '', passwordHash, now]);
  return jsonResponse({ success: true, id: id });
}

function deleteEvent(data) {
  if (!data.id || !data.password) return jsonResponse({ success: false, error: '缺少 ID 或密碼' });
  var sheet = getSheet();
  var rows = sheet.getDataRange().getValues();
  var passwordHash = hashPassword(data.password);
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(data.id)) {
      if (rows[i][9] !== passwordHash) return jsonResponse({ success: false, error: '密碼錯誤，無法刪除' });
      sheet.deleteRow(i + 1);
      return jsonResponse({ success: true });
    }
  }
  return jsonResponse({ success: false, error: '找不到此會議資料' });
}

function checkConflict(sheet, date, startTime, endTime, location, excludeId) {
  var rows = sheet.getDataRange().getValues();
  var newStart = timeToMinutes(startTime);
  var newEnd = timeToMinutes(endTime);
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (!row[0]) continue;
    if (excludeId && String(row[0]) === String(excludeId)) continue;
    if (String(row[2]) === String(date) && String(row[5]).trim() === String(location).trim()) {
      var existStart = timeToMinutes(row[3]);
      var existEnd = timeToMinutes(row[4]);
      if (newStart < existEnd && newEnd > existStart)
        return { title: row[1], startTime: row[3], endTime: row[4] };
    }
  }
  return null;
}
