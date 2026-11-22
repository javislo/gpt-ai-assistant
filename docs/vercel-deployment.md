# Vercel 部署說明（Google Gemini 免費方案）

這份說明適用於已經部署在 Vercel、並已連接 LINE Messaging API 的現有專案。**不需要重新建立 LINE Bot**，也**不需要 OpenAI 或 Groq 的 API Key**。

## 1. 取得 Gemini API Key（免費方案）

1. 用 Google 帳號登入 Google AI Studio（aistudio.google.com）。
2. 建立 API Key。建議使用一個**沒有連結帳單（Billing）**的 Google Cloud 專案，這樣專案會維持在 Free Tier，超過免費額度時只會被拒絕（HTTP 429），不會產生費用。
3. **不要**在該專案啟用付費帳單或升級付費層級。
4. 金鑰只貼在 Vercel 環境變數中，不要寫進程式碼、`.env.example` 或任何 commit。

> 免費額度（每分鐘／每日請求數）會由 Google 調整，請在 Google AI Studio 的 Rate limits 頁面查看目前的數字。

## 2. 在 Vercel 設定環境變數

Vercel 專案 → Settings → Environment Variables，新增或確認：

| 變數 | 必填 | 值 |
| --- | --- | --- |
| `GEMINI_API_KEY` | 是 | 你在 Google AI Studio 建立的金鑰 |
| `LINE_CHANNEL_ACCESS_TOKEN` | 是 | 沿用現有值 |
| `LINE_CHANNEL_SECRET` | 是 | 沿用現有值 |
| `GEMINI_MODEL` | 否 | 預設 `gemini-3.5-flash-lite` |
| `GEMINI_VISION_MODEL` | 否 | 圖片理解用的模型，預設同 `GEMINI_MODEL` |
| `GEMINI_AUDIO_MODEL` | 否 | 語音轉錄用的模型，預設同 `GEMINI_MODEL` |
| `GEMINI_MAX_OUTPUT_TOKENS` | 否 | 預設 `1024` |
| `GEMINI_TIMEOUT` | 否 | 預設 `15000` 毫秒（每一次 Gemini 請求）；須配合 LINE 回覆期限設定 |
| `GEMINI_TEMPERATURE` | 否 | 預設 `1` |
| `GEMINI_THINKING_LEVEL` | 否 | 預設不送（模型自己的預設值）；可填 `minimal`、`low` 等模型支援的值 |

請**刪除**不再使用的舊變數，避免混淆：`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_COMPLETION_MODEL`、`OPENAI_VISION_MODEL`、`OPENAI_TRANSCRIPTION_MODEL`、`OPENAI_IMAGE_GENERATION_*` 等所有 `OPENAI_` 開頭的變數。程式已不會讀取它們。

其他既有變數（`APP_*`、`BOT_*`、`VERCEL_*`、`SERPAPI_*`）維持不變。

## 3. 重新部署並測試

1. 環境變數儲存後，在 Vercel 對最新部署按 **Redeploy**（環境變數只會套用在新的部署）。
2. **先使用獨立的測試 LINE Channel / Preview 環境**驗證；不能將正式 LINE Webhook 同時指向 Preview 和 Production。
3. 在 LINE 依序測試：
   - 傳一段文字 → 應收到 Gemini 的文字回覆。
   - 再追問一句 → 回覆應記得上一句（對話記憶）。
   - 傳一張圖片 → 應收到圖片內容說明。
   - 傳一段語音 → 應收到針對語音內容的文字回覆。
   - 傳 `draw` 指令 → 應回覆「已停用圖片生成功能」。

## 4. 行為說明

