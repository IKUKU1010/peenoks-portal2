const express = require('express');
const { sendContactEmail } = require('../utils/mailer');

const router = express.Router();

router.post('/api/contact', async (req, res) => {
  const { firstName, lastName, email, message } = req.body;
  if (!firstName || !lastName || !email) {
    return res.status(400).json({ error: 'Please fill in your name and email.' });
  }
  try {
    await sendContactEmail({ firstName, lastName, email, message });
    res.json({ ok: true });
  } catch (err) {
    console.error('[contact] send failed:', err.message);
    res.status(500).json({ error: 'Could not send your message right now. Please try again later or email us directly.' });
  }
});

module.exports = router;
