# PENOKS Neighborhood Friends — Club Portal

A member portal with a public single-page site, member login/dashboard, a
membership application workflow, payment/expense submission, an admin
back-office, and a PostgreSQL-backed accounts ledger. Ships as three Docker
Compose services: `app` (Node/Express), `db` (PostgreSQL), and `backup`
(scheduled Google Drive backups + a Google Sheets export of the ledger).

## 1. What's inside

```
penoks-portal/
├── docker-compose.yml
├── .env.example              # copy to .env and fill in
├── db/init.sql               # schema, runs automatically on first boot
├── db/migrations/            # one-off upgrade scripts for databases that already hold data
├── docs/AUTOMATION_GUIDE.md  # connecting to Google Sheets / Airtable + messaging automations
├── app/                       # the web app (Node/Express + EJS)
│   ├── server.js
│   ├── routes/                # auth.js, public.js, member.js, admin.js, contact.js, minutes.js, exports.js
│   ├── utils/                  # ids.js, mailer.js
│   ├── views/                  # EJS: member dashboard/directory/ledger + admin pages
│   ├── private/                # club-constitution.pdf — never served directly, only via the gated API route
│   └── public/                # static site: home, about, contact, forms
└── backup/                    # scheduled Drive backup + Sheets export
    ├── index.js                # node-cron scheduler
    ├── scripts/db-backup.js    # pg_dump -> Google Drive
    ├── scripts/accounts-export.js  # accounts table -> Google Sheet
    ├── scripts/sheets-sync.js      # live one-way mirror of key tables -> Google Sheet
    ├── scripts/ledger-monthly-export.js  # monthly ledger -> CSV file (for n8n), no Google needed
    └── credentials/            # put your service-account JSON key here
```

## 2. Quick start

```bash
cp .env.example .env
# edit .env: set DB_PASSWORD, JWT_SECRET, SEED_ADMIN_USERNAME/PASSWORD
# (GDRIVE_FOLDER_ID can be left blank until you've set up the service account)

docker compose up -d --build
```

The app will be available at `http://<your-server>:3000`. On first boot it:
- Creates the schema (`db/init.sql`) automatically inside the `db` container.
- Creates one admin account from `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`
  in `.env` — log in at `/admin/login.html` with those credentials.

**Change `SEED_ADMIN_PASSWORD` to something strong before your first deploy**,
and rotate it via a direct DB update if you ever need to (there's no
"forgot password" flow for admins by design — this is a small, trusted-admin
system; see §6 for how to add more admins or reset a password by hand).

## 3. Branding assets

- `app/public/assets/logo.png` — your PENOKS logo (the full logo with wordmark; shown in every navbar).
- `app/public/assets/hero.jpg` — the homepage banner background (sunset city view). Replace this file
  (same filename) to change it.
- `app/public/assets/gallery/gallery-1.jpg` through `gallery-5.jpg` — the
  homepage photo slideshow, built from the photos you supplied. Swap these
  files (keep the same names, or add more `<div class="slide">` blocks in
  `index.html` for extra photos) to update the gallery.
- Colors/fonts live in `app/public/css/style.css` (CSS variables at the top)
  if you want to adjust the palette.
- `app/public/favicon.ico` and `app/public/assets/favicon-*.png`, `apple-touch-icon.png` — the browser-tab icon,
  generated from the round emblem of the logo (the wordmark is too small to read at 16-32px). Replace these files if the logo changes.
- **Currency**: all money throughout the app (dashboard, admin views,
  accounts ledger, the accounts spreadsheet export) is displayed in
  Nigerian Naira (₦).
- **Mobile navigation**: every page's nav collapses into a hamburger menu
  below ~800px width (`app/public/js/nav.js` injects the toggle button
  automatically into any `.navbar`, so new pages get it for free as long as
  they follow the same `<header class="navbar">...<nav>...</nav></header>`
  markup and include `<script src="/js/nav.js"></script>`). Admin/member
  sidebar layouts collapse into a horizontally-scrollable strip instead.

## 4. How the workflow fits together