- **API**：使用 Gemini 原生 REST API `POST /v1beta/models/{model}:generateContent`，金鑰放在 `x-goog-api-key` 標頭。
- **語音**：LINE 語音（M4A）以 `inlineData`（`audio/m4a`）交給 Gemini 轉成文字，再當作使用者訊息送入對話。不使用 Whisper。
- **超過免費額度**：Gemini 回傳 429 時，機器人回覆「已達 Gemini 免費額度上限」並停止，不會重試也不會改用其他（付費）模型。
- **圖片生成**：免費方案不提供，已停用。
- **執行時間**：`vercel.json` 將 Vercel 函式 `maxDuration` 設為 55 秒，用於降低平台過早中止兩次 Gemini 呼叫的風險；目前未以實際 Vercel 部署驗證。Gemini 單次請求的 `GEMINI_TIMEOUT` 預設為 15 秒；網路、LINE 檔案下載與文字回覆還會另外耗時。
- **LINE Webhook 限制（尚未解決）**：目前 `api/index.js` 會等待 AI 和 LINE Reply API 完成後才回覆 Webhook 200。拉長 Vercel 函式時間**不會**延長 LINE 等候 Webhook 的時間，也不能保證 Reply Token 在處理完畢時仍有效。正式語音場景可能出現 LINE 重送、重複呼叫 Gemini 或回覆失敗。若要可靠處理，應改為快速回覆 Webhook、以具持久性且有原子去重能力的佇列處理訊息，並在逾時風險下使用 LINE Push API（須確認配額和 LINE Messaging API 規則），**不可**只在 `res.sendStatus(200)` 後啟動一個沒有執行保障的 Promise。
- **重複事件（尚未解決）**：目前沒有跨 Vercel 執行個體的持久化 `webhookEventId` 去重。LINE 重送可能消耗額外 Gemini 免費額度；在加入持久化去重和用量限制前，請不要開放高頻或無限制訊息。
- **對話記憶（尚未解決）**：現有 `Map` 是執行個體記憶體，Vercel 冷啟動、擴展或重新部署後可能遺失對話。自動化測試只驗證同一程序中的對話，**不等於**持久化記憶。
- **免費限制**：`429` 只代表已遭 API 拒絕，尚無跨執行個體的每日呼叫計數器。要防止意外超額，務必確認 Gemini API 金鑰屬於未連結付費帳務的 Free Tier 專案，不要將 429 錯誤視為完整的成本控制。

## 5. 可選：LINE 非同步工作流程（預設關閉）

> 目前只完成程式與模擬整合測試：沒有建立第三方帳號、沒有部署 Vercel、沒有呼叫真實 Gemini、QStash、Redis 或 LINE。**在完成第 5.4 節的驗收前，維持 `LINE_ASYNC_ENABLED=false`。**

此模式只處理私人一對一訊息（文字、圖片、語音），群組與其他事件不會排入佇列。架構：

`LINE（HMAC 簽章驗證）→ Vercel /webhook（依序排入 QStash FIFO 佇列後回 200）→ QStash queue（parallelism 1）→ /api/worker（Worker 密碼＋QStash JWT 驗證）→ Upstash Redis（事件租約、去重、用量、記憶、使用者狀態）→ Gemini → LINE Push API`

### 5.1 免費服務與額度（請以各官網目前數字為準）

| 服務 | 用途 | 免費方案重點 |
| --- | --- | --- |
| Upstash QStash Free | 持久化佇列、失敗重送、10 分鐘發布去重 | 官方價格頁目前列出**每日 1,000 則訊息**、單則 1 MB、最多 10 個 queue、DLQ 保留 3 天。**每次重送也計入每日訊息數。** |
| Upstash Redis Free | 事件租約與去重、Gemini 共用計數、對話記憶、使用者啟用狀態 | 有每日指令數與容量上限；每則訊息約使用數十個 Redis 指令。建立時選 **Free**，不要開啟 Pay as you go。 |
| LINE Push API | 背景處理完成後推送回覆（不依賴 Reply Token） | **Push 訊息會計入 LINE 官方帳號的每月訊息額度**（Reply 不計入）。免費方案的月額度有限，用完後推送會失敗。請到 LINE Official Account Manager 確認方案與剩餘額度。**這不是無限制免費推送。** |
| Gemini API Free Tier | AI 回覆 | 由本專案的共用計數再加一層上限（見下表）；Google 的實際免費額度請看 AI Studio。 |

### 5.2 一次性設定

1. **建立 QStash 佇列**：在 Upstash Console → QStash → Queues 建立名稱 `line-agent`（或你在 `QSTASH_QUEUE_NAME` 設定的名稱），**Parallelism 設為 1**。Parallelism 1 才是先進先出，同一使用者的訊息依序處理。佇列不存在時排入會失敗，Webhook 回 500。
2. 建立 Upstash Redis（Free），記下 REST URL 與 REST Token。
3. 在 Vercel **Preview**（不是 Production）設定下表變數。非同步模式的使用者啟用／停用狀態存在 Redis，**不需要** `VERCEL_ACCESS_TOKEN`。

| 變數 | 用途 |
| --- | --- |
| `LINE_ASYNC_ENABLED` | 安全開關，預設 `false`，完成驗收才在 Preview 設 `true` |
| `LINE_WORKER_ORIGIN` | Preview 的固定分支網址，例如 `https://專案-git-分支-帳號.vercel.app`（不含路徑） |
| `LINE_WORKER_SECRET` | 自己產生的高熵隨機字串（例如 `openssl rand -hex 32`） |
| `QSTASH_TOKEN` | QStash Token |
| `QSTASH_CURRENT_SIGNING_KEY`、`QSTASH_NEXT_SIGNING_KEY` | 驗證 QStash JWT 簽章與金鑰輪替 |
| `QSTASH_QUEUE_NAME` | 選填，預設 `line-agent`（只能用英數、`-`、`_`） |
| `UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN` | Redis REST 連線 |
| `GEMINI_DAILY_REQUEST_LIMIT` | 每日（台北時間）Gemini 呼叫上限，預設 8 |
| `GEMINI_MINUTE_REQUEST_LIMIT` | 每分鐘上限，預設 4，最小 2 |

