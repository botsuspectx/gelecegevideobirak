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
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
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

  let driveLink = "";
  try {
    driveLink = await uploadToDrive(video.path, video.originalname);
    fs.unlink(video.path, () => {});
  } catch (err) {
    console.error("❌ Drive yükleme hatası:", err);
    return res.status(500).json({ success: false, error: "Drive yüklenemedi." });
  }

  const sizeMB = video.size / (1024 * 1024);
  const price = sizeMB <= 5 ? 0 :
                sizeMB <= 20 ? 10 :
                sizeMB <= 50 ? 20 :
                sizeMB <= 100 ? 30 :
                sizeMB <= 500 ? 40 :
                sizeMB <= 1024 ? 50 : 200;

  res.json({
    success: true,
    videoFilename: driveLink,
    sizeMB: sizeMB.toFixed(2),
    price
  });
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
    timestamp: new Date().toISOString()
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

// ✅ Google OAuth 2.0 Yetki Dönüş Noktası
app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send("❌ Kod alınamadı.");

  try {
    const CREDENTIALS_PATH = "/etc/secrets/credentials.json";
    const TOKEN_PATH = "/etc/secrets/token.json";
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
    const { client_secret, client_id, redirect_uris } = credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    res.send("✅ Token başarıyla alındı ve kayıt edildi.");
  } catch (err) {
    console.error("❌ Token alma hatası:", err);
    res.send("❌ Token alınamadı.");
  }
});

app.listen(PORT, () => {
  console.log(`✅ Sunucu çalışıyor: http://localhost:${PORT}`);
});
