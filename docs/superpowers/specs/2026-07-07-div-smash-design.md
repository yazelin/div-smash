# div-smash — 網頁解壓小遊戲設計(Phase 1)

## 目標

貼一個 URL,把該頁面首屏切成一塊塊對應原始 DOM 元素的碎片,讓使用者用滑鼠/手指把它們打爛掉落,驗證「切塊 + 物理破壞」這個核心手感好不好玩。

## 範圍(Phase 1)

**做:**
- 輸入框貼 URL → 後端截圖 + 抓取首屏內顯著 DOM 元素的座標
- 前端用 matter.js 做物理破壞:點擊碎片鬆脫、重力掉落、與地板及其他碎片碰撞堆疊
- 單人、無持久化,重新整理頁面即恢復完整

**不做(留給 Phase 2,本文件不深入設計):**
- 共享累積損傷(多人一起打爛同一份頁面)
- 「破壞過的頁面」畫廊 / 名人堂
- 帳號系統、排行榜
- 除下方基本 SSRF/rate limit 外的濫用防治(自動內容審核等)

## 架構

```
[前端靜態頁面]  --POST /capture {url}-->  [.11 上的 Playwright 小服務]
 (vanilla JS + matter.js CDN)                  (Node + Playwright)
        ^                                            |
        |____ {screenshot(base64), shards:[{x,y,w,h}]} ____|
```

- **前端**:純靜態 HTML/JS,不需框架、不需自己的後端。開發/驗證階段可本機直接開靜態檔案伺服。
- **後端(.11)**:單一職責的 Node + Playwright API——「給 URL,回一張截圖 + 一串區塊座標」。不做圖片裁切,不需要 sharp 等影像處理套件。
- **無資料庫**:Phase 1 沒有任何需要跨請求記憶的狀態。

## 後端:切塊邏輯

1. Playwright 開啟 headless 瀏覽器,viewport 設 1280×800,`page.goto(url, {waitUntil: 'load', timeout: 15000})`。
2. `page.evaluate()` 在瀏覽器內從 `document.body` 遞迴走訪 DOM:
   - 只收集**完全落在首屏視窗內**、可見(非 `display:none`/`visibility:hidden`/`opacity:0`、寬高 > 0)的元素
   - 面積 < 40×40px 的元素直接跳過、不遞迴進其子元素(子元素範圍必然更小,不可能找到更大的候選)
   - 面積 > 視窗 80% 的元素(通常是外層 wrapper)不收為候選,但要遞迴進其子元素找更小的候選
   - 面積介於兩者之間 → 收為候選,且不再遞迴進它的子元素(避免同一塊區域被切兩次)
3. 候選數量上限 80,超過時依面積由大到小排序,砍掉最小的一批。
4. `page.screenshot({ clip: { x:0, y:0, width:1280, height:800 } })` 截取整張首屏截圖。
5. 回傳 `{ screenshot: "data:image/png;base64,...", shards: [{x,y,w,h}, ...] }`。

## 前端:物理破壞

**關鍵技巧**:不裁切截圖,把整張截圖當成一張 sprite sheet 使用。每塊碎片渲染時用 `ctx.drawImage(img, x, y, w, h, destX, destY, w, h)`,來源矩形直接用該碎片在原截圖中的座標——完全不需要後端裁圖或產生多張小圖檔。

- 每個 shard → `Matter.Bodies.rectangle(cx, cy, w, h)`,初始 `isStatic: true`(釘住,拼出完整頁面外觀)
- 畫面下方是一塊看不見的地板 static body,提供碎片掉落後堆疊的表面
- 點擊/點擊命中判定:依 DOM 原始順序(後截取的元素通常疊在上層)由上而下判斷點擊落在哪個 shard 的矩形內
- 命中後該 body 的 `isStatic` 改為 `false`,施加一個小隨機衝力/轉矩,交給 matter.js 內建的重力與碰撞處理掉落、翻滾、堆疊——不用自己寫碰撞或堆疊邏輯
- 每一影格:讀取每個 body 目前的 position/angle,`ctx.save()` → 位移旋轉到該位置角度 → `drawImage` 對應的截圖區塊 → `ctx.restore()`

## 安全防護(Phase 1 必做)

.11 這支服務會替任何訪客抓取「使用者貼的任意 URL」,且需可被公網存取——這是 SSRF 風險,且 .11 上還跑著其他內部服務,不可省略:

- 只允許 `http`/`https` scheme,其餘一律拒絕
- 解析目標 hostname 後檢查 IP,拒絕私網/loopback/link-local 範圍:`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`127.0.0.0/8`、`169.254.0.0/16`、`::1`、`fc00::/7`
- 頁面載入 timeout 15 秒
- 簡單 per-IP rate limit(Node 記憶體內的 token bucket 即可,不需要 Redis 等外部依賴)

不需要帳號機制。

## 驗證方式

- 後端:一支小型自我檢查腳本(`test_capture.js` 或等效),斷言:
  1. 對已知靜態測試頁截取,回傳的 shard 數量落在合理範圍內
  2. 私網 IP(如 `http://127.0.0.1`、`http://192.168.1.1`)的 URL 會被擋掉並回錯誤
- 前端手感:無法寫斷言驗證「好不好玩」,會實際啟動服務、在瀏覽器貼一個真實 URL、點擊碎片確認真的會鬆脫掉落堆疊,而非僅憑程式碼閱讀判定完成。

## Phase 2 方向(僅列大概,屆時再細談)

- Cloudflare D1 存每個 URL 的損傷狀態(哪些 shard 已掉落)、Cloudflare R2 存截圖、Cloudflare Worker 串接前端(Pages)與 D1/R2/.11 擷取服務
- 損傷累積達門檻(例如 80% shard 已掉落)→ 退休進「破壞名人堂」畫廊,供他人瀏覽/繼續打爛未滿門檻的其他 URL
- 檢舉/下架先用人工手動處理,不做自動內容審核(除非真的變成問題)