**New member application** (`member-apply.html`, public):
1. Visitor clicks "Apply" → the requirements PDF opens, then the form loads.
2. Six-step wizard (personal, contact, membership, references, declaration,
   review) submits to `/api/applicants` with the passport photo attached.
3. Row lands in the `applicants` table, `status = 'pending'`.
4. Admin reviews it under **Admin → Applicants**. Approving:
   - Generates a unique Member ID (`PNK-0001`, `PNK-0002`, …).
   - Creates the row in `members` with a random temporary password
     (shown once to the admin — relay it to the new member yourself; there's
     no email integration in this build).
   - Marks the applicant `approved` and links the new Member ID.

**Submit Payment / Submit Expenses** (public forms, no login required —
matches the "Member Number" field you specified):
1. Member fills in their name, Member Number, purpose, amount, and attaches
   a receipt or budget sheet.
2. Row lands in `payments` / `expenses` with `status = 'pending'`.
3. **The transaction does *not* affect the accounts balance until an admin
   reviews it.** Admin verifies a payment or approves an expense under
   **Admin → Payments / Expenses**, which:
   - Updates that record's status.
   - Inserts a matching `credit` (payment) or `debit` (expense) row into
     `accounts`.
   This is a deliberate design choice so the ledger only ever reflects
   reviewed transactions — let me know if you'd rather have submissions post
   to the ledger immediately and be reversed on rejection instead.

**Member dashboard** (`/dashboard`, login required, view-only):
Shows the member's profile, their own payment/expense history and statuses,
and their personal totals (sum of *their* verified payments / approved
expenses). Every logged-in member can also browse:
- **Member Directory** (`/members`) — every member's name, Member ID,
  status, and join date. View-only; no contact details are shown here by
  default (phone/email are visible only on the member's own profile and to
  admins) — easy to change if you'd rather show contact info to the whole
  membership.
- **Club Accounts** (`/club-accounts`) — the full club ledger (every posted
  payment and expense, club-wide totals and balance), same data as the
  admin ledger but read-only: no verify/approve/reject controls are exposed
  on these member-facing pages, and the underlying API routes only support
  `GET`.

**Contact form** (`/contact.html`): posts to `/api/contact`, which sends a
real email via SMTP (Nodemailer) to `CONTACT_TO_EMAIL`, with the sender's
address set as Reply-To so you can respond directly. See §5b for setup.

**Admin back office** (`/admin/dashboard`, login required):
Applicants, Members (activate/suspend, view a member's full profile, and
permanently delete a member — see below), Payments, Expenses, and the full
Accounts Ledger with running totals.

**Member profile photo**: the passport photo attached during application is
carried through to the member's account and displayed both on the member's
own dashboard and on the admin's member profile page. It's stored in the
`uploads_data` Docker volume, so it survives container restarts/rebuilds.

