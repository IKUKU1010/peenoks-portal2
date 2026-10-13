Place your Google Cloud service account JSON key here as:

    gdrive_service_account.json

Steps to create one:
1. Go to console.cloud.google.com -> create/select a project.
2. Enable the "Google Drive API".
3. IAM & Admin -> Service Accounts -> Create Service Account.
4. Create a JSON key for it and download it as gdrive_service_account.json into this folder.
5. In Google Drive, create (or pick) a folder for backups, share it with the
   service account's client_email (found in the JSON file) as an Editor.
6. Copy that folder's ID from its URL into GDRIVE_FOLDER_ID in your .env file.

This file (and the real service account JSON) must never be committed to git.
