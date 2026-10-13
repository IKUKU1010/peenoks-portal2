const { execFile } = require('child_process');
const path = require('path');
const { uploadFile } = require('./drive');

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function runPgDump(outFile) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD };
    execFile(
      'pg_dump',
      [
        '-h', process.env.DB_HOST,
        '-p', String(process.env.DB_PORT || 5432),
        '-U', process.env.DB_USER,
        '-F', 'c', // custom format, compressed, restorable with pg_restore
        '-f', outFile,
        process.env.DB_NAME
      ],
      { env },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve();
      }
    );
  });
}

async function runDbBackup() {
  const fileName = `penoks-db-backup-${timestamp()}.dump`;
  const outFile = path.join('/tmp/penoks-backup', fileName);
  console.log(`[db-backup] Running pg_dump -> ${outFile}`);
  await runPgDump(outFile);
  console.log('[db-backup] Dump complete, uploading to Google Drive...');
  await uploadFile({
    localPath: outFile,
    name: fileName,
    sourceMimeType: 'application/octet-stream'
  });
  console.log('[db-backup] Done.');
}

module.exports = { runDbBackup };

if (require.main === module) {
  runDbBackup().catch((err) => { console.error('[db-backup] FAILED:', err); process.exit(1); });
}
