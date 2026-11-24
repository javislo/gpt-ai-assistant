# Mac 自架 n8n Community Edition（私人 LINE Gemini Agent）

## 目前狀態

- 已有 LINE ↔ Gemini 雙向對話（原 PR #2 Preview），**不要修改該 Webhook URL**。
- [PR #3](https://github.com/javislo/gpt-ai-assistant/pull/3) 提供單一收件者的 LINE Push API `/api/notify`，以及 [08:00 早報](../workflows/n8n-private-morning.json)、[21:00 回顧](../workflows/n8n-private-evening.json) 的 n8n JSON。
- **通知預設關閉**（`AGENT_NOTIFICATIONS_ENABLED=false`）；`LINE_ASYNC_ENABLED=false`，此方案不需要 QStash/Redis。
- 排程器從 n8n Cloud 改成在 Mac 本機長時間執行的 n8n Community Edition；不必公開 Mac、不必另設網域。

## 1. Mac Docker Desktop 安裝

先確認 Docker Desktop 已啟動。在 Mac 終端機執行：

```bash
docker version
docker compose version
docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

如果已存在另一個 n8n 容器，請先檢查既有容器與資料卷，**不要直接刪除**。

從 [GitHub 下載 Compose 原始檔](../ops/n8n-mac/compose.yaml)，存放至 `~/private-line-n8n/compose.yaml`。建議終端機指令：

```bash
mkdir -p ~/private-line-n8n
cd ~/private-line-n8n
# 從 GitHub PR #3 的 ops/n8n-mac/compose.yaml 下載並存成此目錄的 compose.yaml。
docker volume create n8n_data
docker compose up -d
docker compose ps
docker compose logs --tail=60 n8n
```

開啟 `http://localhost:5678` 完成帳號初始化。`127.0.0.1:5678:5678` 限本機使用，請勿改成 `0.0.0.0`。日後可使用 `docker compose up -d`、`docker compose restart` 與 `docker compose logs -f --tail=50 n8n` 管理。

Mac 睡眠、關機、Docker Desktop 停止或網路斷線時，排程可能不會執行；可在 macOS 電源管理中配置長時間運作並確認 Docker Desktop 開機啟動。

## 2. 匯入流程（勿先發布）

在 n8n 畫面依序建立兩個 workflow，右上 `...` → `Import from File`：

- `workflows/n8n-private-morning.json`：每日 **08:00**，`Open-Meteo` 台北市中心天氣、日期與未接入的行程／待辦說明
- `workflows/n8n-private-evening.json`：每日 **21:00**，三個固定回顧問題

匯入後先保持 **未發布／未啟用**。確認 Workflow Settings → Timezone 為 `Asia/Taipei`，若新版畫面採 Publish 才啟動排程，**手動測試通過前不要點 Publish**。

## 3. Vercel PR #3 Private Push 設定

Vercel → gpt-ai-assistant → Settings → Environment Variables，**只設定** `feat/private-line-notifications` 分支 Preview：

| Key | 要求 |
| --- | --- |
| `AGENT_NOTIFICATIONS_ENABLED` | 原有 `false`，手動驗證前才改 `true` |
| `AGENT_NOTIFY_SECRET` | 自行以密碼管理工具產生高熵隨機字串，至少 32 字元，型別 Sensitive |
| `LINE_PUSH_USER_ID` | 這個測試 LINE Channel 所屬 Provider 底下你**自己的**使用者 ID；`U` 加 32 個十六進位字元，型別 Sensitive |
| `LINE_CHANNEL_ACCESS_TOKEN` | 已有 Preview Sensitive；應與該 LINE Channel 相同 |
| `LINE_ASYNC_ENABLED` | 保持 `false` |

不要把任何密鑰、完整 User ID 貼在 GitHub、workflow JSON 或聊天訊息中。完成變數後需重新部署功能分支 Preview，新的部署才會載入值。不能使用 LINE ID、Channel ID 或其他 Provider 的 User ID 代替 `LINE_PUSH_USER_ID`。

## 4. n8n 加密的 Custom Auth（兩個 HTTP Headers）

Vercel Project → Deployment Protection → `Protection Bypass for Automation`，已建立 `n8n-cloud-pr3`。雖然標籤名稱含 Cloud，但可供本機 n8n 使用；也可另行命名。若密鑰遺失，請從 Vercel 重新建立並撤銷失效憑證，不要為了 n8n 公開 Preview 分支。

兩個 workflow 的 `LINE 私人 Push` 節點：
`Authentication: Generic Credential Type` → `Generic Auth Type: Custom Auth` → 建立**同一個** Custom Auth Credential，JSON：

```json
{
  "headers": {
    "Authorization": "Bearer <AGENT_NOTIFY_SECRET>",
    "x-vercel-protection-bypass": "<VERCEL_AUTOMATION_BYPASS_SECRET>"
  }
}
```

請只在 n8n **Credential 編輯器**內替換成真實值並儲存；不需將密鑰貼進節點參數。第二個 Header 會繞過整個 Vercel Project 的部署保護，務必嚴格保管。

`LINE 私人 Push` 的 URL 固定為：

```text
https://gpt-ai-assistant-git-feat-private-line-notifications-javis-8772.vercel.app/api/notify
```

## 5. 逐步驗收及啟用排程

1. 保持 `AGENT_NOTIFICATIONS_ENABLED=false`，先確認不會推播。此時 `POST /api/notify` 預期回 `404`。
2. 在 Vercel Preview 功能分支設好 `AGENT_NOTIFY_SECRET`、`LINE_PUSH_USER_ID`，核對收件者後才將 `AGENT_NOTIFICATIONS_ENABLED=true`；重新部署 **PR #3 分支**。原來 PR #2 對話分支與 Production 保持不變。
3. 在 n8n 先只選 08:00 早報的 **Manual Trigger** 手動測試**一則**。成功回應 `200 { "ok": true }`，且自己 LINE 真的收到，再驗收 21:00 回顧。
4. 若遇到 `401/302`，檢查 Vercel `x-vercel-protection-bypass`；`403` 檢查私人 `Authorization`；`503` 檢查 LINE API／收件者與 Vercel Logs；`429` 檢查 LINE Push 免費訊息配額。此判斷只是常見方向，仍須查看執行紀錄確認。
5. 確認 Cron 和時區後，再 Publish／啟用兩個 Schedule Trigger：早報 08:00、晚間 21:00。額外測試／重試要注意 LINE 月度免費訊息額度。

**注意：** 目前早報尚未接上個人行事曆、待辦資料，也不含每日 Gemini 自動摘要，不能聲稱這些已完成。每日兩個工作流程若無重試與手動執行，合計每月約 60–62 次 LINE Push。請先確認 LINE 方案有足夠可用訊息。

## 6. 資料備份與維護

`n8n_data` Docker Volume 內含 SQLite、Workflow、Credential 的**加密資料**與加密金鑰。容器重啟資料會保留，但更換 Mac、Docker 重置、或 Volume 遺失仍需要備份。

手動備份建議**先停止 n8n**，確保 SQLite 一致性，然後複製整個 Volume（以下指令在 compose.yaml 所在目錄執行）：

```bash
mkdir -p backups
docker compose stop n8n
docker run --rm -v n8n_data:/data:ro -v "$PWD/backups:/backup" alpine \
  sh -c 'cd /data && tar czf /backup/n8n-data-backup.tar.gz .'
docker compose up -d
```

備份檔案含密鑰和私密資料，請在本機安全加密保存；**不要**上傳公開 GitHub。更新 n8n 映像前先備份；不要在需要復原時只備份 workflow JSON 而遺失憑證金鑰。

## 7. 本機排程的界線

使用這個方案不需要對外暴露 Mac，因為 n8n 只主動向 Vercel 發送 HTTPS 請求。如果後續想從外部網路直接觸發 n8n 的 Webhook 才需額外設計通道與驗證，不應直接開放 Mac 的 5678 port。
