// Firebase web config。apiKey 刻意公開（Firebase 設計預期）；
// 安全邊界由 RTDB rules 與 Auth 提供，不依賴本檔保密（spec §3 V1）。
export const firebaseConfig = {
  apiKey: "AIzaSyDW8iP5z1o3MK9by_cxf3AUQ65wdHj7AA0",
  authDomain: "ginkabbs.firebaseapp.com",
  databaseURL: "https://ginkabbs-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ginkabbs",
  storageBucket: "ginkabbs.firebasestorage.app",
  messagingSenderId: "171795482590",
  appId: "1:171795482590:web:f173cf3a2fc76abde2ff4f",
  measurementId: "G-0229TX2BKV",
};
