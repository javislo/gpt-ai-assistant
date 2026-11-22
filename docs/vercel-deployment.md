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