### 5.3 行為（已由模擬整合測試驗證）

- **順序與不遺失**：Webhook 依 LINE 的順序逐一排入 FIFO 佇列。Worker 以 Redis 原子操作取得「事件租約」與「使用者租約」（70 秒，略長於 Vercel 55 秒上限）。同一使用者仍在處理時，下一則回 503 交給 QStash 重送，不會被丟棄或插隊。
- **去重**：以 `webhookEventId` 去重；已完成的事件再送來直接回 200，不再呼叫 Gemini 或推送。
- **中斷復原**：AI 回覆在推送前先存入 Redis。推送失敗（Worker 中斷、網路錯誤）時回 503，重送時直接推送已存的回覆，不會重新呼叫 Gemini，並沿用同一個 `X-Line-Retry-Key`。LINE 回 409（同一 retry key 已受理）視為成功。
- **Redis 故障**：取不到租約或讀寫失敗就回 503，不呼叫 Gemini、不推送；處理中途失敗會釋放租約，讓重送可以繼續。
- **用量計數**：文字、圖片、語音共用同一組每日／每分鐘計數，**每次 Gemini 請求計一次**，語音的「轉錄」與「回答」各計一次。達上限或 Gemini 回 429 時，推送「已達免費額度上限」並結束該事件，不重試、不換模型。
- **跨執行個體狀態**：對話記憶（prompt）、摘要／翻譯用的歷史、使用者啟用／停用狀態都存在 Redis（記憶與歷史保留 7 天），每次 Worker 執行時重新載入。

### 5.4 尚未驗證／已知限制

- **全部尚未實測**：上面的行為只用模擬的 LINE、QStash、Redis、Gemini 驗證過。
- **QStash**：
  - 佇列 parallelism 1 的 FIFO 行為、重送間隔、重送次數上限（目前設 `Upstash-Retries: 4`）都依官方文件設定，沒有實測。
  - 重送用完會進 DLQ（保留 3 天），需要人工處理，**不能保證零遺失**。
  - 佇列一次只處理一則，前一則重送時後面的訊息會等待；免費方案的每日訊息數也包含重送。
- **跨 Webhook 的順序**：同一批事件依序排入；LINE 若同時發出兩個不同的 Webhook 請求，兩者的排入先後無法保證。
- **重複呼叫 Gemini**：Gemini 已回覆、但回覆存入 Redis 前 Worker 就中斷時，重送會再呼叫一次 Gemini，並多計一次用量。
- **LINE Push**：
  - 月額度用完後推送會失敗，Worker 回 503 並重送到 DLQ，會額外消耗 QStash 額度。
  - 409 的處理依 LINE 文件實作，沒有實測。
- **Gemini 延遲**：語音需要兩次 Gemini 呼叫，再加上 LINE 下載、Redis 讀寫，可能接近 55 秒上限。
- **Redis 內的資料**：Redis 會存對話原文與使用者顯示名稱，請視為敏感資料。
- **Preview 登入保護**：Vercel 的 Deployment Protection 開著時，LINE 和 QStash 都無法呼叫 Preview，需要關閉或設定 Bypass。

### 5.5 驗收清單（測試 LINE Channel + Preview + Free 方案）

1. Webhook Verify 成功，且 Webhook 在 1～2 秒內回 200。
2. 錯誤簽章的請求，`/webhook` 和 `/api/worker` 都回 403。
3. 連續快速傳 3 則文字，回覆順序正確、沒有遺漏。
4. 在 QStash Console 重送同一則訊息，不會產生第二次回覆或第二次 Gemini 呼叫。
5. 文字、圖片、短語音各一次，Redis 的每日計數分別加 1、1、2。
6. 把 `GEMINI_DAILY_REQUEST_LIMIT` 設為很小的值，確認會推送「已達免費額度上限」。
7. 傳「關閉自動回覆」、重新部署後再傳訊息，機器人保持不回覆；傳「開啟自動回覆」後恢復。
8. 重新部署後追問，回覆仍記得前文。
9. 在 LINE Official Account Manager 確認 Push 訊息有計入月額度，且剩餘額度足夠。
