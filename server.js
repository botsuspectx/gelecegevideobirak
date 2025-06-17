require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
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

// ✅ JWT kontrol middleware
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

// ✅ Admin girişi
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

// ✅ Çıkış
app.post("/admin-logout", (req, res) => {
  res.clearCookie("admin_token");
  res.json({ success: true });
});

// ✅ Video gönderimi
app.post("/submit", upload.single("video"), async (req, res) => {
  const video = req.file;
  const { fullname, email } = req.body;

  if (!video || !fullname || !email) {
    return res.status(400).json({ success: false, error: "Eksik bilgi veya video." });
  }

  try {
    const { fullname, email } = req.body;
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

// ✅ Veritabanına kayıt
app.post("/save", (req, res) => {
  const {
    fullname,
    email,
    phone,
    note,
    deliveryDate,
    sizeMB,
    price,
    videoFilename,
  } = req.body;

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

// ✅ Verileri listele
app.get("/veriler", authMiddleware, (req, res) => {
  const dbPath = path.join(__dirname, "veriler.json");
  if (!fs.existsSync(dbPath)) return res.json([]);
  const data = JSON.parse(fs.readFileSync(dbPath));
  res.json(data);
});

// ✅ Silme işlemi + Google Drive dosyasını kaldır
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
      console.log("🗑 Drive dosyası silindi:", fileId);
    } catch (err) {
      console.error("❌ Drive silme hatası:", err.message);
    }
  }

  const yeniVeri = data.filter(item => item.timestamp !== req.params.timestamp);
  fs.writeFileSync(dbPath, JSON.stringify(yeniVeri, null, 2));
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`✅ Sunucu çalışıyor: http://localhost:${PORT}`);
});
