# div-smash

貼一個網址,把它的首屏切成一塊塊碎片,用滑鼠/手指打爛它——碎片會依真實物理掉落、翻滾、堆疊。

**上線:https://yazelin.github.io/div-smash/**(前端 GitHub Pages;截圖/物理擷取後端跑在 .11,docker + nginx 反代 `https://ching-tech.ddns.net/div-smash-api`)

**目前狀態:Phase 1(單人原型,驗證核心手感,無持久化)。全公開部署已跑通:貼真實網址會依 DOM 結構 + 補洞演算法切成滿版碎片(無死角、100% 可打),點擊 140px 範圍內全部碎片一起爆開,有玻璃碎裂音效,首頁顯示最近有人貼過的網址(純清單,無共享損傷狀態)。**

## 本機開發

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

## 部署

- 前端(`public/`):GitHub Pages,`.github/workflows/pages.yml` push 到 master 自動部署
- 後端(`server/`):.11 上 `docker compose up -d --build`(見 `server/docker-compose.yml`),接上既有的 `nginx_bridge_network`,nginx 設定加一段 `location /div-smash-api/` proxy 過去
- `app.js` 會自動判斷:`localhost` 走本機後端,其他 host 一律打 `https://ching-tech.ddns.net/div-smash-api`

## 尚未做(Phase 2 方向,目前判斷不需要)

- 共享累積損傷(多人一起打爛同一份頁面)、破壞過的頁面畫廊——實測後發現破壞的爽感是「這一下」的物理/聲音回饋,跟頁面累積損傷狀態無關,不值得為此加 D1/R2/Worker

詳見 `docs/superpowers/specs/2026-07-07-div-smash-design.md` 與 `docs/superpowers/plans/2026-07-07-div-smash-phase1.md`。
