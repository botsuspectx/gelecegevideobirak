const path = require("path");
const { google } = require("googleapis");
const fs = require("fs");

// ✅ Render'da Secret Files olarak yüklenen dosyaların yolları
const CREDENTIALS_PATH = "/etc/secrets/credentials.json";
const TOKEN_PATH = path.join(__dirname, "token.json");

// credentials.json içeriğini oku
const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));

// OAuth2 istemcisi oluştur
const { client_secret, client_id, redirect_uris } = credentials.web;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

// token.json içeriğini oku ve yetkilendir
if (fs.existsSync(TOKEN_PATH)) {
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
  oAuth2Client.setCredentials(token);
} else {
  console.warn("⚠️ token.json bulunamadı. İlk yetkilendirme yapılmalı. Sunucu çalışmaya devam ediyor...");
}


const drive = google.drive({ version: "v3", auth: oAuth2Client });

// 🚀 ASIL YÜKLEME FONKSİYONU
async function uploadToDrive(filepath, filename) {
  const fileMetadata = {
    name: filename,
    parents: ["root"] // klasör ID belirtilebilir
  };
  const media = {
    mimeType: "video/mp4",
    body: fs.createReadStream(filepath),
  };
  const res = await drive.files.create({
    resource: fileMetadata,
    media,
    fields: "id",
  });

  const fileId = res.data.id;

  // Linki herkesle paylaşılabilir yap
  await drive.permissions.create({
    fileId,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
  });

  const link = `https://drive.google.com/file/d/${fileId}/view`;
  return link;
}

module.exports = { uploadToDrive };
