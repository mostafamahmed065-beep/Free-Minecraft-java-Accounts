const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.set("trust proxy", 1); // مهم خلف Render/Railway حتى يظهر IP الزائر الحقيقي
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ====== الإعدادات ======
const ADMIN_PASS = process.env.ADMIN_PASS;                  // لازم تحدده في متغيرات البيئة
const DATA_DIR = process.env.DATA_DIR || __dirname;
const FILE = path.join(DATA_DIR, "data.json");
const COOLDOWN_MS = 7 * 60 * 1000;                          // 7 دقايق لكل زائر
// =======================
if (!ADMIN_PASS) { console.error("حدد ADMIN_PASS أولاً"); process.exit(1); }

const load = () => (fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { stock: [], taken: 0 });
const save = (d) => fs.writeFileSync(FILE, JSON.stringify(d));
const safeEq = (a, b) => {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

const lastClaim = new Map();
const failed = new Map();

app.get("/api/stock", (req, res) => {
  const d = load();
  res.json({ count: d.stock.length, taken: d.taken });
});

app.post("/api/claim", (req, res) => {
  const now = Date.now();
  const last = lastClaim.get(req.ip) || 0;
  if (now - last < COOLDOWN_MS) {
    const mins = Math.ceil((COOLDOWN_MS - (now - last)) / 60000);
    return res.status(429).json({ error: `انتظر ${mins} دقيقة قبل حساب آخر` });
  }
  const d = load();
  if (!d.stock.length) return res.status(404).json({ error: "No Accounts Available" });
  const account = d.stock.shift();
  d.taken++;
  save(d);
  lastClaim.set(req.ip, now);
  res.json({ account });
});

app.use("/api/admin", (req, res, next) => {
  const f = failed.get(req.ip) || { n: 0, t: 0 };
  if (f.n >= 5 && Date.now() - f.t < 15 * 60 * 1000)
    return res.status(429).json({ error: "محاولات كثيرة، حاول لاحقاً" });
  if (!safeEq(req.get("x-admin-pass") || "", ADMIN_PASS)) {
    failed.set(req.ip, { n: f.n + 1, t: Date.now() });
    return res.status(401).json({ error: "كلمة السر خطأ" });
  }
  failed.delete(req.ip);
  next();
});

app.get("/api/admin/list", (req, res) => res.json({ accounts: load().stock }));

// يستبدل المخزون بالكامل بما في الصندوق (نفس سلوك موقعك القديم)
app.post("/api/admin/set", (req, res) => {
  const accounts = (Array.isArray(req.body.accounts) ? req.body.accounts : [])
    .map((l) => String(l).trim()).filter((l) => l.includes(":"));
  const d = load();
  d.stock = accounts;
  save(d);
  res.json({ count: accounts.length });
});

app.listen(process.env.PORT || 3000, () => console.log("Running"));
