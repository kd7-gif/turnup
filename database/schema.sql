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
  max_per_order INT NOT NULL DEFAULT 10,
  sales_end     DATETIME NULL,                   -- early-bird tiers stop selling at this time
  position      INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_tiers_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT tiers_not_oversold CHECK (sold >= 0 AND sold <= quantity)
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
