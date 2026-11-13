-- Turnup database (MySQL 8 or MariaDB 10.6+). Safe to run more than once.

CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  full_name     VARCHAR(120) NOT NULL,
  email         VARCHAR(190) NOT NULL UNIQUE,
  phone         VARCHAR(30)  NOT NULL DEFAULT '',
  password_hash VARCHAR(100) NOT NULL,
  role          ENUM('guest', 'host', 'admin') NOT NULL DEFAULT 'guest',
  city          VARCHAR(60)  NOT NULL DEFAULT 'Lagos',
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The public page for whoever runs the events (a brand, club or person)
CREATE TABLE IF NOT EXISTS hosts (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  owner_id   INT NOT NULL,
  name       VARCHAR(120) NOT NULL,
  slug       VARCHAR(140) NOT NULL UNIQUE,
  bio        VARCHAR(400) NOT NULL DEFAULT '',
  image_url  VARCHAR(300),
  verified   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_hosts_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS events (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  host_id     INT NOT NULL,
  title       VARCHAR(140) NOT NULL,
  slug        VARCHAR(160) NOT NULL UNIQUE,
  category    VARCHAR(40)  NOT NULL,
  summary     VARCHAR(200) NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  venue       VARCHAR(140) NOT NULL,
  area        VARCHAR(80)  NOT NULL,
  city        VARCHAR(60)  NOT NULL,
  starts_at   DATETIME NOT NULL,
  ends_at     DATETIME NOT NULL,
  image_url   VARCHAR(300),
  status      ENUM('draft', 'published', 'cancelled') NOT NULL DEFAULT 'published',
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_events_host FOREIGN KEY (host_id) REFERENCES hosts(id) ON DELETE CASCADE,
  INDEX events_when_idx (status, starts_at),
  INDEX events_city_idx (city, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ticket types for an event. A price of 0 means a free RSVP.
CREATE TABLE IF NOT EXISTS ticket_tiers (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  event_id      INT NOT NULL,
  name          VARCHAR(60)  NOT NULL,
  description   VARCHAR(200) NOT NULL DEFAULT '',
  price         INT NOT NULL DEFAULT 0,          -- whole naira
  quantity      INT NOT NULL,                    -- total available
  sold          INT NOT NULL DEFAULT 0,          -- paid or confirmed
  held          INT NOT NULL DEFAULT 0,          -- reserved for buyers who are paying right now (10 minutes)
  max_per_order INT NOT NULL DEFAULT 10,
  admits        INT NOT NULL DEFAULT 1,          -- people one ticket lets in (group tickets, tables)
  sales_end     DATETIME NULL,                   -- early-bird tiers stop selling at this time
  position      INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_tiers_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT tiers_capacity CHECK (sold >= 0 AND held >= 0 AND sold + held <= quantity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS saved_events (
  user_id    INT NOT NULL,
  event_id   INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, event_id),
  CONSTRAINT fk_saved_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_saved_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS host_follows (
  user_id    INT NOT NULL,
  host_id    INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, host_id),
  CONSTRAINT fk_follow_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_follow_host FOREIGN KEY (host_id) REFERENCES hosts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Friends, stored once per direction so "my friends" is one simple lookup
CREATE TABLE IF NOT EXISTS friendships (
  user_id    INT NOT NULL,
  friend_id  INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, friend_id),
  CONSTRAINT fk_friend_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_friend_friend FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Who is going. Phase 2 links each attendee to an order and a QR ticket;
-- for now sample guests are marked as going so "friends going" has data.
CREATE TABLE IF NOT EXISTS attendees (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  event_id   INT NOT NULL,
  user_id    INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY attendee_once (event_id, user_id),
  CONSTRAINT fk_att_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_att_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Discount codes. A code can be for one event or, with event_id empty, for all of a host's events.
CREATE TABLE IF NOT EXISTS promo_codes (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  host_id    INT NOT NULL,
  event_id   INT NULL,
  code       VARCHAR(30) NOT NULL,
  kind       ENUM('percent', 'amount') NOT NULL,
  value      INT NOT NULL,                 -- percent (1-100) or naira off
  max_uses   INT NULL,                     -- empty means unlimited
  used       INT NOT NULL DEFAULT 0,
  expires_at DATETIME NULL,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY promo_code_per_host (host_id, code),
  CONSTRAINT fk_promo_host FOREIGN KEY (host_id) REFERENCES hosts(id) ON DELETE CASCADE,
  CONSTRAINT fk_promo_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  order_number  VARCHAR(20) NOT NULL UNIQUE,
  user_id       INT NOT NULL,
  event_id      INT NOT NULL,
  status        ENUM('pending', 'paid', 'failed', 'cancelled', 'expired') NOT NULL DEFAULT 'pending',
  subtotal      INT NOT NULL,
  discount      INT NOT NULL DEFAULT 0,
  fee           INT NOT NULL DEFAULT 0,
  total         INT NOT NULL,
  promo_code_id INT NULL,
  payment_ref   VARCHAR(100) NULL UNIQUE,
  failure       VARCHAR(200) NULL,
  paid_at       DATETIME NULL,
  expires_at    DATETIME NULL,                   -- when held tickets go back on sale if unpaid
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_orders_event FOREIGN KEY (event_id) REFERENCES events(id),
  CONSTRAINT fk_orders_promo FOREIGN KEY (promo_code_id) REFERENCES promo_codes(id) ON DELETE SET NULL,
  INDEX orders_user_idx (user_id, created_at),
  INDEX orders_expiry_idx (status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- What was bought, with the name and price at the time (so later price changes do not rewrite history)
CREATE TABLE IF NOT EXISTS order_items (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  tier_id  INT NOT NULL,
  name     VARCHAR(60) NOT NULL,
  price    INT NOT NULL,
  quantity INT NOT NULL,
  admits   INT NOT NULL DEFAULT 1,
  CONSTRAINT fk_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_items_tier FOREIGN KEY (tier_id) REFERENCES ticket_tiers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One ticket per ticket bought. `code` is the secret printed in the QR code at the door.
CREATE TABLE IF NOT EXISTS tickets (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  order_id      INT NOT NULL,
  event_id      INT NOT NULL,
  tier_id       INT NOT NULL,
  user_id       INT NOT NULL,
  code          VARCHAR(40) NOT NULL UNIQUE,
  admits        INT NOT NULL DEFAULT 1,
  status        ENUM('valid', 'used', 'cancelled') NOT NULL DEFAULT 'valid',
  checked_in_at DATETIME NULL,
  checked_in_by INT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tickets_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_tickets_event FOREIGN KEY (event_id) REFERENCES events(id),
  CONSTRAINT fk_tickets_tier FOREIGN KEY (tier_id) REFERENCES ticket_tiers(id),
  CONSTRAINT fk_tickets_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX tickets_user_idx (user_id),
  INDEX tickets_event_idx (event_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- People who help run a host's events: co-hosts manage events, door staff can only check guests in
CREATE TABLE IF NOT EXISTS host_staff (
  host_id    INT NOT NULL,
  user_id    INT NOT NULL,
  role       ENUM('cohost', 'door') NOT NULL DEFAULT 'door',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (host_id, user_id),
  CONSTRAINT fk_staff_host FOREIGN KEY (host_id) REFERENCES hosts(id) ON DELETE CASCADE,
  CONSTRAINT fk_staff_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every scan at the door, including refused ones, for the live check-in dashboard and for disputes
CREATE TABLE IF NOT EXISTS checkins (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  event_id   INT NOT NULL,
  ticket_id  INT NULL,
  staff_id   INT NOT NULL,
  result     ENUM('admitted', 'already_used', 'wrong_event', 'invalid', 'undone') NOT NULL,
  admits     INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_checkins_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_checkins_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE SET NULL,
  CONSTRAINT fk_checkins_staff FOREIGN KEY (staff_id) REFERENCES users(id),
  INDEX checkins_event_idx (event_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
