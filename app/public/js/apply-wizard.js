(function () {
  const totalSteps = 6;
  let currentStep = 1;
  let photoFile = null;

  const form = document.getElementById('applyForm');
  const errorBox = document.getElementById('errorBox');
  const successBox = document.getElementById('successBox');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const submitBtn = document.getElementById('submitBtn');
  const photoInput = document.getElementById('passportPhotoInput');
  const photoPreview = document.getElementById('photoPreview');

  const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  const birthDaySelect = document.getElementById('birthDaySelect');
  for (let d = 1; d <= 31; d++) {
    const opt = document.createElement('option');
    opt.value = String(d);
    opt.textContent = String(d);
    birthDaySelect.appendChild(opt);
  }

  photoInput.addEventListener('change', () => {
    const file = photoInput.files[0];
    if (!file) return;
    photoFile = file;
    photoPreview.src = URL.createObjectURL(file);
  });

  function showStep(step) {
    document.querySelectorAll('.wizard-step').forEach(el => {
      el.classList.toggle('active', Number(el.dataset.step) === step);
    });
    document.querySelectorAll('.step-dot').forEach(el => {
      const s = Number(el.dataset.step);
      el.classList.toggle('active', s === step);
      el.classList.toggle('done', s < step);
    });
    prevBtn.style.visibility = step === 1 ? 'hidden' : 'visible';
    nextBtn.style.display = step === totalSteps ? 'none' : 'inline-block';
    submitBtn.style.display = step === totalSteps ? 'inline-block' : 'none';
    if (step === totalSteps) buildReview();
    errorBox.style.display = 'none';
  }

  function validateStep(step) {
    const stepEl = document.querySelector(`.wizard-step[data-step="${step}"]`);
    const requiredInputs = stepEl.querySelectorAll('[required]');
    for (const input of requiredInputs) {
      if (!input.value.trim()) {
        errorBox.textContent = 'Please complete all required fields before continuing.';
        errorBox.style.display = 'block';
        input.focus();
        return false;
      }
    }
    if (step === 5) {
      if (!document.getElementById('termsAccepted').checked || !document.getElementById('consentGiven').checked) {
        errorBox.textContent = 'You must accept the terms and provide consent to continue.';
        errorBox.style.display = 'block';
        return false;
      }
      if (!document.getElementById('signatureText').value.trim()) {
        errorBox.textContent = 'Please type your full name as your signature.';
        errorBox.style.display = 'block';
        return false;
      }
    }
    return true;
  }

  function buildReview() {
    const data = Object.fromEntries(new FormData(form));
    const rows = [
      ['Full Name', data.fullName],
      ['Birthday', data.birthMonth && data.birthDay ? `${MONTH_NAMES[Number(data.birthMonth)]} ${data.birthDay}` : '-'],
      ['Nationality', data.nationality],
      ['Occupation', data.occupation || '-'],
      ['Phone', data.phone], ['Email', data.email], ['Address', data.address],
      ['Interests', data.interests || '-'], ['Reason for Joining', data.reasonForJoining || '-'],
      ['Referee 1', `${data.referee1Name || '-'} (${data.referee1Contact || '-'})`],
      ['Referee 2', `${data.referee2Name || '-'} (${data.referee2Contact || '-'})`],
      ['Signature', data.signatureText],
      ['Passport Photo', photoFile ? photoFile.name : 'Not attached']
    ];
    document.getElementById('reviewSummary').innerHTML = rows
      .map(([label, value]) => `<div><strong>${label}:</strong> ${escapeHtml(String(value))}</div>`)
      .join('');
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  nextBtn.addEventListener('click', () => {
    if (!validateStep(currentStep)) return;
    currentStep = Math.min(currentStep + 1, totalSteps);
    showStep(currentStep);
  });

  prevBtn.addEventListener('click', () => {
    currentStep = Math.max(currentStep - 1, 1);
    showStep(currentStep);
  });

  submitBtn.addEventListener('click', async () => {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    errorBox.style.display = 'none';

    const fd = new FormData(form);
    fd.append('termsAccepted', document.getElementById('termsAccepted').checked);
    fd.append('consentGiven', document.getElementById('consentGiven').checked);
    if (photoFile) fd.append('passportPhoto', photoFile);

    try {
      const res = await fetch('/api/applicants', { method: 'POST', body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Submission failed');
      successBox.textContent = `Application submitted! Reference #${body.applicantId}. An admin will review it shortly.`;
      successBox.style.display = 'block';
      form.style.display = 'none';
      document.querySelectorAll('.step-dot').forEach(el => el.classList.add('done'));
      prevBtn.style.display = 'none';
      submitBtn.style.display = 'none';
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Application';
    }
  });

  showStep(currentStep);
})();
