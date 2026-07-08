// 2is 庫存系統 — LINE 建單 Webhook
// 你在 LINE 一對一貼「出貨訊息」給 bot → 解析 → 建單（狀態=待出貨）、扣庫存 → 回覆確認。
// 貼「退貨訊息」（以「退貨」開頭）→ 寫入退貨記錄並調整庫存 → 回覆確認。
//
// 出貨訊息格式（大小寫、全半形空白皆容錯；中繼欄可省略）：
//   出貨
//   平台 蝦皮Shopee
//   日期 2026-07-05
//   單號 24070500123
//   運送 黑貓宅急便
//   opk1051c01 x2
//   tb30ay 1 350
//   備註 客人指定禮盒
//
// 退貨訊息格式（第一行必須是「退貨」）：
//   退貨
//   平台 蝦皮Shopee
//   日期 2026-07-05
//   類型 良品          ← 或「類型 NG」，省略預設良品
//   原因 尺寸不符       ← 選填
//   opk1051c01 x2      ← 商品行「編號 x數量 [退款金額]」
//
// 商品行：<商品編號> [x]<數量> [單價/退款金額]；單價省略時用「商品成本設定」的預設售價。
// 需設定的環境變數（Supabase → Edge Functions → Secrets）：
//   LINE_CHANNEL_ACCESS_TOKEN、LINE_CHANNEL_SECRET
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由平台自動注入。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
const CHANNEL_SECRET = Deno.env.get("LINE_CHANNEL_SECRET") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const sb = createClient(SB_URL, SB_KEY);

