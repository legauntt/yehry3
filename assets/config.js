// Public configuration only. Passwords and signing keys belong in chairlift.
export const API_BASE = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? "http://127.0.0.1:3000/yehry3"
  : "https://chairlift.fly.dev/yehry3";
