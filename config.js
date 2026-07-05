// 2is 庫存系統 — Supabase 連線設定
// publishable key 為公開安全金鑰，資料存取由資料庫 RLS + 登入把關
const SUPABASE_URL = 'https://recddupycszbcszfidjx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YAIje-KigZqw-QKOBjWW8g_pqfKIyLf';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
