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

> 本階段僅提交程式與模擬測試，尚未設定第三方帳號，也沒有在 Vercel 部署或呼叫真實 Gemini。**在完全配置及驗收前維持 `LINE_ASYNC_ENABLED=false`。**

此模式適用於私人 LINE 一對一訊息，支援文字、圖片與語音；群組及其他事件不會排入工作佇列。架構：

`LINE（驗證 HMAC 簽章） → Vercel Webhook（QStash 成功排入後即回 200） → Upstash QStash → 簽章驗證 Worker → Upstash Redis 事件租約與記憶 → Gemini → LINE Push API`

**新增免費服務（需自己手動申請）**：
- Upstash QStash Free：持久化排程與失敗重送、10 分鐘發布去重。免費層目前有每日訊息限制（請以官網為準）。
- Upstash Redis Free：透過 HTTPS REST 存事件處理狀態、共用用量計數與對話記憶。請確保資料庫和 QStash 都選 **Free**，不要啟用付費用量方案。
- LINE Push API：因背景處理可能超過 Reply Token 的時效，不再依賴 Reply Token；Push 訊息可能計入 LINE 官方帳號月傳送額度，須自行核對剩餘額度與免費方案規則。**這個方案不是無限制免費推送。**

在 Vercel Preview（不是 Production）設定：

| 新變數 | 用途 |
| --- | --- |
| `LINE_ASYNC_ENABLED` | 安全開關，預設 `false`，所有項目就緒後才設 `true` |
| `LINE_WORKER_ORIGIN` | 本次 Vercel Preview 的 HTTPS 根網址，例如 `https://your-preview.vercel.app`（不含尾端路徑） |
| `LINE_WORKER_SECRET` | 獨立的高熵隨機密碼，只在服務端環境變數儲存 |
| `QSTASH_TOKEN` | QStash 專屬 Token |
| `QSTASH_CURRENT_SIGNING_KEY` | 用於驗證 Upstash-Signature JWT |
| `QSTASH_NEXT_SIGNING_KEY` | 用於簽章輪替 |
| `UPSTASH_REDIS_REST_URL` | Redis REST HTTPS URL |
| `UPSTASH_REDIS_REST_TOKEN` | Redis REST Token |
| `GEMINI_DAILY_REQUEST_LIMIT` | 台北日期每日呼叫限制，預設 8（**每次模型請求計一次**） |
| `GEMINI_MINUTE_REQUEST_LIMIT` | 每分鐘請求上限，預設 4（音訊轉錄＋回答共需兩次） |

新模式裡的 LINE webhook 原路徑保持不變，Worker 路徑是 `/api/worker`，所有事件均在 QStash 持久化後才回覆 LINE 成功；若排入失敗則回 500，讓 LINE 在開啟重送功能時有機會重送。工作者驗證轉送的 Worker Secret **及** QStash 的原始請求 HMAC/JWT 簽章、目標 URL、有效期限和 body 雜湊。請勿讓 Worker Secret、Gemini Key 或 Token 出現在 GitHub commit 或回應日誌。

**持久化與重複處理：**
- 事件和使用者鎖以 Redis Lua 原子操作取得，並以 `webhookEventId` 去重；完成狀態與 AI 回覆保留 7 天。
- 已完成的 AI 回覆在推送前保存，重送工作者可使用相同 `X-Line-Retry-Key` 重新發送，不會重新產生回覆。若因回應遺失、鎖逾期或平台中斷，仍可能進入死信佇列，需要人工檢查。
- 記憶儲存在 Redis 7 天，讓同一使用者跨 Vercel 執行個體能載入先前訊息；這不是永久記憶，且 Redis 儲存原文及對話內容，應視為敏感資料。
- 所有 Gemini 原生 `generateContent` 呼叫均透過 Redis 原子共用日／分鐘計數器；**嘗試呼叫也計數**，避免免費配額耗盡仍自動重試。若 Redis 不可用即停止呼叫。這是本專案保護上限，不代表 Google 官方的真實配額。

**目前限制及驗收門檻：**
- 只在 `LINE_ASYNC_ENABLED=true` 的工作者路徑強制共用配額；舊同步模式不適用此共享額度保護。
- 長時間並行操作會遇到使用者租約衝突，交由 QStash 重試；超過重試上限時要到 QStash DLQ 檢查，**不能保證零訊息遺失**。
- Vercel 函式上限為 55 秒；若 Gemini 或外部服務逾時，QStash 可能重送，必須在 Preview 確認沒有多次模型呼叫。
- 開啟此模式前，必須先在隔離測試 LINE Channel、Preview、Redis/QStash Free 環境驗證：Webhook 2xx 延遲、簽章拒絕、同一 `webhookEventId` 重送、Redis 故障、429、跨實例對話、短語音和 LINE Push 額度。
- 沒有正式 API Key、QStash 或 Redis 憑證便無法驗證真實端到端行為；此階段不應合併到 `main` 或啟用正式環境。
