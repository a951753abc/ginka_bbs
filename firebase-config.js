// Firebase web config。apiKey 刻意公開（Firebase 設計預期）；
// 安全邊界由 RTDB rules 與 Auth 提供，不依賴本檔保密（spec §3 V1）。
export const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  databaseURL: "https://REPLACE_ME-default-rtdb.REGION.firebasedatabase.app",
  projectId: "REPLACE_ME",
};
