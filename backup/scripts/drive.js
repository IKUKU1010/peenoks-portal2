const fs = require('fs');
const { google } = require('googleapis');

function getDriveClient() {
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyFile || !fs.existsSync(keyFile)) {
    throw new Error(
      `Google service account key not found at ${keyFile}. ` +
      'Place your JSON key at backup/credentials/gdrive_service_account.json.'
    );
  }
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/drive']
  });
  return google.drive({ version: 'v3', auth });
}

// Uploads a local file to the configured Drive folder.
// Pass targetMimeType to have Drive convert it on upload (e.g. to a native
// Google Sheet); omit it to upload the file as-is.
async function uploadFile({ localPath, name, sourceMimeType, targetMimeType }) {
  const folderId = process.env.GDRIVE_FOLDER_ID;
  if (!folderId) {
    console.log(`[drive] GDRIVE_FOLDER_ID not set, skipping upload of ${name}. File kept at ${localPath}`);
    return null;
  }
  const drive = getDriveClient();
  const fileMetadata = {
    name,
    parents: [folderId],
    ...(targetMimeType ? { mimeType: targetMimeType } : {})
  };
  const media = { mimeType: sourceMimeType, body: fs.createReadStream(localPath) };
  const res = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: 'id, name, webViewLink'
  });
  console.log(`[drive] Uploaded ${name} -> ${res.data.webViewLink || res.data.id}`);
  return res.data;
}

module.exports = { uploadFile };
