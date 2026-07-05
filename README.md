# 2is 庫存管理系統 v2

單機版（localStorage）重製為 **前端 + 雲端資料庫** 架構：

- **前端程式**：純 HTML/JS 單頁（`index.html` + `config.js`）→ GitHub + Netlify
- **資料庫**：Supabase（PostgreSQL），14 張表
- **LINE 建單**：Supabase Edge Function（`supabase/functions/line-webhook`）
- **匯出**：完整庫存記錄 Excel（含成本、售價、毛利率、庫存成本總值）

舊版單機檔仍保留於 Google Drive `2is_System/庫存系統/2is_System_inventory_20260614v1.html`。

---

## 架構

```
瀏覽器 (Netlify 靜態站) ──supabase-js──▶ Supabase Postgres ◀──service role── LINE Webhook (Edge Function)
        登入 (Supabase Auth)                RLS: 僅登入者可讀寫              你貼訂單給 LINE bot → 自動建單
```

- 前端用 `sb_publishable_...` 公開金鑰連線，資料存取由 **RLS + 登入** 把關。
- Edge Function 用 service role 金鑰（平台自動注入）繞過 RLS 寫入。

## 檔案

| 檔案 | 說明 |
|---|---|
| `index.html` | 主程式（8 分頁：儀表板／出貨／進貨／庫存／上下架／成本／設定／損益） |
| `config.js` | Supabase 連線設定（URL + publishable key，公開安全） |
| `netlify.toml` | Netlify 發布設定 |
| `supabase/functions/line-webhook/index.ts` | LINE 建單 webhook |

## Supabase 專案

- 專案：`2is-inventory`（Ref `recddupycszbcszfidjx`，區域 ap-northeast-1 東京）
- 資料表：products, inventory, orders, order_items, restocks, returns, purchase_orders, costs, platforms, platform_fees, listings, shipping_methods, packaging_defaults, finance_expenses, app_settings

## LINE 建單訊息格式

在 LINE 一對一貼給 bot（中繼欄可省略）：

```
出貨
平台 蝦皮Shopee
日期 2026-07-05
單號 24070500123
運送 黑貓宅急便
opk1051c01 x2
tb30ay 1 350
備註 客人指定禮盒
```

- 商品行：`<商品編號> [x]<數量> [單價]`；單價省略時用「商品成本設定」的預設售價。
- 建單後 bot 回覆確認（平台、日期、明細、小計、實收），並自動扣庫存。

## 設定步驟

見對話中的分步引導，或：
1. GitHub 建 repo → 推送此資料夾
2. Netlify 連 GitHub repo → 自動部署
3. Supabase 後台建登入帳號（Authentication → Add user）
4. LINE Developers 建 Messaging API channel → 設 webhook URL：
   `https://recddupycszbcszfidjx.supabase.co/functions/v1/line-webhook`
5. Supabase Edge Functions Secrets 設 `LINE_CHANNEL_ACCESS_TOKEN`、`LINE_CHANNEL_SECRET`
