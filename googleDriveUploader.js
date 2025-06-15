// Placeholder for Google Drive uploadconst fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const fs = require("fs");


// credentials.json dosyasını oku
const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));

// OAuth2 istemcisi oluştur
const { client_secret, client_id, redirect_uris } = credentials.installed;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

// Daha önce alınmış token'ı oku
const TOKEN_PATH = path.join(__dirname, "token.json");

if (fs.existsSync(TOKEN_PATH)) {
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
  oAuth2Client.setCredentials(token);
} else {
  throw new Error("token.json bulunamadı. Yetkilendirme yapılmalı.");
}

const drive = google.drive({ version: "v3", auth: oAuth2Client });

// ASIL FONKSİYON
async function uploadToDrive(filepath, filename) {
  const fileMetadata = {
    name: filename,
    parents: ["root"] // istersen klasör ID’si koyabilirsin
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

  // Paylaşılabilir hale getir
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
