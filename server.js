require("dotenv").config();
const nodemailer = require("nodemailer");
const fetch = require("node-fetch");
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { uploadToDrive, deleteFromDrive } = require("./googleDriveUploader");
const mongoose = require("mongoose");

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("✅ MongoDB bağlantısı başarılı"))
.catch((err) => console.error("❌ MongoDB bağlantı hatası:", err));

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

const veriSchema = new mongoose.Schema({
  fullname: String,
  email: String,
  phone: String,
  note: String,
  deliveryDate: String,
  sizeMB: String,
  price: String,
  videoFilename: String,
  timestamp: String,
  platform_order_id: String,
  mailSent: { type: Boolean, default: false }  // 🆕 bu satır
});

const Veri = mongoose.model("Veri", veriSchema);


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

// JWT kontrol middleware
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

// Admin girişi
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

// Shopier ödeme formu
app.post("/shopier-odeme", (req, res) => {
  try {
    const { fullname, email, price } = req.body;
    const apiKey = process.env.SHOPIER_API_KEY;
    const secretKey = process.env.SHOPIER_SECRET_KEY;
    const websiteIndex = process.env.SHOPIER_WEBSITE_INDEX;
    const random_id = Date.now().toString();

    const data = {
      API_key: apiKey,
      website_index: websiteIndex,
      product_name: "Geleceğe Mesaj Videosu",
      buyer_name: fullname,
      buyer_surname: "Soyisim",
      buyer_email: email,
      buyer_address: "Adres Yok",
      buyer_phone: "05555555555",
      order_price: price,
      currency: "TL",
      platform_order_id: random_id,
      success_url: "https://gelecegevideobirak.com/odeme-basarili.html",
      failure_url: "https://gelecegevideobirak.com/odeme-hata.html"
    };

    const ordered = Object.entries(data).sort((a, b) => a[0].localeCompare(b[0]));
    const signatureStr = ordered.map(([key, val]) => `${key}=${encodeURIComponent(val)}`).join("&") + secretKey;

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

// Video yükleme
app.post("/submit", upload.single("video"), async (req, res) => {
  const video = req.file;
  const { fullname, email } = req.body;
  if (!video || !fullname || !email) {
    return res.status(400).json({ success: false, error: "Eksik bilgi veya video." });
  }

  const sizeMB = video.size / (1024 * 1024);
  const price = sizeMB <= 5 ? 0 :
                sizeMB <= 20 ? 10 :
                sizeMB <= 50 ? 20 :
                sizeMB <= 100 ? 30 :
                sizeMB <= 500 ? 40 :
                sizeMB <= 1024 ? 50 : 200;

  // Burada sadece dosya adını dön, henüz Drive'a yükleme
  res.json({
    success: true,
    tempFilename: video.filename,
    sizeMB: sizeMB.toFixed(2),
    price,
  });
});
app.post("/shopier-basarili-yukle", async (req, res) => {
  const {
    fullname,
    email,
    phone,
    note,
    deliveryDate,
    sizeMB,
    price,
    tempFilename
  } = req.body;

  if (!fullname || !email || !tempFilename) {
    return res.status(400).json({ success: false, error: "Kullanıcı bilgileri veya video eksik." });
  }

  const videoPath = path.join(__dirname, "uploads", tempFilename);

  try {
    const driveLink = await uploadToDrive(videoPath, tempFilename, fullname, email);
    fs.unlink(videoPath, () => {}); // geçici dosyayı sil

    // Sadece aşağıdaki satır olmalı
    res.json({ success: true, videoFilename: driveLink });

  } catch (err) {
    console.error("❌ Drive yükleme hatası:", err);
    res.status(500).json({ success: false, error: "Yükleme başarısız." });
  }
});
 // Sunucudan sil

// Kayıt kaydetme
app.post("/save", async (req, res) => {
  try {
    const { fullname, email, phone, note, deliveryDate, sizeMB, price, videoFilename } = req.body;

    const yeniVeri = new Veri({
      fullname,
      email,
      phone,
      note,
      deliveryDate,
      sizeMB,
      price,
      videoFilename,
      timestamp: new Date().toISOString(),
    });

    await yeniVeri.save();

    res.json({ success: true });
  } catch (err) {
    console.error("❌ MongoDB kayıt hatası:", err);
    res.status(500).json({ success: false, message: "Kayıt başarısız" });
  }
});


// Kayıtları listele
app.get("/veriler", authMiddleware, async (req, res) => {
  try {
    const veriler = await Veri.find().sort({ timestamp: -1 });
    res.json(veriler);
  } catch (err) {
    console.error("❌ Veriler alınamadı:", err);
    res.status(500).json({ success: false });
  }
});


// Kayıt silme
app.delete("/veriler/:timestamp", authMiddleware, async (req, res) => {
  try {
    const silinecek = await Veri.findOne({ timestamp: req.params.timestamp });
    if (!silinecek) return res.status(404).json({ success: false });

    // Drive’dan sil
    const match = silinecek.videoFilename.match(/\/d\/(.+?)\//);
    if (match && match[1]) {
      await deleteFromDrive(match[1]);
    }

    await Veri.deleteOne({ timestamp: req.params.timestamp });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Silme hatası:", err);
    res.status(500).json({ success: false });
  }
});

// Webhook sonrası kayıt
app.post("/shopier-webhook", express.urlencoded({ extended: true }), async (req, res) => {
  const {
    platform_order_id,
    buyer_name,
    buyer_surname,
    buyer_email,
    total_order_value,
    payment_status
  } = req.body;

  if (payment_status !== "success") return res.status(200).send("Ignored non-success status");

  const fileList = fs.readdirSync(path.join(__dirname, "uploads"));
  const matchingFile = fileList.find(name => name.includes(platform_order_id.slice(-6)));

  if (!matchingFile) {
    console.error("❌ Eşleşen dosya bulunamadı.");
    return res.status(404).send("Video dosyası bulunamadı");
  }

  const filePath = path.join(__dirname, "uploads", matchingFile);

  try {
    const videoFilename = await uploadToDrive(filePath, matchingFile, buyer_name, buyer_email);
    fs.unlinkSync(filePath);

    const yeniVeri = {
      fullname: `${buyer_name} ${buyer_surname}`,
      email: buyer_email,
      phone: "",
      note: "Shopier'den gelen kayıt",
      deliveryDate: new Date().toISOString().slice(0, 10),
      sizeMB: "Bilinmiyor",
      price: total_order_value,
      videoFilename,
      timestamp: new Date().toISOString(),
      platform_order_id
    };

    await new Veri(yeniVeri).save();


    console.log("✅ Shopier ödemesiyle kayıt ve yükleme başarılı:", yeniVeri.fullname);
    res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Drive yükleme hatası webhook içinde:", err);
    res.status(500).send("Upload error");
  }
});
app.post("/temizle-gecici-dosya", (req, res) => {
  const { tempFilename } = req.body;
  if (!tempFilename) return res.status(400).json({ success: false, error: "Dosya adı yok" });

  const filePath = path.join(__dirname, "uploads", tempFilename);

  fs.unlink(filePath, (err) => {
    if (err) {
      console.error("❌ Dosya silinemedi:", err);
      return res.status(500).json({ success: false, error: "Dosya silinemedi" });
    }
    console.log("🗑️ Geçici dosya silindi:", tempFilename);
    res.json({ success: true });
  });
});

app.post("/yorum-ekle", async (req, res) => {
  const { name, email, comment, showName, "g-recaptcha-response": token } = req.body;

  if (!name || !email || !comment || !token) {
    return res.status(400).json({ success: false, message: "Gerekli alanlar eksik veya doğrulama yapılmadı." });
  }

  // ✅ Google reCAPTCHA doğrulaması
  try {
    const verifyURL = `https://www.google.com/recaptcha/api/siteverify`;
    const params = new URLSearchParams();
    params.append("secret", process.env.RECAPTCHA_SECRET);
    params.append("response", token);

    const response = await fetch(verifyURL, {
      method: "POST",
      body: params
    });

    const data = await response.json();

    if (!data.success) {
      return res.status(400).json({ success: false, message: "reCAPTCHA doğrulaması başarısız." });
    }
  } catch (err) {
    console.error("❌ reCAPTCHA doğrulama hatası:", err);
    return res.status(500).json({ success: false, message: "Doğrulama sırasında hata oluştu." });
  }

  // ✅ Yorum kaydetme işlemi
  const yeniYorum = {
    name: name.trim(),
    email: email.trim(),
    comment: comment.trim(),
    showName: showName === true || showName === "true",
    timestamp: new Date().toISOString(),
  };

  const yorumDosyasi = path.join(__dirname, "yorumlar.json");
  let yorumlar = [];

  if (fs.existsSync(yorumDosyasi)) {
    yorumlar = JSON.parse(fs.readFileSync(yorumDosyasi));
  }

  yorumlar.push(yeniYorum);
  fs.writeFileSync(yorumDosyasi, JSON.stringify(yorumlar, null, 2));

  res.json({ success: true });
});


app.get("/yorumlar", (req, res) => {
  const yorumDosyasi = path.join(__dirname, "yorumlar.json");
  if (!fs.existsSync(yorumDosyasi)) return res.json([]);

  const yorumlar = JSON.parse(fs.readFileSync(yorumDosyasi));
  res.json(yorumlar);
});

app.delete("/yorumlar/:timestamp", (req, res) => {
  const yorumDosyasi = path.join(__dirname, "yorumlar.json");
  if (!fs.existsSync(yorumDosyasi)) return res.status(404).json({ success: false });

  const yorumlar = JSON.parse(fs.readFileSync(yorumDosyasi));
  const yeniYorumlar = yorumlar.filter(y => y.timestamp !== req.params.timestamp);

  if (yorumlar.length === yeniYorumlar.length) {
    return res.status(404).json({ success: false, message: "Yorum bulunamadı" });
  }

  fs.writeFileSync(yorumDosyasi, JSON.stringify(yeniYorumlar, null, 2));
  res.json({ success: true });
});

app.post("/email-dogrula", async (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes("@")) {
    return res.json({ success: false, message: "Geçerli bir e-posta girilmedi." });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6 haneli kod

  // Gmail SMTP ayarı
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "mansurkuddar0001@gmail.com",         // ← senin gmail adresin
      pass: "kftp wkud atki ixkh"                 // ← Google uygulama şifresi
    }
  });

  try {
    await transporter.sendMail({
      from: '"Geleceğe Video Gönder" <mansurkuddar0001@gmail.com>',
      to: email,
      subject: "E-posta Doğrulama Kodunuz",
      text: `Geleceğe Mesaj hizmeti için doğrulama kodunuz: ${code}`
    });

    res.json({ success: true, code });
  } catch (err) {
    console.error("❌ Mail gönderilemedi:", err);
    res.json({ success: false, message: "Kod gönderilemedi." });
  }
});

const cron = require("node-cron");

// Her sabah 06:00'da çalışır
cron.schedule("0 6 * * *", async () => {
  console.log("⏰ Mail gönderim kontrolü başladı");

  const today = new Date().toISOString().slice(0, 10);

  try {
    const bekleyenler = await Veri.find({
      deliveryDate: today,
      mailSent: { $ne: true }
    });

    if (bekleyenler.length === 0) {
      console.log("✅ Bugün gönderilecek mail yok.");
      return;
    }

    // Mail gönderici ayarları (Gmail)
    const nodemailer = require("nodemailer");
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "mansurkuddar0001@gmail.com",
        pass: "kftp wkud atki ixkh"
      }
    });

    for (const kayit of bekleyenler) {
      const mailOptions = {
        from: '"Geleceğe Video Bırak" <mansurkuddar0001@gmail.com>',
        to: kayit.email,
        subject: "🎥 Geleceğe Bıraktığınız Mesaj Zamanı Geldi!",
        text: `
Merhaba ${kayit.fullname},

Belirttiğiniz tarihte geleceğe gönderdiğiniz mesaj artık hazır.
📹 Videonuza şu bağlantıdan ulaşabilirsiniz:

${kayit.videoFilename}

Notunuz: "${kayit.note}"

Sevgiyle,
Geleceğe Video Bırak Ekibi
        `
      };

      try {
        await transporter.sendMail(mailOptions);
        await Veri.updateOne({ _id: kayit._id }, { $set: { mailSent: true } });
        console.log(`✅ Mail gönderildi: ${kayit.email}`);
      } catch (err) {
        console.error(`❌ Mail gönderilemedi: ${kayit.email}`, err);
      }
    }

  } catch (err) {
    console.error("❌ Günlük mail gönderimi sırasında hata:", err);
  }
});




app.listen(PORT, () => {
  console.log(`✅ Sunucu çalışıyor: http://localhost:${PORT}`);
});