**Deleting a member** (Admin → Members → View → Delete Member): this is a
genuine, permanent delete — it removes the member row *and* all of their
payments, expenses, and accounts ledger entries in one transaction (this
will change the club's balance totals, since those entries disappear too).
The confirm flow requires the admin to type the exact Member ID before
anything is deleted, and there's no undo. If you'd rather keep the
financial history and just deactivate the person instead, use **Suspend**
on the members list — that keeps everything intact and just blocks their
login.

## 5. Passwords, reset links, and payment dates

**Where are member passwords stored? Nowhere you can read them.** Passwords are saved only as one-way
bcrypt hashes in `members.password_hash`. That is deliberate: if the database (or a backup in Google Drive)
ever leaks, nobody can recover anyone's password. It also means an admin can never "look up" a forgotten
password — not even with direct database access. The temporary password shown at approval time is displayed
once and is not kept anywhere.

When a member forgets their password, the admin opens **Admin → Members → View** and chooses:

- **Email Reset Link** — sends the member a single-use link (valid 1 hour) to `/reset-password.html` where they
  choose their own new password. The admin never sees the password or the link. Needs working SMTP (section 6)
  and an email address on the member's record. Set `APP_BASE_URL` in `.env` to your public address so the
  link points at the right place.
- **Generate Temporary Password** — instantly invalidates the old password and shows a new random one *once* so
  the admin can pass it on (e.g. by phone/WhatsApp). The member is asked to change it at next login.

**Dates on payments and expenses.** The Submit Payment / Submit Expenses forms now have a date field that
defaults to today. The accounts ledger (screens, date-range filters, and the exported spreadsheet) is organised by
that *transaction date* — not by the day an admin happened to verify it — so "1 Feb to 31 Jul" returns what really
happened in that window. Future dates are rejected.

**Upgrading an existing database:** `db/init.sql` only runs on a brand-new database volume. For a deployment that
already has data, run the migration once (safe to repeat; it back-fills old records):
```bash
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/migrations/001_dates_and_password_reset.sql
```

## 6. Club Constitution (password-gated, view-only PDF)

Every page's footer and nav link to `/club-constitution.html`, a document
visible only to active members. A visitor enters **either their Member ID
or their account password** — either one unlocks it. On success, a
short-lived (20 minute) access token is issued as an httpOnly cookie, and
the PDF is rendered page-by-page onto `<canvas>` elements with
[PDF.js](https://mozilla.github.io/pdf.js/) rather than linked to directly,
so there's no visible download/print button and no bare URL to the file.

**Replace the placeholder**: swap `app/private/club-constitution.pdf` with
your real, signed constitution (same filename). This file lives outside
`app/public`, so it is never reachable by a direct URL — the only way to it
is through the gated `/api/constitution/view` endpoint.

**Please read this before relying on it**: this is a real deterrent, not
absolute protection. Rendering to canvas blocks the normal "right-click →
save image" and removes the browser's native PDF toolbar (so no one-click
download/print), and a basic in-memory rate limiter (10 attempts per 15
minutes per IP) slows down password guessing. But anyone who can see
content in a browser can still screenshot it or extract it with developer
tools — no client-side technique fully prevents that, no matter which
product you use. If you need stronger guarantees (watermarking per viewer,
audit logs of who viewed what, legal/DRM-grade protection), that's a
different and considerably more involved build — happy to scope that if
it's actually needed.

## 7. Contact form email (SMTP)

The contact form on `/contact.html` sends a real email — no CRM or
third-party form service needed. Set these in `.env`:

```
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_SECURE=false          # true only if using port 465
SMTP_USER=your_smtp_username
SMTP_PASSWORD=your_smtp_password
CONTACT_FROM_EMAIL=no-reply@penoksa.me
CONTACT_TO_EMAIL=contact@penoksa.me
```

Works with any standard SMTP provider — Gmail (with an
[App Password](https://support.google.com/accounts/answer/185833)),
SendGrid, Mailgun, Amazon SES, or your own mail server. If SMTP isn't
configured, the form shows a friendly error instead of crashing the app.
This was tested end-to-end against a local SMTP server during development
and confirmed to deliver a correctly formatted email with the submitter's
address set as Reply-To.

## 8. Google Drive / Sheets backups

> **Live Google Sheet for automations:** a third job (`sheets-sync.js`) mirrors members, applicants, payments,
> expenses and the ledger into a Google Sheet every 30 minutes (off until `GSHEET_ID` is set). That sheet is the
> bridge to Airtable/Zapier/Make and messaging (WhatsApp/SMS/email). Full walkthrough:
> [`docs/AUTOMATION_GUIDE.md`](docs/AUTOMATION_GUIDE.md).


Two scheduled jobs run inside the `backup` container:

| Job | Default schedule | What it does |
|---|---|---|
| DB backup | `0 2 * * *` (2am daily) | `pg_dump` (custom format) uploaded to Drive |
| Accounts export | `0 3 * * *` (3am daily) | Reads the `accounts` table, builds a spreadsheet with `exceljs`, uploads it converted to a native Google Sheet |

Schedules are 5-field cron expressions, set via `DB_BACKUP_CRON` and
`ACCOUNTS_EXPORT_CRON` in `.env`. They're evaluated using the container's
system time zone (UTC by default).

**Setup:**
1. In [Google Cloud Console](https://console.cloud.google.com), create/select
   a project and enable the **Google Drive API**.
2. Create a **Service Account**, then create a JSON key for it.
3. Save that key as `backup/credentials/gdrive_service_account.json`
   (never commit this file — it's already in `.gitignore`).
4. In Google Drive, create a folder for backups and **share it** with the
   service account's `client_email` (found inside the JSON key) as an
   **Editor**.
5. Copy that folder's ID (from its URL) into `GDRIVE_FOLDER_ID` in `.env`.
6. `docker compose up -d --build backup` to pick up the new env/credentials.

If `GDRIVE_FOLDER_ID` is left blank, both jobs still run and write their
output into the `backup_tmp` Docker volume, but skip the upload step (logged
clearly) — useful for testing before you've set up the service account.

To run a job immediately instead of waiting for the schedule:
```bash
docker compose exec backup node scripts/db-backup.js
docker compose exec backup node scripts/accounts-export.js
```

## 9. Operational notes

- **Adding another admin / resetting an admin password** (no UI for this yet):
  ```bash
  docker compose exec db psql -U <DB_USER> -d <DB_NAME>
  -- generate a bcrypt hash first, e.g. with:
  -- docker compose exec app node -e "console.log(require('bcryptjs').hashSync('newpassword',10))"
  INSERT INTO admins (username, password_hash, full_name, role)
  VALUES ('newadmin', '<bcrypt-hash>', 'New Admin', 'admin');
  ```
- **Uploads** (passport photos, receipts, budget sheets) live in the
  `uploads_data` Docker volume, mounted at `/app/uploads` in the `app`
  container — this is what gets swept up by the DB backup's referenced
  files if you extend the backup script to also archive `/app/uploads`
  (the current backup only dumps the database itself, not the uploaded
  files — let me know if you'd like the Drive backup to include them too).
- **HTTPS**: this compose file exposes the app on plain HTTP (`:3000`). Put
  Nginx, Caddy, or a cloud load balancer with a TLS certificate in front of
  it for production, and set `COOKIE_SECURE=true` in `.env` once you're
  serving over HTTPS (otherwise login cookies won't be sent correctly).
- **Ports**: Postgres is bound to `127.0.0.1:5432` only (not exposed
  publicly) — connect to it from the host via `psql -h 127.0.0.1 ...` if
  needed, or `docker compose exec db psql -U <user> <db>`.

## 10. Assumptions made while building this

- Payments/expenses require admin review before touching the ledger balance
  (see §4) — flag if you want immediate posting instead.
- No email system is wired up; the admin communicates new Member IDs and
  temporary passwords manually after approving an application.
- The "cron jobs" you asked for run via an in-process scheduler
  (`node-cron`) inside the long-lived `backup` container rather than the
  server's OS crontab — functionally the same result, but simpler to keep
  portable across any Ubuntu host. If you'd specifically like real OS-level
  cron entries instead (e.g. to survive independently of Docker), that's a
  straightforward swap.
- Contact form (`contact.html`) now sends a real email via SMTP — see §5.
- Members see a read-only directory of other members' names/status/join
  date (not phone/email) and the full club accounts ledger — say the word
  if you'd rather show contact details in the directory too, or restrict
  the ledger to summary totals only instead of the full transaction list.
- Homepage slideshow auto-advances every ~4.5 seconds with manual
  prev/next arrows, dot indicators, and touch-swipe support; no external
  library, so it works offline/self-hosted with no CDN dependency.
- Member deletion is a hard delete that cascades to that member's
  payments/expenses/ledger entries (see the workflow section above) rather
  than a soft "archive" — flag it if you'd prefer records preserved and
  just the login disabled (which Suspend already does without deleting
  anything).
- The application form now captures **Birthday as month + day only** (no
  year) per your request — this replaced the old Date of Birth field
  everywhere (database, forms, both dashboards). If you ever need age
  verification, you'd need to re-add a birth year separately.
- The accounts ledger (both admin and member-facing) is now filterable by
  date range, with quick presets (7/30/90 days, this year, all time) or a
  custom from/to range.
- Club Constitution access accepts a Member ID *or* a password from any
  active member — not scoped to "this is your own ID" specifically, per
  how you described it. If you'd rather each member only unlock it with
  their own credentials (not any valid member's), that's a one-line change.

## 11. Meeting Minutes (members-only, admin-uploaded PDFs)

**Admin → Meeting Minutes** (`/admin/minutes`): enter a title and the meeting date, choose a PDF (max 20MB) and
click *Upload & Publish to Members*. The list below the form shows everything uploaded; an admin can open any
file or delete it (deleting also removes the file from disk).

**Members**: a **Meeting Minutes** link appears in the navigation bar of the member dashboard (and the
Directory / Club Accounts pages). It is never shown on the public site, and every page and API behind it
requires a member login. `/meeting-minutes` lists the minutes newest-first; *Read Minutes* opens the PDF
page-by-page in the browser (PDF.js, same viewer technique as the Club Constitution) with no download or print
button.

Notes:
- Files live in the `uploads_data` volume under `minutes/` and are only reachable through the logged-in
  routes, never by a direct URL. The server checks that an upload is really a PDF, not just named `.pdf`.
- Like the Constitution viewer, this is a deterrent, not DRM: anyone who can see a page can screenshot it.
- The `meeting_minutes` table is created automatically on startup, so **no migration is needed** on an
  existing database (`db/migrations/002_meeting_minutes.sql` is there if you prefer to run it by hand).

## 12. Monthly ledger CSV (for n8n -> Airtable)

A job in the `backup` container runs at **00:00 on the 1st of every month** (time zone `Africa/Lagos`, change
with `LEDGER_EXPORT_TZ`) and saves every ledger entry whose transaction date is in the month that just ended as
`penoks-ledger-YYYY-MM.csv`. It reads the database directly, so it has nothing to do with Google and cannot fail
because of the Google APIs. Files are kept in the `ledger_exports` volume (nothing is overwritten except by
re-running the same month).

CSV columns: `entry_id, txn_date, entry_type, source_type, source_id, member_id, member_name, amount,
description, status, created_at`. `entry_id` is unique and never changes, so use it as the key when n8n writes
to Airtable (create-or-update) and re-imports can never create duplicates. A month with no entries still
produces a file containing just the header row.

Two ways to get the file into n8n (use either or both):

1. **Pull** — set `EXPORT_API_KEY` in `.env` (e.g. `openssl rand -hex 32`). n8n's *HTTP Request* node then
   calls, with header `X-API-Key: <your key>`:
   - `GET /api/export/ledger/latest` — newest monthly file
   - `GET /api/export/ledger/2026-09` — a specific month (`all` = the entire ledger)
   - `GET /api/export/ledger/files` — JSON list of what is available
2. **Push** — create a *Webhook* node in n8n, put its URL in `N8N_WEBHOOK_URL` (optionally a secret in
   `N8N_WEBHOOK_SECRET`, sent as header `X-Webhook-Secret`). Each new CSV is POSTed as multipart form data
   (binary field `file`, plus `month`, `rows`, `filename`), retried up to 3 times.

Admins can also download any file from **Admin → Ledger Exports**. Step-by-step n8n set-up is in
`docs/AUTOMATION_GUIDE.md` (Part 5).

**Manual runs / back-filling** (safe to repeat, it just rewrites that month's file):
```bash
docker compose exec backup node scripts/ledger-monthly-export.js            # last month
docker compose exec backup node scripts/ledger-monthly-export.js 2026-08    # a given month
docker compose exec backup node scripts/ledger-monthly-export.js all        # whole ledger (first Airtable load)
```
**If the server was off at midnight on the 1st**, the missed file is created automatically the next time the
`backup` container starts (turn off with `LEDGER_EXPORT_CATCHUP=false`).

**Important: late postings.** The ledger only receives an entry when an admin verifies a payment or approves an
expense, and the month is decided by the transaction date. A September payment verified on 3 October is not in
the file made at midnight on 1 October. Either review pending items before month-end, or re-run that month
(`... 2026-09`) and let n8n update by `entry_id`; the `created_at` column shows when each entry was posted.
