const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { uploadToDrive } = require("./googleDriveUploader");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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

// 📥 Video gönderme işlemi
app.post("/submit", upload.single("video"), async (req, res) => {
  const video = req.file;
  if (!video) return res.status(400).json({ success: false, error: "Video yüklenemedi." });

  try {
    const driveLink = await uploadToDrive(video.path, video.originalname);
    fs.unlink(video.path, () => {}); // geçici dosyayı sil

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

// 💾 Veritabanına kayıt
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

app.get("/veriler", (req, res) => {
  const dbPath = path.join(__dirname, "veriler.json");
  if (!fs.existsSync(dbPath)) return res.json([]);
  const data = JSON.parse(fs.readFileSync(dbPath));
  res.json(data);
});

app.post("/admin-login", (req, res) => {
  const { password } = req.body;
  const correctPassword = "1234";
  if (password === correctPassword) res.json({ success: true });
  else res.status(401).json({ success: false, message: "Hatalı şifre" });
});

app.delete("/veriler/:timestamp", (req, res) => {
  const dbPath = path.join(__dirname, "veriler.json");
  if (!fs.existsSync(dbPath)) return res.status(404).json({ success: false });

  const data = JSON.parse(fs.readFileSync(dbPath));
  const yeniVeri = data.filter(item => item.timestamp !== req.params.timestamp);
  if (data.length === yeniVeri.length) return res.status(404).json({ success: false });

  fs.writeFileSync(dbPath, JSON.stringify(yeniVeri, null, 2));
  res.json({ success: true });
});

// 🔍 TOKEN dosyası Render'da doğru yerde mi kontrolü
const tokenPath = "/etc/secrets/token.json";
if (fs.existsSync(tokenPath)) {
  console.log("✅ token.json dosyası bulundu:", tokenPath);
} else {
  console.warn("⚠️ token.json bulunamadı! Google Drive erişimi başarısız olabilir.");
}

app.listen(PORT, () => {
  console.log(`✅ Sunucu çalışıyor: http://localhost:${PORT}`);
});
