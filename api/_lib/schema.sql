CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  volume_ml INTEGER NOT NULL,
  price INTEGER,
  online_url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain TEXT NOT NULL,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  district TEXT,
  address TEXT,
  lat REAL,
  lng REAL,
  phone TEXT,
  hours TEXT,
  sizes TEXT,
  online_url TEXT,
  verified_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  is_sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_branches_place ON branches (city, district);

CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'advice',
  title TEXT NOT NULL,
  summary TEXT,
  body TEXT,
  doctor_name TEXT,
  doctor_title TEXT,
  video_url TEXT,
  image_url TEXT,
  source TEXT,
  published_at TEXT,
  featured INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  is_sample INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'creator',
  title TEXT NOT NULL,
  author TEXT,
  topic TEXT,
  video_url TEXT,
  image_url TEXT,
  sponsored INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  is_sample INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  size TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews (status, created_at);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  contact TEXT,
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS partner_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  org TEXT,
  contact_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  location TEXT,
  details TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS location_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  city TEXT NOT NULL,
  district TEXT,
  note TEXT,
  contact TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_name ON events (name, created_at);
CREATE INDEX IF NOT EXISTS idx_events_created ON events (created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- failed admin sign-ins, for throttling (rows older than a day are removed)
CREATE TABLE IF NOT EXISTS admin_logins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_logins ON admin_logins (ip_hash, created_at);

-- Integrations (Facebook Messenger). Never exposed by the public API.
CREATE TABLE IF NOT EXISTS integrations (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messenger_contacts (
  psid TEXT PRIMARY KEY,
  name TEXT,
  welcomed_at TEXT,
  ai_until TEXT,
  channel TEXT NOT NULL DEFAULT 'messenger',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messenger_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  psid TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  kind TEXT NOT NULL DEFAULT 'message',
  text TEXT,
  mid TEXT UNIQUE,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messenger_psid ON messenger_messages (psid, created_at);

-- one row per conversation, kept current by triggers (the admin list reads these instead of every message)
CREATE TABLE IF NOT EXISTS messenger_threads (psid TEXT PRIMARY KEY, last_id INTEGER NOT NULL DEFAULT 0, last_at TEXT, last_in_at TEXT, last_text TEXT, last_direction TEXT, unread INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_messenger_threads_last ON messenger_threads (last_at);
CREATE INDEX IF NOT EXISTS idx_messenger_unread ON messenger_messages (psid) WHERE direction = 'in' AND is_read = 0;
CREATE TRIGGER IF NOT EXISTS trg_messenger_thread_in AFTER INSERT ON messenger_messages BEGIN
  INSERT INTO messenger_threads (psid, last_id, last_at, last_in_at, last_text, last_direction, unread) VALUES (NEW.psid, NEW.id, NEW.created_at, CASE WHEN NEW.direction = 'in' THEN NEW.created_at END, NEW.text, NEW.direction, CASE WHEN NEW.direction = 'in' AND NEW.is_read = 0 THEN 1 ELSE 0 END) ON CONFLICT (psid) DO UPDATE SET last_at = MAX(COALESCE(last_at, ''), excluded.last_at), last_in_at = CASE WHEN excluded.last_in_at > COALESCE(last_in_at, '') THEN excluded.last_in_at ELSE last_in_at END, last_text = CASE WHEN excluded.last_id > last_id THEN excluded.last_text ELSE last_text END, last_direction = CASE WHEN excluded.last_id > last_id THEN excluded.last_direction ELSE last_direction END, last_id = MAX(last_id, excluded.last_id), unread = unread + excluded.unread;
END;
CREATE TRIGGER IF NOT EXISTS trg_messenger_thread_read AFTER UPDATE OF is_read ON messenger_messages WHEN NEW.direction = 'in' AND OLD.is_read = 0 AND NEW.is_read = 1 BEGIN
  UPDATE messenger_threads SET unread = MAX(unread - 1, 0) WHERE psid = NEW.psid;
END;

-- Knowledge base used by the Messenger AI assistant (with doctor tips and FAQs)
CREATE TABLE IF NOT EXISTS knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  keywords TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Images uploaded from the admin (covers for doctor tips and videos), served from /api/media/<id>
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
