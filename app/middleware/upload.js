const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp',
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

function makeStorage(subfolder) {
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join('/app/uploads', subfolder)),
    filename: (req, file, cb) => {
      const unique = crypto.randomBytes(8).toString('hex');
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${unique}${ext}`);
    }
  });
}

function fileFilter(req, file, cb) {
  if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
  cb(new Error('Unsupported file type'));
}

const limits = { fileSize: 8 * 1024 * 1024 }; // 8MB

// Meeting minutes: PDF only, slightly larger limit (scanned minutes can be big).
// The folder is created at runtime because /app/uploads is a persistent volume
// that may predate this feature.
const fs = require('fs');
const minutesDir = path.join('/app/uploads', 'minutes');
const uploadMinutes = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(minutesDir, { recursive: true });
      cb(null, minutesDir);
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.pdf`);
    }
  }),
  fileFilter: (req, file, cb) => {
    const isPdf = file.mimetype === 'application/pdf' && path.extname(file.originalname).toLowerCase() === '.pdf';
    if (isPdf) return cb(null, true);
    cb(new Error('Only PDF files are allowed for meeting minutes'));
  },
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

module.exports = {
  uploadMinutes,
  uploadPhoto: multer({ storage: makeStorage('photos'), fileFilter, limits }),
  uploadReceipt: multer({ storage: makeStorage('receipts'), fileFilter, limits }),
  uploadBudget: multer({ storage: makeStorage('budgets'), fileFilter, limits })
};
