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
  currency_code TEXT NOT NULL REFERENCES currencies(code),
  opening_balance_minor INTEGER NOT NULL
) STRICT;
CREATE TABLE setup(
  id INTEGER PRIMARY KEY CHECK(id=1),
  profile_id TEXT NOT NULL UNIQUE REFERENCES profiles(id),
  first_account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id),
  completed_at TEXT NOT NULL
) STRICT;
INSERT INTO profiles VALUES('local','Anthony','PHP');
INSERT INTO accounts VALUES('first','Cash','PHP',123456);
INSERT INTO setup VALUES(1,'local','first','2026-11-07T00:00:00.000Z');
PRAGMA user_version=1;
