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
| `GEMINI_TEMPERATURE` | 否 | 預設 `1` |
| `GEMINI_THINKING_LEVEL` | 否 | 預設不送（模型自己的預設值）；可填 `minimal`、`low` 等模型支援的值 |

請**刪除**不再使用的舊變數，避免混淆：`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_COMPLETION_MODEL`、`OPENAI_VISION_MODEL`、`OPENAI_TRANSCRIPTION_MODEL`、`OPENAI_IMAGE_GENERATION_*` 等所有 `OPENAI_` 開頭的變數。程式已不會讀取它們。

其他既有變數（`APP_*`、`BOT_*`、`VERCEL_*`、`SERPAPI_*`）維持不變。

## 3. 重新部署並測試

1. 環境變數儲存後，在 Vercel 對最新部署按 **Redeploy**（環境變數只會套用在新的部署）。
2. 在 LINE 依序測試：
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
- **逾時**：語音訊息需要呼叫 Gemini 兩次（轉錄＋回覆）。若在 Vercel 遇到逾時，可調整 `APP_API_TIMEOUT` 與 `vercel.json` 的 `maxDuration`。
