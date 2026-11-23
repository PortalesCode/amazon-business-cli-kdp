CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  url TEXT,
  keyword TEXT,
  marketplace TEXT,
  currency TEXT,
  location TEXT,
  lang TEXT,
  department TEXT,
  sort TEXT,
  page INTEGER,
  total_results_text TEXT,
  total_results INTEGER,
  total_results_is_over INTEGER DEFAULT 0,
  scroll_rounds INTEGER DEFAULT 0,
  items_count INTEGER DEFAULT 0,
  client TEXT,
  notes TEXT
);

CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  asin TEXT,
  position INTEGER,
  title TEXT,
  author TEXT,
  price REAL,
  price_raw TEXT,
  currency TEXT,
  rating REAL,
  reviews INTEGER,
  sponsored INTEGER DEFAULT 0,
  badge TEXT,
  format TEXT,
  publisher TEXT,
  pub_date TEXT,
  pages INTEGER,
  isbn13 TEXT,
  bsr_overall INTEGER,
  bsr_overall_category TEXT,
  ku INTEGER DEFAULT 0,
  sales_day_min REAL,
  sales_day_max REAL,
  royalty_day_min REAL,
  royalty_day_max REAL,
  estimate_source TEXT,
  publisher_kind TEXT,
  categories_json TEXT,
  royalty_unit REAL,
  subtitle TEXT,
  description TEXT,
  cover_url TEXT,
  reviews_json TEXT,
  dossier_json TEXT,
  url TEXT,
  raw TEXT
);

CREATE TABLE ranks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  asin TEXT,
  category TEXT,
  rank INTEGER,
  is_overall INTEGER DEFAULT 0,
  captured_at TEXT
);

CREATE TABLE suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seed TEXT,
  phrase TEXT,
  position INTEGER,
  captured_at TEXT,
  marketplace TEXT,
  url TEXT,
  UNIQUE(seed, phrase, captured_at)
);

CREATE INDEX idx_items_asin ON items(asin);
CREATE INDEX idx_items_run ON items(run_id);
CREATE INDEX idx_ranks_asin ON ranks(asin, captured_at);
CREATE INDEX idx_runs_keyword ON runs(keyword, created_at);
CREATE INDEX idx_runs_kind ON runs(kind, created_at);
CREATE INDEX idx_sugg_seed ON suggestions(seed, captured_at);

PRAGMA user_version = 1;
