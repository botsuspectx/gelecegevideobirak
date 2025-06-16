const path = require("path");
const { google } = require("googleapis");
const fs = require("fs");

// 📌 Render'da secret dosyalar bu dizinde olur
const TOKEN_PATH = "/etc/secrets/token.json";
const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");

// credentials.json içeriğini oku
const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
const { client_secret, client_id, redirect_uris } = credentials.web || credentials.installed;

// OAuth2 istemcisi oluştur
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

// token.json içeriğini oku ve yetkilendir
if (fs.existsSync(TOKEN_PATH)) {
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
  oAuth2Client.setCredentials(token);
} else {
  console.warn("⚠️ token.json bulunamadı. İlk yetkilendirme yapılmalı.");
}

// Google Drive API nesnesi
const drive = google.drive({ version: "v3", auth: oAuth2Client });

// 🚀 Dosyayı Drive'a yükle
async function uploadToDrive(filepath, filename) {
  const fileMetadata = {
    name: filename,
    parents: ["root"], // klasör ID belirtmek istersen burayı değiştir
  };

  const media = {
    mimeType: "video/mp4",
    body: fs.createReadStream(filepath),
  };

  try {
    const file = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: "id",
    });

    const fileId = file.data.id;

    // Linki herkesle paylaşılabilir yap
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    const publicLink = `https://drive.google.com/file/d/${fileId}/view`;
    return publicLink;

  } catch (error) {
    console.error("❌ Dosya yüklenemedi:", error.message);
    throw new Error("Google Drive yükleme hatası");
  }
}

module.exports = { uploadToDrive };
