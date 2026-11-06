// 雲端同步設定（選填）
// 也可以不改這個檔案，直接在 App 的「設定 → 雲端同步」貼上這兩個值。
// anon key 是公開金鑰，可以放在網頁裡；資料安全由 supabase.sql 裡的權限規則保護。
window.JZ_CONFIG = {
  supabaseUrl: 'https://sacpahvcqvdrkwqxfkso.supabase.co',
  // 每日記帳提醒用的推播公鑰（見 README「每日提醒」）；沒填就不會顯示開啟提醒的按鈕
  vapidPublicKey: '',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhY3BhaHZjcXZkcmt3cXhma3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM3MzU1MjUsImV4cCI6MjEwOTMxMTUyNX0.orejUdjP6LNsJD2By7QtIY7HJk_bjIQV3nxRx1kq1fw',
};
