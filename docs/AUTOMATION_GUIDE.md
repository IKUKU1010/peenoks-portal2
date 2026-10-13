# Connecting the portal to Google Sheets / Airtable for messaging automations

**The short version:** don't connect Airtable or Zapier *directly* to the database.
Instead the portal keeps a **Google Sheet** up to date with your data (a one-way
copy, refreshed every 30 minutes). Every no-code tool on earth can read a Google Sheet,
so that one sheet is the bridge to Airtable, Zapier, Make, n8n, Google Apps Script, etc.

```
 PostgreSQL  ──(backup service, every 30 min)──►  Google Sheet  ──►  Zapier / Make / n8n / Apps Script
 (source of truth)        one-way copy             (tabs below)  └─►  Airtable
                                                                      └─► WhatsApp / SMS / Email
```

Why not connect the database directly? It would mean opening PostgreSQL to the internet
(currently it only listens on `127.0.0.1` — keep it that way), and the database holds password
hashes and private details you don't want in third-party tools. The sync deliberately copies only
what messaging needs.

## What gets copied

| Tab | Columns (summary) | Good for |
|---|---|---|
| **Members** | Member ID, Name, Phone, Email, Birth Month/Day, `Birthday (MM-DD)`, Status, Joined | Birthday wishes, welcome messages, broadcast lists |
| **Applicants** | Applicant ID, Name, Phone, Email, Status, Submitted At, Member ID | "We received your application" messages |
| **Payments** | Payment ID, Member, Phone, Email, Purpose, Amount, Payment Date, Status | Payment reminders / receipts |
| **Expenses** | Expense ID, Member, Purpose, Amount, Expense Date, Status | Notifying the committee |
| **Accounts** | Date, Credit/Debit, Source, Member, Amount, Description | "Payment confirmed" messages, monthly statements |
| **Sync Info** | Last synced time | Checking the sync is alive |

**Never copied:** passwords/hashes, reset tokens, home addresses, uploaded photos/receipts.
**One-way only:** edits made in the sheet are overwritten at the next sync and never reach the database.
Rows are ordered oldest → newest so new records are appended at the bottom (this is what "new row"
triggers need).

## Part 1 — Turn on the Google Sheets sync (about 10 minutes)

You already created a Google service account for the Drive backups. Reuse it.

1. **Enable the Sheets API.** In [Google Cloud Console](https://console.cloud.google.com) (same project
   as before) → *APIs & Services → Library* → search **Google Sheets API** → **Enable**.
2. **Create a blank Google Sheet** (name it e.g. `PENOKS Live Data`).
3. **Share it with the service account.** Open `backup/credentials/gdrive_service_account.json`,
   copy the `client_email` value, then in the Sheet click **Share**, paste it and give it **Editor** access.
