CREATE TABLE currencies(
  code TEXT PRIMARY KEY NOT NULL,
  decimal_places INTEGER NOT NULL CHECK(decimal_places BETWEEN 0 AND 3)
) STRICT;
INSERT INTO currencies VALUES
  ('PHP',2),('USD',2),('EUR',2),('GBP',2),('JPY',0),('TWD',2);
CREATE TABLE profiles(
  id TEXT PRIMARY KEY NOT NULL,
  preferred_name TEXT NOT NULL CHECK(length(trim(preferred_name))>0),
  preferred_currency TEXT NOT NULL REFERENCES currencies(code)
) STRICT;
CREATE TABLE accounts(
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name))>0),
  type TEXT NOT NULL CHECK(type IN ('debit','assets','credit')),
  currency_code TEXT NOT NULL REFERENCES currencies(code),
  credit_limit_minor INTEGER CHECK(credit_limit_minor IS NULL OR credit_limit_minor >= 0),
  created_at TEXT NOT NULL,
  CHECK((type='credit' AND credit_limit_minor IS NOT NULL) OR (type!='credit' AND credit_limit_minor IS NULL))
) STRICT;
CREATE TABLE account_adjustments(
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount_minor INTEGER NOT NULL CHECK(amount_minor != 0),
  adjustment_type TEXT NOT NULL CHECK(adjustment_type='initial'),
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE pending_operations(
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  operation_type TEXT NOT NULL CHECK(operation_type IN ('account.create','account.update')),
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE setup(
  id INTEGER PRIMARY KEY CHECK(id=1),
  profile_id TEXT NOT NULL UNIQUE REFERENCES profiles(id),
  first_account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id),
  completed_at TEXT NOT NULL
) STRICT;
CREATE TABLE categories(
  id TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL UNIQUE CHECK(sort_order>=0)
) STRICT;
INSERT INTO categories VALUES
  ('food','Food',0),('transport','Transport',1),('phone','Phone',2),
  ('bills','Bills',3),('shopping','Shopping',4),('entertainment','Fun',5),
  ('health','Health',6),('fees','Fees',7),('other','Other',8);
CREATE TABLE expenses(
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  date TEXT NOT NULL CHECK(length(date)=10),
  note TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX expenses_by_account_date
  ON expenses(account_id, date DESC, created_at DESC);
CREATE TABLE pending_sync_operations(
  operation_id TEXT PRIMARY KEY NOT NULL REFERENCES expenses(id)
) STRICT;
CREATE TABLE income_categories(
  id TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL UNIQUE CHECK(sort_order>=0)
) STRICT;
INSERT INTO income_categories VALUES
  ('salary','Salary',0),('bonus','Bonus',1),('freelance','Freelance',2),
  ('commission','Commission',3),('business','Business',4),
  ('side-hustle','Side Hustle',5),('allowance','Allowance',6),
  ('gift','Gift',7),('refund','Refund',8),('cashback','Cashback',9),
  ('interest','Interest',10),('dividend','Dividend',11),
  ('rental','Rental',12),('other','Other',13);
CREATE TABLE incomes(
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  category_id TEXT REFERENCES income_categories(id),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>=0),
  date TEXT NOT NULL CHECK(length(date)=10),
  note TEXT,
  planned INTEGER NOT NULL CHECK(planned IN (0,1)),
  created_at TEXT NOT NULL,
  CHECK(amount_minor>0 OR planned=1)
) STRICT;
CREATE INDEX incomes_by_account_date
  ON incomes(account_id, date DESC, created_at DESC);
CREATE TABLE pending_income_sync_operations(
  operation_id TEXT PRIMARY KEY NOT NULL REFERENCES incomes(id)
) STRICT;

INSERT INTO profiles VALUES('legacy-profile','Anthony','PHP');
INSERT INTO accounts VALUES
  ('legacy-cash','Cash','debit','PHP',NULL,'2026-11-01T00:00:00.000Z'),
  ('legacy-reserve','Reserve','debit','PHP',NULL,'2026-11-01T00:00:01.000Z');
INSERT INTO account_adjustments VALUES
  ('opening:legacy-cash','legacy-cash',100000,'initial','2026-11-01T00:00:00.000Z'),
  ('opening:legacy-reserve','legacy-reserve',20000,'initial','2026-11-01T00:00:01.000Z');
INSERT INTO setup VALUES(1,'legacy-profile','legacy-cash','2026-11-01T00:00:00.000Z');
INSERT INTO expenses VALUES
  ('legacy-expense','legacy-cash','food',1200,'2026-11-02','Legacy coffee','2026-11-02T08:00:00.000Z');
INSERT INTO pending_sync_operations VALUES('legacy-expense');
INSERT INTO incomes VALUES
  ('legacy-income','legacy-cash','salary',2500,'2026-11-03','Legacy pay',0,'2026-11-03T08:00:00.000Z');
INSERT INTO pending_income_sync_operations VALUES('legacy-income');
CREATE TABLE transfers(
  id TEXT PRIMARY KEY NOT NULL,
  from_account_id TEXT NOT NULL REFERENCES accounts(id),
  to_account_id TEXT NOT NULL REFERENCES accounts(id),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  date TEXT NOT NULL CHECK(length(date)=10),
  note TEXT,
  created_at TEXT NOT NULL,
  CHECK(from_account_id != to_account_id)
) STRICT;
CREATE INDEX transfers_by_from_date ON transfers(from_account_id,date DESC,created_at DESC);
CREATE INDEX transfers_by_to_date ON transfers(to_account_id,date DESC,created_at DESC);
ALTER TABLE expenses ADD COLUMN transfer_id TEXT REFERENCES transfers(id);
CREATE UNIQUE INDEX expenses_one_fee_per_transfer ON expenses(transfer_id) WHERE transfer_id IS NOT NULL;
CREATE TABLE pending_transfer_operations(
  operation_id TEXT PRIMARY KEY NOT NULL REFERENCES transfers(id),
  request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64)
) STRICT;
INSERT INTO transfers VALUES(
  'legacy-transfer','legacy-cash','legacy-reserve',10000,'2026-11-04',
  'Legacy transfer','2026-11-04T09:00:00.000Z'
);
INSERT INTO expenses(id,account_id,category_id,amount_minor,date,note,created_at,transfer_id)
VALUES(
  'legacy-transfer-fee','legacy-cash','fees',456,'2026-11-04',
  'Bank transfer fee to Reserve','2026-11-04T09:00:00.000Z','legacy-transfer'
);
INSERT INTO pending_sync_operations VALUES('legacy-transfer-fee');
INSERT INTO pending_transfer_operations VALUES(
  'legacy-transfer',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
);
PRAGMA user_version=4;
