require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { uploadToDrive, deleteFromDrive } = require("./googleDriveUploader");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "gizliAnahtar123";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 10);
    const ext = path.extname(file.originalname);
    cb(null, `${timestamp}-${randomId}${ext}`);
  },
});
const upload = multer({ storage });
app.use("/uploads", express.static(uploadDir));

// 🔒 JWT middleware
function authMiddleware(req, res, next) {
  const token = req.cookies.admin_token;
  if (!token) return res.status(403).send("⛔ Giriş gerekli");
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role === "admin") return next();
    return res.status(403).send("⛔ Yetkisiz");
  } catch {
    return res.status(403).send("⛔ Token geçersiz");
  }
}

// 🔐 Admin login
app.post("/admin-login", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "1h" });
    res.cookie("admin_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
    });
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: "Hatalı şifre" });
  }
});

app.post("/admin-logout", (req, res) => {
  res.clearCookie("admin_token");
  res.json({ success: true });
});

// 🧾 Shopier ödeme formu oluşturma
app.post("/shopier-odeme", (req, res) => {
  try {
    const { fullname, email, price } = req.body;
    const apiKey = process.env.SHOPIER_API_KEY;
    const secretKey = process.env.SHOPIER_SECRET_KEY;
    const random_id = Date.now().toString();

    const data = {
      API_key: apiKey,
      website_index: "1",
      product_name: "Geleceğe Mesaj Videosu",
      buyer_name: fullname,
      buyer_surname: "Soyisim",
      buyer_email: email,
      buyer_address: "Adres Yok",
      buyer_phone: "05555555555",
      order_price: price,
      currency: "TL",
      platform_order_id: random_id,
      success_url: "http://localhost:3000/odeme-basarili.html",
      failure_url: "http://localhost:3000/odeme-hata.html"
    };

    const ordered = Object.entries(data).sort();
    const signatureStr = ordered.map(([key, val]) => `${key}=${val}`).join("&") + secretKey;
    const signature = crypto.createHash("sha256").update(signatureStr).digest("hex");

    console.log("Shopier data:", data);
    console.log("İmza stringi:", signatureStr);
    console.log("İmza:", signature);

    const formHTML = `
      <form action="https://www.shopier.com/ShowProduct/api_pay4.php" method="post" id="shopierForm">
        ${Object.entries(data)
          .map(([key, val]) => `<input type="hidden" name="${key}" value="${val}">`)
          .join("\n")}
        <input type="hidden" name="signature" value="${signature}">
      </form>
      <script>document.getElementById("shopierForm").submit();</script>
    `;
    res.send(formHTML);
  } catch (err) {
    console.error("❌ Shopier ödeme hatası:", err);
    res.status(500).send("Internal Server Error");
  }
});

// 🎥 Video yükleme
app.post("/submit", upload.single("video"), async (req, res) => {
  const video = req.file;
  const { fullname, email } = req.body;
  if (!video || !fullname || !email) {
    return res.status(400).json({ success: false, error: "Eksik bilgi veya video." });
  }

  try {
    const driveLink = await uploadToDrive(video.path, video.originalname, fullname, email);
    fs.unlink(video.path, () => {});
    const sizeMB = video.size / (1024 * 1024);
    const price = sizeMB <= 5 ? 0 :
                  sizeMB <= 20 ? 10 :
                  sizeMB <= 50 ? 20 :
                  sizeMB <= 100 ? 30 :
                  sizeMB <= 500 ? 40 :
                  sizeMB <= 1024 ? 50 : 200;

    return res.json({
      success: true,
      videoFilename: driveLink,
      sizeMB: sizeMB.toFixed(2),
      price,
    });
  } catch (err) {
    console.error("❌ Drive yükleme hatası:", err);
    return res.status(500).json({ success: false, error: "Drive yüklenemedi." });
  }
});

// 💾 Veri kaydetme
app.post("/save", (req, res) => {
  const { fullname, email, phone, note, deliveryDate, sizeMB, price, videoFilename } = req.body;
  const yeniVeri = {
    fullname,
    email,
    phone,
    note,
    deliveryDate,
    sizeMB,
    price,
    videoFilename,
    timestamp: new Date().toISOString(),
  };
  const dbPath = path.join(__dirname, "veriler.json");
  const currentData = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath)) : [];
  currentData.push(yeniVeri);
  fs.writeFileSync(dbPath, JSON.stringify(currentData, null, 2));
  res.json({ success: true });
});

// 📊 Verileri listele
app.get("/veriler", authMiddleware, (req, res) => {
  const dbPath = path.join(__dirname, "veriler.json");
  if (!fs.existsSync(dbPath)) return res.json([]);
  const data = JSON.parse(fs.readFileSync(dbPath));
  res.json(data);
});

// ❌ Kayıt sil
app.delete("/veriler/:timestamp", authMiddleware, async (req, res) => {
  const dbPath = path.join(__dirname, "veriler.json");
  if (!fs.existsSync(dbPath)) return res.status(404).json({ success: false });
  const data = JSON.parse(fs.readFileSync(dbPath));
  const itemToDelete = data.find(item => item.timestamp === req.params.timestamp);
  if (!itemToDelete) return res.status(404).json({ success: false });

  const match = itemToDelete.videoFilename.match(/\/d\/(.+?)\//);
  if (match && match[1]) {
    const fileId = match[1];
    try {
      await deleteFromDrive(fileId);
    } catch (err) {
      console.error("❌ Drive silme hatası:", err.message);
    }
  }

  const yeniVeri = data.filter(item => item.timestamp !== req.params.timestamp);
  fs.writeFileSync(dbPath, JSON.stringify(yeniVeri, null, 2));
  res.json({ success: true });
});

// 📥 Shopier ödeme sonrası otomatik kayıt (webhook)
app.post("/shopier-webhook", express.urlencoded({ extended: true }), (req, res) => {
  const {
    platform_order_id,
    buyer_name,
    buyer_surname,
    buyer_email,
    total_order_value,
    installment,
    payment_status
  } = req.body;

  if (payment_status !== "success") return res.status(200).send("Ignored non-success status");

  const yeniVeri = {
    fullname: `${buyer_name} ${buyer_surname}`,
    email: buyer_email,
    phone: "",
    note: "Shopier'den gelen kayıt",
    deliveryDate: new Date().toISOString().slice(0, 10),
    sizeMB: "Bilinmiyor",
    price: total_order_value,
    videoFilename: "Bilinmiyor (manuel eşleştirme gerekebilir)",
    timestamp: new Date().toISOString(),
    platform_order_id
  };

  const dbPath = path.join(__dirname, "veriler.json");
  const currentData = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath)) : [];
  currentData.push(yeniVeri);
  fs.writeFileSync(dbPath, JSON.stringify(currentData, null, 2));

  console.log("✅ Shopier ödemesiyle kayıt eklendi:", yeniVeri.fullname);
  res.status(200).send("OK");
});

app.listen(PORT, () => {
  console.log(`✅ Sunucu çalışıyor: http://localhost:${PORT}`);
});
