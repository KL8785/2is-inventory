#!/usr/bin/env node
// 2is 庫存系統 — 資料備份腳本（零依賴，Node 18+）
// 連 Supabase 撈全部資料表，打包成帶時間戳的 JSON 存到 backups/，並保留最近 30 份。
//
// 需要環境變數（放在同層 .env）：
//   SUPABASE_URL=https://recddupycszbcszfidjx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=（Supabase 後台 Settings → API → service_role 金鑰）
//
// 手動執行： node backup.js

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// 讀 .env（簡易解析）
function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(join(HERE, ".env"), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* 沒有 .env 就用系統環境變數 */ }
  return env;
}

const env = loadEnv();
const URL = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("✗ 缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY，請在 .env 設定。");
  process.exit(1);
}

const TABLES = [
  "products", "inventory", "orders", "order_items", "restocks", "returns",
  "purchase_orders", "costs", "platforms", "platform_fees", "listings",
  "shipping_methods", "packaging_defaults", "finance_expenses", "app_settings",
];

const KEEP = 30; // 保留最近幾份

async function fetchAll(table) {
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const to = from + page - 1;
    const res = await fetch(`${URL}/rest/v1/${table}?select=*`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Range: `${from}-${to}` },
    });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`);
    const chunk = await res.json();
    rows.push(...chunk);
    if (chunk.length < page) break;
  }
  return rows;
}

async function main() {
  const tables = {};
  let total = 0;
  for (const t of TABLES) {
    const rows = await fetchAll(t);
    tables[t] = rows;
    total += rows.length;
    console.log(`  ${t}: ${rows.length}`);
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const out = { meta: { savedAt: now.toISOString(), source: URL, rows: total }, tables };

  // 備份存放於程式資料夾的上一層 backups/（2is_InventorySystem/backups）
  const dir = join(HERE, "..", "backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `2is_inventory_backup_${stamp}.json`);
  writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`✓ 已備份 ${total} 筆 → ${file}`);

  // 保留最近 KEEP 份，其餘刪除
  const files = readdirSync(dir).filter((f) => /^2is_inventory_backup_.*\.json$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) {
    unlinkSync(join(dir, f));
    console.log(`  清除舊備份：${f}`);
  }
}

main().catch((e) => { console.error("✗ 備份失敗：", e.message); process.exit(1); });