// ── 驗證 LINE 簽章 ──
async function verifySignature(body: string, signature: string): Promise<boolean> {
  if (!CHANNEL_SECRET || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(CHANNEL_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return b64 === signature;
}

// ── LINE 回覆 ──
async function reply(replyToken: string, text: string) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ACCESS_TOKEN}` },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
}

const norm = (s: string) => s.replace(/　/g, " ").trim(); // 全形空白 → 半形

// ── 解析訊息 ──
function parseOrder(raw: string) {
  const allLines = raw.split(/\r?\n/).map(norm).filter((l) => l);
  const mode: "order" | "return" = /^退貨$/.test(allLines[0] ?? "") ? "return" : "order";
  const lines = allLines.filter((l) => !/^(出貨|建單|下單|退貨)$/.test(l));
  const meta: Record<string, string> = {};
  const items: { id: string; qty: number; price?: number }[] = [];
  const metaKeys: Record<string, string> = {
    "平台": "platform", "日期": "date", "單號": "orderId", "訂單編號": "orderId",
    "運送": "shipping", "運送方式": "shipping", "備註": "notes",
    "類型": "condition", "退貨類型": "condition", "原因": "reason", "退貨原因": "reason",
  };
  for (const line of lines) {
    const mMeta = line.match(/^(\S+)\s+(.+)$/);
    if (mMeta && metaKeys[mMeta[1]]) { meta[metaKeys[mMeta[1]]] = mMeta[2].trim(); continue; }
    // 商品行： 編號 [x]數量 [單價]
    const m = line.match(/^([A-Za-z0-9_\-]+)\s*[x×*]?\s*(\d+)\s*(\d+)?$/i);
    if (m) { items.push({ id: m[1], qty: parseInt(m[2], 10), price: m[3] ? parseInt(m[3], 10) : undefined }); }
  }
  return { mode, meta, items };
}

async function handleText(text: string): Promise<string> {
  const { mode, meta, items } = parseOrder(text);
  if (!items.length) {
    return mode === "return"
      ? "⚠ 沒讀到商品。退貨格式範例：\n退貨\n平台 蝦皮Shopee\n類型 良品\n原因 尺寸不符\nopk1051c01 x2"
      : "⚠ 沒讀到商品。格式範例：\n出貨\n平台 蝦皮Shopee\nopk1051c01 x2\ntb30ay 1 350";
  }
  const platform = meta.platform || "其他";
  const date = meta.date || new Date().toISOString().slice(0, 10);

  // 撈商品（全量，不分大小寫比對）+ 平台費用
  const [{ data: allProds }, { data: fees }] = await Promise.all([
    sb.from("products").select("id,name"),
    sb.from("platform_fees").select("*").eq("platform", platform).maybeSingle(),
  ]);
  const prodMap = new Map((allProds ?? []).map((p) => [p.id.toLowerCase(), p]));

  const notFound = items.filter((i) => !prodMap.has(i.id.toLowerCase()));
  if (notFound.length) {
    return `⚠ 查無商品編號：${notFound.map((i) => i.id).join("、")}\n請確認編號後重貼。`;
  }

  // 用真正的商品編號撈成本、庫存
  const realIds = items.map((i) => prodMap.get(i.id.toLowerCase())!.id);
  const [{ data: costs }, { data: invs }] = await Promise.all([
    sb.from("costs").select("product_id,default_price").in("product_id", realIds),
    sb.from("inventory").select("*").in("product_id", realIds),
  ]);
  const costMap = new Map((costs ?? []).map((c) => [c.product_id.toLowerCase(), c.default_price]));
  const invMap = new Map((invs ?? []).map((v) => [v.product_id.toLowerCase(), v]));

  // ── 退貨流程 ──
  if (mode === "return") {
    const condition = /ng/i.test(meta.condition ?? "") ? "ng" : "good";
    const retItems = items.map((i) => {
      const p = prodMap.get(i.id.toLowerCase())!;
      const unit = i.price ?? (costMap.get(i.id.toLowerCase()) ?? 0);
      return { productId: p.id, productName: p.name, qty: i.qty, refund: Math.round(i.qty * unit) };
    });
    const totalQty = retItems.reduce((s, it) => s + it.qty, 0);
    const refundAmount = retItems.reduce((s, it) => s + it.refund, 0);
    const retId = `LINE-RT-${Date.now()}`;
    const { error: eR } = await sb.from("returns").insert({
      id: retId, date, platform, order_id: null,
      product_id: retItems[0].productId, product_name: retItems[0].productName,
      qty: totalQty, condition, refund_amount: refundAmount,
      reason: meta.reason ?? null, notes: meta.notes ?? null, packaging: [],
      items: retItems.map(({ productId, productName, qty }) => ({ productId, productName, qty })),
    });
    if (eR) return `⚠ 退貨寫入失敗：${eR.message}`;

    // 調整庫存：良品回補可出貨、NG 加入 NG 數（與前端邏輯一致）
    for (const it of retItems) {
      const inv = invMap.get(it.productId.toLowerCase());
      if (inv) {
        const patch = condition === "good"
          ? { in_stock: (inv.in_stock ?? 0) + it.qty }
          : { ng: (inv.ng ?? 0) + it.qty };
        await sb.from("inventory").update({ ...patch, updated_at: new Date().toISOString() })
          .eq("product_id", it.productId);
      }
    }

    const retLines = retItems.map((it) => `・${it.productName} ×${it.qty}`).join("\n");
    const condTxt = condition === "good" ? "良品（已回補可出貨庫存）" : "NG品（已加入NG數）";
    return `↩️ 已記錄退貨\n平台：${platform}\n日期：${date}\n${retLines}\n類型：${condTxt}\n退款：$${refundAmount}`;
  }

  // 組明細
  const orderItems = items.map((i) => {
    const p = prodMap.get(i.id.toLowerCase())!;
    const unit = i.price ?? (costMap.get(i.id.toLowerCase()) ?? 0);
    const subtotal = Math.round(i.qty * unit);
    return { product_id: p.id, product_name: p.name, qty: i.qty, unit_price: unit, discount: 100, subtotal };
  });
  const subtotal = orderItems.reduce((s, it) => s + it.subtotal, 0);
  const totalQty = orderItems.reduce((s, it) => s + it.qty, 0);
  const commRate = fees?.comm ?? 0;
  const commAmt = Math.round(subtotal * commRate / 100);
  const serviceFee = fees?.fixed ?? 0;
  const shippingFee = fees?.shipping ?? 0;
  const netRevenue = subtotal - commAmt - serviceFee - shippingFee;

  const orderId = `LINE-${Date.now()}`;
  const { error: e1 } = await sb.from("orders").insert({
    id: orderId, date, order_id: meta.orderId ?? null, platform, qty: totalQty,
    subtotal, commission_rate: commRate, commission_amt: commAmt, service_fee: serviceFee,
    shipping_fee: shippingFee, net_revenue: netRevenue, shipping_method: meta.shipping ?? null,
    notes: meta.notes ?? null, packaging: [], source: "LINE", status: "pending",
  });
  if (e1) return `⚠ 建單失敗：${e1.message}`;
  const { error: e2 } = await sb.from("order_items").insert(orderItems.map((it) => ({ order_id: orderId, ...it })));
  if (e2) return `⚠ 明細寫入失敗：${e2.message}`;

  // 扣庫存
  for (const it of orderItems) {
    const inv = invMap.get(it.product_id.toLowerCase());
    if (inv) {
      await sb.from("inventory").update({
        in_stock: (inv.in_stock ?? 0) - it.qty,
        total_out: (inv.total_out ?? 0) + it.qty,
        updated_at: new Date().toISOString(),
      }).eq("product_id", it.product_id);
    }
  }

  const lines = orderItems.map((it) => `・${it.product_name} ×${it.qty} = $${it.subtotal}`).join("\n");
  return `✅ 已建立出貨單（⏳ 待出貨）\n平台：${platform}\n日期：${date}\n${lines}\n小計：$${subtotal}\n實收：$${netRevenue}`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  const body = await req.text();
  const sig = req.headers.get("x-line-signature") ?? "";
  if (!(await verifySignature(body, sig))) {
    return new Response("bad signature", { status: 401 });
  }
  let payload: any;
  try { payload = JSON.parse(body); } catch { return new Response("bad json", { status: 400 }); }

  for (const ev of payload.events ?? []) {
    if (ev.type === "message" && ev.message?.type === "text" && ev.replyToken) {
      try {
        const msg = await handleText(ev.message.text ?? "");
        await reply(ev.replyToken, msg);
      } catch (err) {
        await reply(ev.replyToken, `⚠ 系統錯誤：${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return new Response("ok", { status: 200 });
});
