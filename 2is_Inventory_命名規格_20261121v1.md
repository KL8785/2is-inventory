# 庫存系統命名規格（2026-11-21 定版）

## 平台名稱

一律**英文小寫**；中文平台名保留原樣。

| 正名 | 吃掉的舊寫法 |
|---|---|
| `2is` | `DS直售`、`官網`、`官網直售`、`2is` |
| `pinkoi` | `Pinkoi`、`pin` |
| `shopee` | `Shopee`、`sh`、`蝦皮Shopee` |
| `sou` | `Sou` |
| `creema` | `Creema` |
| `books` | `Books`、`博客來` |
| `實體` | （不變） |
| `中友` | （不變） |

## 商品編號

一律**小寫**，並去掉贈品的 `g-` 前綴（`G-ssOriE` → `ssorie`）。
`ssOreeD`＝`ssOreed`＝`ssoreeD`＝`ssoreed`，全部視為同一款。

## 寫在哪裡

- 前端 `index.html` 的 `_doPersist` 上方有 `NID()`／`NPLAT()` 兩個函式，
  **所有**寫進 Supabase 的路徑（手動表單、CSV 匯入、LINE 同步）都會先過這兩個函式，
  所以大小寫不一致的資料不會再進得去。
- 商品編號輸入框（`saveProduct`）在存檔時也會自己轉小寫。
- Operating Agent（Ori）那側是 `lib/core.mjs` 的 `normPlatform()` 與 `normProductId()`，規則相同。
- 新裝時的平台預設清單（`SEED.platforms`）已換成正名後的八個。

## 2026-11-21 一次性正規化的結果

| 項目 | 前 | 後 |
|---|---|---|
| orders 的平台值 | 13 種（Shopee／sh／shopee／Pinkoi／pin…） | 5 種＋未填 25 筆 |
| products 大寫編號 | 188 款 | 0 |
| inventory 列數 | 597（15 組同款分兩列） | 581（數量相加合併） |
| costs 列數 | 592（3 組重複） | 589（定價取非 0 的較高值） |
| order_items 編號 | 130 列大寫或 `G-` 開頭 | 0 |
| 帳務「商品銷售」 | 91 列（同款被拆開） | 89 列 |

備份：`zz_Archive/2is_Inventory_dbbackup_20261121v1.json`（全表 JSON）、
`zz_Archive/index_20261121_backup.html`。

## 還沒解決的

- **25 筆訂單沒有平台值**（集中在 2026-07、08，共 $16,850），帳務表會出現「未填」欄。
- **只有 8 款有定價**（`costs.default_price > 0`）。平台信沒給單項價時，Ori 會用訂單總額分攤，
  但這只是推估；要準就得把定價補齊。
- `platform_fees` 的抽成全是 0，所以「實收」等於訂單金額。
- 三個編號在 `inventory`／`costs` 有資料但 `products` 沒有：`bx03aeo`、`bx20ag`、`bx20al`。
- `products.prices` 這個 jsonb 的 key 還混著舊的價格級距（`ds`、`official`、`event`、`wholesale`）
  與平台名，但**每一個值都是 0**，實際定價走 `costs.default_price`，所以這次沒動它。
