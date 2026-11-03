# 隨手記帳

打一句話就記好帳的個人記帳 App（PWA）。不用下載，手機瀏覽器打開、加到主畫面就能像 App 一樣用。

## 功能

- **聊天式記帳**：`午餐 120`、`昨天 計程車 250`、`薪水 +45000`、`早餐 60、咖啡 85`（一次多筆）、`房租 1.5萬`、`前天晚餐一百二十元`
- **自動判斷**：金額、日期（今天／昨天／前天／週五／上週三／11/1／3天前／5號）、收入或支出、分類
- **打字時即時預覽**：送出前就看得到會記成什麼
- **點一下就能改**：金額、收支、分類、日期、備註；改過的分類會自動學起來
- **刪除、撤銷都能復原**
- **問問題**：`今天花多少`、`這週`、`本月`、`上個月`、`復原`、`幫助`
- **圖表**：本月結餘、預算進度、分類甜甜圈圖、每日支出、近六個月收支、明細
- **正回饋**：收據蓋章動畫、鼓勵訊息、連續記帳天數、里程碑彩帶、比平常省錢提醒、無支出日統計
- **深色模式**、離線可用、CSV 匯出／匯入（Excel、Google 試算表都能開）
- **雲端同步（選用）**：Supabase，手機和電腦看同一份帳

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 主頁面 |
| `css/app.css` | 外觀 |
| `js/parser.js` | 把句子解析成記帳資料 |
| `js/store.js` | 本機儲存、雲端同步、CSV |
| `js/charts.js` | 圖表（純 SVG，不需外部套件） |
| `js/feedback.js` | 動畫、震動、鼓勵訊息 |
| `js/app.js` | 畫面與互動 |
| `sw.js`、`manifest.webmanifest`、`icons/` | PWA（離線、加到主畫面、圖示） |
| `config.js` | 雲端同步設定（選填） |
| `supabase.sql` | Supabase 資料表與權限 |

沒有建置步驟，整個資料夾直接放上任何靜態網站空間就能用。

---

## 第一步：放上網（擇一）

### A. Netlify Drop（最快，免 Git）

1. 打開 https://app.netlify.com/drop ，用 Google 或 GitHub 帳號登入
2. 把整個 `expense-pwa` 資料夾拖進網頁
3. 幾秒後會拿到一個網址，例如 `https://xxxx.netlify.app`
4. 在 Site settings → Change site name 可以改成好記的名字

### B. GitHub Pages

1. 在 GitHub 建一個新的 repository（例如 `jizhang`）
2. 把這個資料夾的所有檔案上傳到 repository 根目錄
3. Settings → Pages → Source 選 `Deploy from a branch`，Branch 選 `main` / `(root)` → Save
4. 等一兩分鐘，網址是 `https://你的帳號.github.io/jizhang/`

## 第二步：裝到手機主畫面

- **iPhone（Safari）**：打開網址 → 下方「分享」按鈕 → 「加入主畫面」
- **Android（Chrome）**：打開網址 → App 的「設定」頁會出現「安裝到主畫面」按鈕，或從瀏覽器選單選「安裝應用程式」

到這一步就能開始記帳了，資料存在這支手機的瀏覽器裡。

---

## 第三步（選用）：開啟雲端同步

想要手機、電腦同一份帳，或不怕換手機資料不見，就做這一段，大約 10 分鐘。

1. **註冊 Supabase**：https://supabase.com → Start your project → 用 GitHub 或 Email 註冊（免費方案即可）
2. **建立專案**：New project → 名稱隨意 → 設一組資料庫密碼（記下來）→ Region 選 `Northeast Asia (Tokyo)` 或 `Southeast Asia (Singapore)` → Create
3. **建立資料表**：左側 SQL Editor → New query → 把 `supabase.sql` 的內容整個貼上 → Run，看到 Success 就好
4. **設定登入網址**：Authentication → URL Configuration
   - Site URL 填你的 App 網址（第一步拿到的）
   - Redirect URLs 也加上同一個網址
5. **拿到連線資訊**：Project Settings → API（或 API Keys）
   - 複製 **Project URL**
   - 複製 **anon public key**（新版後台叫 **Publishable key**）
6. **貼到 App**：App →「設定」→「雲端同步」→「設定 Supabase」→ 貼上兩個值 →「儲存並連線」
7. **登入**：
   - **Email 登入（不用額外設定）**：輸入 Email →「寄送」→ 到信箱點登入連結
   - **Google 登入（要多做幾步）**：Supabase 的 Authentication → Sign In / Providers → Google → 照畫面指示到 Google Cloud Console 建立 OAuth 用戶端，把 Client ID 和 Secret 貼回 Supabase → Save

登入後，這支手機上原本的紀錄會自動上傳；之後每記一筆都會自動同步。在另一台裝置打開同一個網址、用同一個帳號登入，就會看到同一份帳。

> 如果不想每台裝置都貼一次，可以把 Project URL 和 key 填進 `config.js` 再重新上傳。anon／Publishable key 本來就是公開金鑰，資料由 `supabase.sql` 的權限規則保護，只有登入的本人看得到自己的資料。

### Supabase 免費方案要注意

- 大約一週完全沒使用，專案會被暫停。到 Supabase 後台按 Restore 就恢復，資料不會刪除。天天記帳就不會遇到。
- App 本身離線也能用，暫停期間記的帳會在恢復後自動補同步。

---

## 備份

App →「設定」→「匯出 CSV」。建議每個月匯出一次。CSV 可以直接用 Excel 或 Google 試算表打開；之後要搬家，用「匯入 CSV」就能全部匯回來（同一筆不會重複）。

## 更新 App

改完檔案重新上傳即可。若有改到檔案，記得把 `sw.js` 第一行的 `VERSION` 改一個新號碼，打開 App 時會跳出「有新版本」提示，點「更新」就好。
