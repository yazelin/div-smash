# div-smash

貼一個網址,把它的首屏切成一塊塊碎片,用滑鼠/手指打爛它——碎片會依真實物理掉落、翻滾、堆疊。

**目前狀態:Phase 1(單人原型,驗證核心手感,無持久化)。已實測:貼真實網址(example.com、wikipedia.org)會依 DOM 結構切成對應塊數的碎片,點擊後正確鬆脫掉落,大塊(如整個首頁區塊)會壓在還沒打破的小塊(如圖示列)上方,碰撞判定正確。**

## 執行方式

```bash
# 1. 啟動截圖/切塊後端
cd server && npm install && npx playwright install chromium && node index.js

# 2. 另開一個 terminal,啟動前端靜態伺服
cd public && python3 -m http.server 8000
```

開瀏覽器到 `http://localhost:8000`,貼上網址、按載入,點擊畫面上的碎片。

## 架構

- `server/`:Node + Playwright,`POST /capture` 收 URL,回傳截圖(base64)+ 首屏內顯著 DOM 元素的座標。有 SSRF 防護(擋私網/loopback IP)與簡單 per-IP rate limit。
- `public/`:純靜態頁面,`matter.js`(CDN 載入)做碎片物理破壞,截圖當作 sprite sheet 用,不需要後端裁圖。

## 測試

```bash
cd server && npm test
```

## 尚未做(Phase 2 方向)

- 共享累積損傷(多人一起打爛同一份頁面)、破壞過的頁面畫廊
- 部署到 .11 / 正式上線

詳見 `docs/superpowers/specs/2026-07-07-div-smash-design.md` 與 `docs/superpowers/plans/2026-07-07-div-smash-phase1.md`。
