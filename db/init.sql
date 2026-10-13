-- PENOKS Neighborhood Friends — Club Portal schema
-- Runs automatically on first container start (docker-entrypoint-initdb.d)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- ADMINS
-- ============================================================
CREATE TABLE admins (
    admin_id      SERIAL PRIMARY KEY,
    username      VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name     VARCHAR(150),
    role          VARCHAR(20) NOT NULL DEFAULT 'admin', -- admin | superadmin
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- NEW MEMBER APPLICANTS  (member-apply.html submissions)
-- ============================================================
CREATE TABLE applicants (
    applicant_id      SERIAL PRIMARY KEY,

    -- Step 1: Personal details
    full_name         VARCHAR(150) NOT NULL,
    birth_month       SMALLINT NOT NULL CHECK (birth_month BETWEEN 1 AND 12),
    birth_day         SMALLINT NOT NULL CHECK (birth_day BETWEEN 1 AND 31),
    nationality       VARCHAR(80) NOT NULL,
    occupation        VARCHAR(120),

    -- Step 2: Contact details
    phone             VARCHAR(30) NOT NULL,
    email             VARCHAR(150) NOT NULL,
    address           TEXT NOT NULL,

    -- Step 3: Membership
    interests         TEXT,
    reason_for_joining TEXT,

    -- Step 4: References
    referee1_name     VARCHAR(150),
    referee1_contact  VARCHAR(150),
    referee2_name     VARCHAR(150),
    referee2_contact  VARCHAR(150),

    -- Step 5: Declaration
    terms_accepted    BOOLEAN NOT NULL DEFAULT false,
    consent_given     BOOLEAN NOT NULL DEFAULT false,
    signature_text    VARCHAR(150), -- typed full-name signature

    photo_path        TEXT, -- passport photo

    status            VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | approved | rejected
    rejection_reason  TEXT,
    reviewed_by        INTEGER REFERENCES admins(admin_id),
    reviewed_at         TIMESTAMPTZ,
    approved_member_id VARCHAR(20), -- filled in once promoted to members

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- MEMBERS  (populated only after admin approval)
-- ============================================================
CREATE TABLE members (
    member_id         VARCHAR(20) PRIMARY KEY, -- e.g. PNK-0001
    applicant_id      INTEGER REFERENCES applicants(applicant_id),

    full_name         VARCHAR(150) NOT NULL,
    birth_month       SMALLINT CHECK (birth_month BETWEEN 1 AND 12),
    birth_day         SMALLINT CHECK (birth_day BETWEEN 1 AND 31),
    nationality       VARCHAR(80),
    occupation        VARCHAR(120),

    phone             VARCHAR(30),
    email             VARCHAR(150),
    address           TEXT,

    interests         TEXT,
    reason_for_joining TEXT,

    photo_path        TEXT,

    password_hash     TEXT NOT NULL,
    must_change_password BOOLEAN NOT NULL DEFAULT true,
    reset_token_hash  TEXT,          -- sha256 of an emailed one-time reset token
    reset_token_expires TIMESTAMPTZ,

    status            VARCHAR(20) NOT NULL DEFAULT 'active', -- active | suspended
    joined_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- SUBMIT PAYMENT  (submit-payment.html submissions)
-- ============================================================
CREATE TABLE payments (
    payment_id      VARCHAR(20) PRIMARY KEY, -- e.g. PMT-000001
    member_id       VARCHAR(20) NOT NULL REFERENCES members(member_id),
    names           VARCHAR(150) NOT NULL,   -- as typed on the form
    purpose         VARCHAR(200) NOT NULL,
    amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_date    DATE NOT NULL DEFAULT CURRENT_DATE, -- date the payment was made
    receipt_path    TEXT,                    -- payment receipt attachment
    status          VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | verified | rejected
    admin_note      TEXT,
    reviewed_by     INTEGER REFERENCES admins(admin_id),
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- SUBMIT EXPENSE REQUEST  (submit-expenses.html submissions)
-- ============================================================
CREATE TABLE expenses (
    expense_id       VARCHAR(20) PRIMARY KEY, -- e.g. EXP-000001
    member_id        VARCHAR(20) NOT NULL REFERENCES members(member_id),
    names            VARCHAR(150) NOT NULL,
    purpose          VARCHAR(200) NOT NULL,
    amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    expense_date     DATE NOT NULL DEFAULT CURRENT_DATE, -- date of the expense
    budget_sheet_path TEXT,                  -- expense/budget sheet attachment
    status           VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | approved | rejected
    admin_note       TEXT,
    reviewed_by      INTEGER REFERENCES admins(admin_id),
    reviewed_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- ACCOUNTS  (the club ledger — only posted once admin verifies/
-- approves the matching payment or expense, so the balance always
-- reflects reviewed transactions only)
-- ============================================================
CREATE TABLE accounts (
    entry_id      SERIAL PRIMARY KEY,
    entry_type    VARCHAR(10) NOT NULL CHECK (entry_type IN ('credit','debit')),
    source_type   VARCHAR(10) NOT NULL CHECK (source_type IN ('payment','expense')),
    source_id     VARCHAR(20) NOT NULL, -- payment_id or expense_id
    member_id     VARCHAR(20) REFERENCES members(member_id),
    amount        NUMERIC(12,2) NOT NULL,
    description   VARCHAR(255),
    txn_date      DATE NOT NULL DEFAULT CURRENT_DATE, -- date the transaction actually happened
    status        VARCHAR(10) NOT NULL DEFAULT 'posted', -- posted | void
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- MEETING MINUTES  (PDFs uploaded by admins, read-only for members)
-- ============================================================
CREATE TABLE meeting_minutes (
    minutes_id     SERIAL PRIMARY KEY,
    title          VARCHAR(200) NOT NULL,
    meeting_date   DATE NOT NULL,
    file_path      TEXT NOT NULL,           -- relative to /app/uploads, e.g. minutes/123-abc.pdf
    original_name  VARCHAR(255),
    uploaded_by    INTEGER REFERENCES admins(admin_id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_meeting_minutes_date ON meeting_minutes(meeting_date);

CREATE INDEX idx_payments_member ON payments(member_id);
CREATE INDEX idx_expenses_member ON expenses(member_id);
CREATE INDEX idx_accounts_member ON accounts(member_id);
CREATE INDEX idx_accounts_txn_date ON accounts(txn_date);
CREATE INDEX idx_applicants_status ON applicants(status);

-- Sequences used to generate human-friendly IDs (members/payments/expenses)
CREATE SEQUENCE member_id_seq START 1;
CREATE SEQUENCE payment_id_seq START 1;
CREATE SEQUENCE expense_id_seq START 1;
