# 大溪國中校內會議(含活動)行事曆

## 檔案說明

| 檔案 | 說明 |
|------|------|
| `index.html` | 前端網頁，上傳到 NAS 即可使用 |
| `gas_code.gs` | Google Apps Script 後端，貼入 GAS 編輯器 |

---

## 部署步驟

### Step 1：建立 Google Apps Script

1. 開啟 [Google 試算表](https://sheets.google.com)，建立一個新試算表
2. 點選上方選單「**擴充功能**」→「**Apps Script**」
3. 將 `gas_code.gs` 的全部內容**貼入** Code.gs（覆蓋原有內容）
4. 儲存（Ctrl+S）

### Step 2：部署為 Web App

1. 點選右上角「**部署**」→「**新增部署**」
2. 類型選「**網路應用程式**」
3. 設定如下：
   - 說明：會議行事曆 API
   - 執行身分：**我（你的帳號）**
   - 存取權限：**所有人（含匿名使用者）**
4. 點「部署」，**複製 Web App URL**（格式類似 https://script.google.com/macros/s/...../exec）

### Step 3：設定前端

1. 用文字編輯器開啟 `index.html`
2. 找到頂部的這一行：
   ```javascript
   const GAS_URL = 'YOUR_GAS_WEB_APP_URL_HERE';
   ```
3. 將 `YOUR_GAS_WEB_APP_URL_HERE` 替換為剛才複製的 URL

### Step 4：上傳到 NAS

1. 將 `index.html` 上傳到 NAS 的 Web 目錄
2. 用瀏覽器開啟網址，例如：`http://192.168.x.x/index.html`

---

## 功能說明

- **月曆 / 週曆 / 日曆** 三種檢視模式，自由切換
- 點擊日期格子可快速開啟新增表單
- 同地點同時段衝突時，系統自動擋下並提示
- 每筆會議有各自的刪除密碼，輸入正確才能刪除
- 點擊列印按鈕可列印或匯出 PDF

## 忘記密碼怎麼辦？

由於密碼使用 SHA-256 加密儲存，無法還原。
若忘記密碼，請由管理者**直接到 Google Sheets 刪除該筆資料**。

---

## 注意事項

- 每次修改 GAS 程式碼後，需重新部署才會生效
  - 部署 → 管理部署 → 選「編輯」→ 版本改為「新版本」→ 部署
- 建議定期備份 Google Sheets 資料
