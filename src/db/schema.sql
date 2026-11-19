-- Haushaltskompass – SQLite-Schema (lokal, eine Datei pro Haushaltsbuch)
-- Geld: INTEGER Cent, Währung je Konto. Datum: TEXT 'YYYY-MM-DD' (Buchungsdatum ist ein Kalendertag, keine Zeitzone).
-- Zeitstempel: TEXT ISO-8601 UTC. IDs: TEXT (UUID v4).
PRAGMA foreign_keys = ON;

create table meta (key text primary key, value text not null);  -- schema_version, book_name, created_at

create table accounts (
  id text primary key,
  name text not null check (length(name) between 1 and 80),
  type text not null check (type in ('cash','checking','household','credit','savings')),
  owner text,
  currency text not null default 'EUR',
  opening_balance integer not null default 0,
  iban text,
  sort_order integer not null default 0,
  archived integer not null default 0,
  created_at text not null, updated_at text not null
);

create table categories (
  id text primary key,
  parent_id text references categories(id) on delete restrict,
  name text not null,
  kind text not null check (kind in ('income','expense')),
  tax_category text,
  color text,
  icon text,
  sort_order integer not null default 0,
  created_at text not null, updated_at text not null
);
create index idx_categories_parent on categories(parent_id);

create table recurring (
  id text primary key,
  payee text not null,
  category_id text references categories(id) on delete set null,
  account_id text references accounts(id) on delete cascade,
  amount integer not null,
  interval text not null check (interval in ('monthly','quarterly','halfyearly','yearly')),
  next_date text,
  status text not null default 'suggested' check (status in ('suggested','confirmed','ended','dismissed')),
  created_at text not null, updated_at text not null
);

create table transactions (
  id text primary key,
  account_id text not null references accounts(id) on delete cascade,
  date text not null,
  amount integer not null,                   -- negativ = Ausgabe, positiv = Einnahme
  payee text,
  purpose text,
  note text,
  category_id text references categories(id) on delete set null,  -- null wenn gesplittet oder Umbuchung
  transfer_id text,                          -- verbindet die zwei Hälften einer Umbuchung
  recurring_id text references recurring(id) on delete set null,
  import_hash text,                          -- Dublettenerkennung beim CSV-Import
  is_lump_sum integer not null default 0,    -- pauschale Erfassung
  created_at text not null, updated_at text not null
);
create index idx_tx_account_date on transactions(account_id, date);
create index idx_tx_date on transactions(date);
create index idx_tx_category on transactions(category_id);
create index idx_tx_transfer on transactions(transfer_id);
create unique index idx_tx_import_hash on transactions(account_id, import_hash) where import_hash is not null;

create table splits (
  id text primary key,
  transaction_id text not null references transactions(id) on delete cascade,
  category_id text references categories(id) on delete set null,
  amount integer not null,
  note text
);
create index idx_splits_tx on splits(transaction_id);
-- Invariante (im Datenlayer geprüft, in einer DB-Transaktion): sum(splits.amount) = transactions.amount

create table rules (
  id text primary key,
  field text not null check (field in ('payee','purpose','any')),
  op text not null check (op in ('contains','equals','starts_with','regex')),
  value text not null,
  category_id text not null references categories(id) on delete cascade,
  priority integer not null default 100,
  enabled integer not null default 1,
  created_at text not null, updated_at text not null
);

create table budgets (
  id text primary key,
  category_id text not null references categories(id) on delete cascade,
  period text not null check (period in ('month','year')),
  amount integer not null check (amount > 0),
  valid_from text not null,                  -- 'YYYY-MM'
  valid_to text,
  created_at text not null, updated_at text not null
);
create index idx_budgets_cat on budgets(category_id);

create table documents (
  id text primary key,
  filename text not null,
  mime text not null,
  size integer not null check (size <= 20971520),   -- 20 MB
  data blob not null,
  created_at text not null
);
create table document_links (
  document_id text not null references documents(id) on delete cascade,
  transaction_id text not null references transactions(id) on delete cascade,
  primary key (document_id, transaction_id)
);

create table dashboard_blocks (
  id text primary key,
  type text not null,      -- balance_trend | month_left | budgets | top_categories | cash | recent | tax_summary
  position integer not null,
  config text not null default '{}'
);
