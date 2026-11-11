-- TechHaven database schema. Idempotent: safe to run on every start-up.

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  email           VARCHAR(255) NOT NULL UNIQUE,
  full_name       VARCHAR(120) NOT NULL,
  phone           VARCHAR(20),
  password_hash   VARCHAR(100),
  google_id       VARCHAR(64) UNIQUE,
  role            VARCHAR(10)  NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  is_banned       BOOLEAN      NOT NULL DEFAULT FALSE,
  loyalty_points  INTEGER      NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
-- Exactly one administrator account.
CREATE UNIQUE INDEX IF NOT EXISTS users_single_admin ON users (role) WHERE role = 'admin';

CREATE TABLE IF NOT EXISTS addresses (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient     VARCHAR(120) NOT NULL,
  phone         VARCHAR(20),
  address_line  VARCHAR(255) NOT NULL,
  ward          VARCHAR(100),
  district      VARCHAR(100),
  city          VARCHAR(100) NOT NULL,
  is_default    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS addresses_user ON addresses (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS addresses_one_default ON addresses (user_id) WHERE is_default;

-- One-time tokens for "set your password" (new accounts) and password recovery.
CREATE TABLE IF NOT EXISTS password_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  CHAR(64) NOT NULL UNIQUE,
  purpose     VARCHAR(10) NOT NULL CHECK (purpose IN ('setup', 'reset')),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(80)  NOT NULL UNIQUE,
  slug         VARCHAR(80)  NOT NULL UNIQUE,
  description  TEXT,
  icon         VARCHAR(30)  NOT NULL DEFAULT 'box',
  position     INTEGER      NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id                 SERIAL PRIMARY KEY,
  name               VARCHAR(200) NOT NULL,
  slug               VARCHAR(220) NOT NULL UNIQUE,
  brand              VARCHAR(60)  NOT NULL,
  category_id        INTEGER NOT NULL REFERENCES categories(id),
  short_description  VARCHAR(300) NOT NULL,
  description        TEXT NOT NULL,
  specs              JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags               TEXT[] NOT NULL DEFAULT '{}',
  -- Denormalised read models, maintained by the API.
  min_price          BIGINT  NOT NULL DEFAULT 0,
  sold_count         INTEGER NOT NULL DEFAULT 0,
  avg_rating         NUMERIC(3,2) NOT NULL DEFAULT 0,
  rating_count       INTEGER NOT NULL DEFAULT 0,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS products_category ON products (category_id);
CREATE INDEX IF NOT EXISTS products_brand ON products (brand);
CREATE INDEX IF NOT EXISTS products_created ON products (created_at DESC);
CREATE INDEX IF NOT EXISTS products_tags ON products USING GIN (tags);

-- Each variant has its own price, cost and independent inventory.
CREATE TABLE IF NOT EXISTS variants (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku         VARCHAR(60)  NOT NULL UNIQUE,
  name        VARCHAR(120) NOT NULL,
  price       BIGINT  NOT NULL CHECK (price > 0),
  cost_price  BIGINT  NOT NULL CHECK (cost_price >= 0),
  stock       INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS variants_product ON variants (product_id);

-- Binary storage for uploaded images, so API replicas stay stateless.
CREATE TABLE IF NOT EXISTS media (
  id          SERIAL PRIMARY KEY,
  mime        VARCHAR(50) NOT NULL,
  data        BYTEA NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_images (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url         VARCHAR(300) NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS product_images_product ON product_images (product_id);

-- Comments: anyone may post (guests give a display name).
CREATE TABLE IF NOT EXISTS comments (
  id           SERIAL PRIMARY KEY,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_name  VARCHAR(80) NOT NULL,
  content      VARCHAR(2000) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS comments_product ON comments (product_id, created_at DESC);

-- Star ratings: signed-in users only, one per user per product (updatable).
CREATE TABLE IF NOT EXISTS ratings (
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars       SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, user_id)
);

-- Discount codes: 5 alphanumeric characters, no expiry, at most 10 uses.
CREATE TABLE IF NOT EXISTS discount_codes (
  id           SERIAL PRIMARY KEY,
  code         CHAR(5) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{5}$'),
  type         VARCHAR(10) NOT NULL CHECK (type IN ('percent', 'fixed')),
  value        BIGINT NOT NULL CHECK (value > 0),
  usage_limit  SMALLINT NOT NULL CHECK (usage_limit BETWEEN 1 AND 10),
  used_count   SMALLINT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (used_count <= usage_limit),
  CHECK (type <> 'percent' OR value <= 100)
);

CREATE TABLE IF NOT EXISTS orders (
  id                SERIAL PRIMARY KEY,
  order_number      VARCHAR(20) NOT NULL UNIQUE,
  user_id           INTEGER NOT NULL REFERENCES users(id),
  email             VARCHAR(255) NOT NULL,
  full_name         VARCHAR(120) NOT NULL,
  phone             VARCHAR(20)  NOT NULL,
  shipping_address  TEXT NOT NULL,
  subtotal          BIGINT NOT NULL,
  discount_code_id  INTEGER REFERENCES discount_codes(id),
  discount_amount   BIGINT NOT NULL DEFAULT 0,
  tax               BIGINT NOT NULL,
  shipping_fee      BIGINT NOT NULL,
  points_used       INTEGER NOT NULL DEFAULT 0,
  points_discount   BIGINT NOT NULL DEFAULT 0,
  total             BIGINT NOT NULL,
  points_earned     INTEGER NOT NULL DEFAULT 0,
  payment_method    VARCHAR(20) NOT NULL CHECK (payment_method IN ('cod', 'card', 'bank_transfer')),
  payment_status    VARCHAR(20) NOT NULL DEFAULT 'paid',
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'confirmed', 'shipping', 'delivered', 'cancelled')),
  note              VARCHAR(500),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS orders_user ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_created ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_discount ON orders (discount_code_id);

CREATE TABLE IF NOT EXISTS order_items (
  id            SERIAL PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    INTEGER REFERENCES products(id) ON DELETE SET NULL,
  variant_id    INTEGER REFERENCES variants(id) ON DELETE SET NULL,
  product_name  VARCHAR(200) NOT NULL,
  variant_name  VARCHAR(120) NOT NULL,
  category_id   INTEGER REFERENCES categories(id),
  unit_price    BIGINT  NOT NULL,
  unit_cost     BIGINT  NOT NULL,
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  line_total    BIGINT  NOT NULL
);
CREATE INDEX IF NOT EXISTS order_items_order ON order_items (order_id);
CREATE INDEX IF NOT EXISTS order_items_product ON order_items (product_id);

CREATE TABLE IF NOT EXISTS order_status_history (
  id          SERIAL PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status      VARCHAR(20) NOT NULL,
  note        VARCHAR(300),
  changed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS order_status_history_order ON order_status_history (order_id, created_at DESC);

-- ---------- Additions (idempotent for databases created by earlier versions) ----------
-- Original price before discount, shown struck through next to the selling price.
ALTER TABLE variants ADD COLUMN IF NOT EXISTS compare_at_price BIGINT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS min_compare_price BIGINT;

-- Review sentiment computed asynchronously by the assistant service.
ALTER TABLE comments ADD COLUMN IF NOT EXISTS sentiment VARCHAR(10)
  CHECK (sentiment IN ('positive', 'neutral', 'negative'));
ALTER TABLE comments ADD COLUMN IF NOT EXISTS sentiment_score REAL;

-- Wish lists of signed-in customers (guests keep theirs in the browser).
CREATE TABLE IF NOT EXISTS wishlists (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, product_id)
);
