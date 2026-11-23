# 私人 LINE 主動通知（Preview 測試版）

> 狀態：程式與測試建置中，**預設停用**。未連線的排程器、尚未核對的用戶 ID 與公開密鑰都不應投入正式使用。

## 目標與目前邊界

這個版本加入一個受保護的 `POST /api/notify` 入口，供 n8n 排程在指定時間透過 LINE Push API 對**唯一指定的本人 LINE 使用者 ID**發訊息。API 不接受 caller 指定收件者、不接受群組推播、不用 Gemini 自動編造個人行程，亦不抓取郵件或行事曆。每日早報與待辦「資料來源」仍需在 n8n 另行連接並設定。

此功能與既有 `/webhook` 的 Gemini 雙向對話分開。**不需**啟用 QStash/Redis，也**不應**把 `LINE_ASYNC_ENABLED` 改成 `true`。

## 1. Preview-only 環境變數

在 Vercel 專案環境變數新增，**只限測試 Preview 分支**：

| Key | 必須 | 值 / 注意事項 |
| --- | --- | --- |
| `AGENT_NOTIFICATIONS_ENABLED` | 是 | 初始設 `false`，驗收準備好後才改 `true` |
| `AGENT_NOTIFY_SECRET` | 是 | 隨機至少 32 字元，Vercel 設 Secret；例如用本機 `openssl rand -hex 32` 產生 |
| `LINE_PUSH_USER_ID` | 是 | **你自己的** LINE Messaging API userId，格式 `U` 加 32 個十六進位字元 |
| `LINE_CHANNEL_ACCESS_TOKEN` | 已有 | 必須與該 LINE 用戶互動的測試 Channel 相同 |
| `LINE_ASYNC_ENABLED` | 已有 | 保持 `false` |

`LINE_PUSH_USER_ID` 為個資，請直接在 Vercel Secret 中填寫，不要貼到 GitHub、聊天或 n8n workflow JSON。取得方式：LINE Developers 控制台可能提供「Your user ID」；請務必確認它與這個 Messaging API Channel **同一個 Provider**，否則需要從你對測試 Bot 送出的、經簽章驗證的 LINE event 取得 userId。不要使用 Channel ID 或 LINE ID（@開頭）取代。

## 2. 驗證路徑

預期網址：`https://<Preview 專用分支網域>/api/notify`。請先核對該分支的部署保護例外是否允許 n8n 存取；原本 PR #2 分支網址的例外**不會自動套用**到新功能分支。

要求：
- `POST` 與 `Content-Type: application/json`
- `Authorization: Bearer <AGENT_NOTIFY_SECRET>`（置於 n8n **Header Auth Credentials**，不寫在 workflow JSON）
- 本體範例：

```json
{
  "id": "morning-2026-11-24",
  "text": "☀️ 早安！這是私人 LINE Agent 的測試通知。"
}
```

成功回 `200 {"ok":true}`。停用回 `404`；未配置回 `503`；權杖不正確回 `403`；資料格式不符回 `400`。所有失敗預設**不**透露收件者或訊息原文。

`id` 是該次通知的**唯一、穩定識別碼**，例如 `morning-YYYY-MM-DD`。同一個 `id` 只能對應相同內容；傳送失敗重試時必須使用原 `id`，LINE Push API 的 `X-Line-Retry-Key` 可避免 LINE 已受理的相同通知重複送出。它是傳送重試鍵，不是持久化的排程鎖；同 ID 也不保證永久唯一，且不阻止 n8n 不同 ID 造成的重複通知。

## 3. n8n 手動建置工作流程（測試版）

在你的 n8n（自架或雲端）建立 **Schedule Trigger → Set/Edit Fields → HTTP Request**：

1. Workflow Settings 中將時區設為 `Asia/Taipei`，並確認執行個體的時區也正確。
2. Schedule Trigger 設每天 08:00；測試時先使用 Manual Trigger。
3. Edit Fields 準備 `id`、`text`，例如 `morning-{{ $now.toFormat('yyyy-LL-dd') }}` 與固定的測試句。
4. HTTP Request：POST 至上述分支網域的 `/api/notify`；傳送 JSON Body。
5. HTTP Request Authentication：使用 **Generic Credential Type → Header Auth**，Header Name = `Authorization`、Value = `Bearer <AGENT_NOTIFY_SECRET>`，只儲存在 n8n credentials。
6. 先使用 Manual Execute 測試並檢查 HTTP 200；**不要**在驗收完成前啟用工作流程。
7. 驗收後新增晚間 21:00 的獨立 workflow（例如 `evening-YYYY-MM-DD`），並設勿擾時段及每日通知上限，避免重複排程。

早報的天氣、行事曆、待辦資料，應在 n8n 另接可靠資料來源，拿到資料才組出 `text`。若資料缺失，寫「尚無資料」，不要假裝有個人紀錄。請注意 LINE 官方帳號月度 Push 訊息配額，免費方案不是無限制。

## 4. 安全與驗收

- 僅對自己固定 userId 發送，不能由呼叫者覆寫。
- API 預設 404；長密鑰 403；無資料則不發送。
- 對同一 `id` 重試時，Push API 使用固定 X-Line-Retry-Key。
- LINE Access Token、通知密鑰及 userId 都不提交至 GitHub。
- 首次手動測試成功後才開啟排程；運作期間應觀察 LINE 剩餘免費訊息額度與 Vercel 日誌。
- 本功能目前不具備真正持久化待辦、每日完整 AI 總結或跨服務整合；這些是後續模組。