4. **Copy the Sheet ID** — the long string in the sheet's URL:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`
5. **Put it in `.env`:**
   ```
   GSHEET_ID=THIS_PART
   SHEETS_SYNC_CRON=*/30 * * * *
   ```
   (Don't put `# comments` on the same line as a value — older `docker-compose` includes them in the value.)
6. **Restart the backup service and trigger a first sync:**
   ```bash
   docker compose up -d --build backup
   docker compose exec backup node scripts/sheets-sync.js
   docker compose logs --tail 20 backup
   ```
   You should see `Members: N row(s)`, `Payments: N row(s)` … and the tabs appear in your sheet.
   To preview without writing anything: `docker compose exec -e DRY_RUN=true backup node scripts/sheets-sync.js`.

Change how often it runs by editing `SHEETS_SYNC_CRON` (e.g. `*/10 * * * *` = every 10 minutes,
`0 * * * *` = hourly). Google allows plenty of headroom for this volume of data.

## Part 2 — Messaging automations

Pick the trigger that matches the event. **Use the right tab** — it avoids the "row changed" problem:

| You want to message when… | Watch for a **new row** in… | Why it works |
|---|---|---|
| A payment is **confirmed** | **Accounts** (Type = credit) | A ledger row only appears *after* an admin verifies the payment |
| A new member is **approved** (welcome + their Member ID) | **Members** | A row appears only on approval |
| An application is **received** | **Applicants** | Row appears on submission |
| An expense is **approved** | **Accounts** (Type = debit) | Appears only after approval |
| It's a member's **birthday** | *(a daily schedule — see 2B)* | Uses the `Birthday (MM-DD)` column |

> Don't watch the *Payments* tab for "confirmed" — a row appears when the payment is **submitted**
> (pending); only its Status cell changes later, and plain "new row" triggers don't see that.

### 2A. Zapier / Make / n8n (no code)

1. Create a Zap/Scenario with trigger **Google Sheets → New Spreadsheet Row** (Make: *Watch New Rows*),
   pointing at your sheet and the tab from the table above.
2. Add a **filter** if needed (e.g. only `Type = credit`).
3. Add the action: **Email**, **SMS**, or **WhatsApp** (see channels below), mapping columns such as
   `Member Name`, `Amount (NGN)`, `Phone`.

Example "payment confirmed" text:
`Dear {{Member Name}}, we have confirmed your payment of ₦{{Amount (NGN)}} for {{Description}}. Thank you — PENOKS Neighborhood Friends.`

Note the sync runs every 30 minutes, so messages go out within roughly that window of the admin's approval.

**Channels** (check each provider's current pricing and rules before committing):
- **Email** — built into every tool above; free to start.
- **SMS** — Zapier/Make have modules for providers such as Twilio; Nigerian providers (e.g. Termii) usually offer an HTTP API you can call from a Make/n8n "HTTP request" step. Check local sender-ID and delivery rules.
- **WhatsApp** — via the WhatsApp Business Platform (directly or through a provider like Twilio). Messages you start must use **pre-approved templates**, and members generally need to have opted in.
- Phone numbers are stored as typed (e.g. `08031112222`). Most WhatsApp/SMS APIs want international format (`+234 803 111 2222`) — add a formatter step in the tool, or ask members to enter numbers that way.

### 2B. Birthday messages (free, no extra tool) — Google Apps Script

In your Google Sheet: **Extensions → Apps Script**, paste this, save, then click the clock icon
(**Triggers**) → *Add trigger* → function `sendBirthdayEmails` → *Time-driven* → *Day timer* → 7–8 am.

```javascript
function sendBirthdayEmails() {
  const sheet = SpreadsheetApp.getActive().getSheetByName('Members');
  const rows = sheet.getDataRange().getValues();
  const header = rows.shift();
  const col = (name) => header.indexOf(name);
  const today = Utilities.formatDate(new Date(), 'Africa/Lagos', 'MM-dd'); // e.g. "06-14"

  rows.forEach((r) => {
    const isActive = r[col('Status')] === 'active';
    const isBirthday = String(r[col('Birthday (MM-DD)')]) === today;
    const email = r[col('Email')];
    if (isActive && isBirthday && email) {
      MailApp.sendEmail(
        email,
        'Happy Birthday from PENOKS Neighborhood Friends 🎂',
        'Dear ' + r[col('Full Name')] + ',\n\nAll of us at PENOKS Neighborhood Friends wish you a very happy birthday!\n\nWarm regards,\nPENOKS Neighborhood Friends'
      );
    }
  });
}
```
Google limits how many emails a script can send per day (the quota is lower on a free Gmail account than on Google Workspace — check Google's current Apps Script quotas page, and if your club is large, use a tool from 2A instead).
Members born on 29 February only match in leap years. To send **SMS/WhatsApp** instead, replace
`MailApp.sendEmail(...)` with a `UrlFetchApp.fetch(...)` call to your provider's API.
The sync only touches the data tabs listed above (it never deletes the Sheet or its scripts), so your script stays safe. Put your own notes/formulas on a *separate* tab — the data tabs are wiped and rewritten on every sync.

## Part 3 — Airtable

Airtable doesn't read your PostgreSQL database directly on normal plans, so go via the Sheet:

- **One-time or occasional:** in Airtable use *Add or import → Google Sheets* (or CSV) to pull a tab in.
- **Automatically kept in sync:** Airtable's paid plans include "sync" integrations (the Business plan
  advertises premium/two-way sync). I could not confirm whether **Google Sheets** is available as a
  sync source on your specific plan, so check *Add or import → Sync* in your base before relying on it.
- **Works on any plan with automations (recommended):** use **Zapier or Make** to copy new rows from the
  Google Sheet into an Airtable table (trigger *New Spreadsheet Row* → action *Create Record*), and run your
  Airtable automations/interfaces from there.

Treat Airtable as a **read-only mirror** as well: anything edited there will not flow back into the portal.
If you ever need data to flow *back* (e.g. marking a reminder as "sent" in the database), that needs a small
API endpoint on the portal — tell me and I'll scope it.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Log says `GSHEET_ID not set` | `.env` value empty, or you didn't restart `backup` after editing it |
| `The caller does not have permission` | Sheet not shared with the service account's `client_email` as **Editor** |
| `Google Sheets API has not been used in project…` | Step 1 (enable the Sheets API) was skipped |
| `Google service account key not found` | `backup/credentials/gdrive_service_account.json` missing |
| Backup container exits right after start | Invalid cron expression, or an inline `# comment` on a `.env` line |
| Automation fires twice for the same row | Row order changed (someone sorted the tab) — keep the data tabs unsorted; make a separate tab for your own views |


---

## Part 5 — No Google needed: monthly CSV straight into n8n -> Airtable

If the Google Sheets sync keeps failing, you do not need it for Airtable. The portal saves last month's ledger as a
CSV at 00:00 on the 1st of every month (see README §12) and n8n can read it directly.

**One-time set-up**
1. In `.env` set `EXPORT_API_KEY=` to a long random string, then `docker compose up -d --build`.
2. In Airtable create a table with fields matching the CSV columns: `entry_id` (number or text, the unique key),
   `txn_date`, `entry_type`, `source_type`, `source_id`, `member_id`, `member_name`, `amount`, `description`,
   `status`, `created_at`.
3. First load of the history: `docker compose exec backup node scripts/ledger-monthly-export.js all`.

**n8n workflow — Option A: pull on a schedule**
1. *Schedule Trigger*: monthly, day 1, 01:00 (an hour after the file is created).
2. *HTTP Request*: Method GET, URL `https://YOUR-PORTAL/api/export/ledger/latest`, Header `X-API-Key` = your key,
   Response -> Format **File**.
3. *Extract From File*: operation **Extract From CSV**.
4. *Airtable*: operation **Create or Update** (upsert), match on `entry_id`, map the columns.

**n8n workflow — Option B: the portal pushes the file to you**
1. *Webhook* node: method POST. Copy its **Production URL** into `N8N_WEBHOOK_URL` in `.env`
   (add `N8N_WEBHOOK_SECRET` and check the `X-Webhook-Secret` header in n8n if you want protection), then
   `docker compose up -d backup`.
2. Webhook -> *Extract From File* (CSV, binary property `file`) -> *Airtable* (Create or Update on `entry_id`).
3. Test without waiting a month: `docker compose exec backup node scripts/ledger-monthly-export.js 2026-09`
   pushes that month to the webhook.

If n8n runs in Docker on the same server, use the portal's internal address (`http://app:3000`) only when both
containers share a Docker network; otherwise use the public URL.
