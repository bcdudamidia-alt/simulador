-- Pareo — DDL de referência (PostgreSQL 16)
--
-- A fonte da verdade para a aplicação é prisma/schema.prisma; este arquivo existe
-- para revisão de DBA, para o time de dados e para as restrições que o Prisma não
-- consegue expressar (CHECKs, índices parciais, índice de busca textual).
--
-- Aplicar:  psql "$DATABASE_URL" -f sql/001_init.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS citext;    -- e-mail case-insensitive
CREATE EXTENSION IF NOT EXISTS unaccent;  -- normalização de descrição

-- ─────────────────────────────── enums ───────────────────────────────

CREATE TYPE member_role        AS ENUM ('owner','partner','viewer');
CREATE TYPE account_type       AS ENUM ('checking','savings','investment','cash','other');
CREATE TYPE card_brand         AS ENUM ('visa','mastercard','elo','amex','hipercard','other');
CREATE TYPE statement_status   AS ENUM ('open','closed','paid','overdue');
CREATE TYPE category_kind      AS ENUM ('expense','income','transfer','investment');
CREATE TYPE transaction_type   AS ENUM ('expense','income','transfer','refund');
CREATE TYPE transaction_status AS ENUM ('pending','posted','reconciled');
CREATE TYPE category_source    AS ENUM ('rule','history','ai','user');
CREATE TYPE sharing            AS ENUM ('shared','personal');
CREATE TYPE match_type         AS ENUM ('contains','starts_with','equals','regex');
CREATE TYPE goal_kind          AS ENUM ('wedding','property','travel','emergency_fund','vehicle','education','other');
CREATE TYPE goal_status        AS ENUM ('active','paused','achieved','cancelled');
CREATE TYPE import_format      AS ENUM ('ofx','csv','manual');
CREATE TYPE import_status      AS ENUM ('processing','completed','failed','partial');

-- ───────────────────────── identidade e isolamento ─────────────────────────

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext      NOT NULL UNIQUE,
  password_hash     text        NOT NULL,   -- bcrypt cost 12
  name              text        NOT NULL,
  avatar_url        text,
  mfa_secret_enc    bytea,                  -- 🔒 AES-256-GCM
  email_verified_at timestamptz,
  last_login_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE households (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  currency   char(3)     NOT NULL DEFAULT 'BRL',
  timezone   text        NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE household_members (
  household_id uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  role         member_role NOT NULL DEFAULT 'partner',
  joined_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id)
);
CREATE INDEX idx_members_user ON household_members(user_id);

CREATE TABLE household_invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email        citext      NOT NULL,
  role         member_role NOT NULL DEFAULT 'partner',
  token_hash   text        NOT NULL UNIQUE,   -- token em claro só vai no e-mail
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_invites_household ON household_invites(household_id);

CREATE TABLE refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text        NOT NULL UNIQUE,     -- sha256; o token em claro não é persistido
  family_id  uuid        NOT NULL,            -- reuso detectado → revoga a família toda
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent text,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_user   ON refresh_tokens(user_id, revoked_at);
CREATE INDEX idx_refresh_family ON refresh_tokens(family_id);

-- ───────────────────────────── contas e cartões ─────────────────────────────

CREATE TABLE accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id          uuid         NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  owner_user_id         uuid         REFERENCES users(id) ON DELETE SET NULL,  -- NULL = conta conjunta
  name                  text         NOT NULL,
  type                  account_type NOT NULL DEFAULT 'checking',
  institution_code      text,
  institution_name      text,
  number_enc            bytea,                    -- 🔒 número da conta
  number_bidx           bytea,                    -- blind index HMAC (casa o <ACCTID> do OFX)
  current_balance_cents bigint       NOT NULL DEFAULT 0,
  balance_synced_at     timestamptz,
  color                 text         NOT NULL DEFAULT '#6366F1',
  icon                  text         NOT NULL DEFAULT 'bank',
  is_archived           boolean      NOT NULL DEFAULT false,
  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX idx_accounts_household ON accounts(household_id, is_archived);
CREATE INDEX idx_accounts_bidx      ON accounts(household_id, number_bidx);

CREATE TABLE credit_cards (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id       uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  owner_user_id      uuid        REFERENCES users(id)    ON DELETE SET NULL,
  payment_account_id uuid        REFERENCES accounts(id) ON DELETE SET NULL,
  name               text        NOT NULL,
  brand              card_brand  NOT NULL DEFAULT 'other',
  last4_enc          bytea,                  -- 🔒 nunca guardamos PAN completo nem CVV
  holder_name_enc    bytea,                  -- 🔒
  credit_limit_cents bigint,
  closing_day        smallint    NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
  due_day            smallint    NOT NULL CHECK (due_day     BETWEEN 1 AND 31),
  color              text        NOT NULL DEFAULT '#8B5CF6',
  is_archived        boolean     NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cards_household ON credit_cards(household_id, is_archived);

CREATE TABLE card_statements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id       uuid             NOT NULL REFERENCES households(id)   ON DELETE CASCADE,
  credit_card_id     uuid             NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
  reference_month    date             NOT NULL,   -- sempre dia 1
  closing_date       date             NOT NULL,
  due_date           date             NOT NULL,
  total_amount_cents bigint           NOT NULL DEFAULT 0,
  paid_amount_cents  bigint           NOT NULL DEFAULT 0,
  status             statement_status NOT NULL DEFAULT 'open',
  created_at         timestamptz      NOT NULL DEFAULT now(),
  updated_at         timestamptz      NOT NULL DEFAULT now(),
  CONSTRAINT uq_statement_period UNIQUE (credit_card_id, reference_month),
  CONSTRAINT ck_statement_ref_first_day CHECK (date_trunc('month', reference_month) = reference_month)
);
CREATE INDEX idx_statements_due ON card_statements(household_id, due_date);

-- ─────────────────────────── categorias e transações ───────────────────────────

CREATE TABLE categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid          NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  parent_id    uuid          REFERENCES categories(id) ON DELETE SET NULL,
  name         text          NOT NULL,
  slug         text          NOT NULL,      -- "alimentacao.delivery"
  kind         category_kind NOT NULL DEFAULT 'expense',
  color        text          NOT NULL DEFAULT '#94A3B8',
  icon         text          NOT NULL DEFAULT 'tag',
  is_system    boolean       NOT NULL DEFAULT false,  -- veio do catálogo padrão
  created_at   timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT ck_category_not_self_parent CHECK (parent_id IS DISTINCT FROM id)
);
CREATE UNIQUE INDEX uq_category_slug ON categories(household_id, slug);
CREATE INDEX idx_categories_household ON categories(household_id, kind);

CREATE TABLE merchants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id        uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  normalized_name     text        NOT NULL,
  display_name        text        NOT NULL,
  default_category_id uuid        REFERENCES categories(id) ON DELETE SET NULL,
  seen_count          integer     NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_merchant UNIQUE (household_id, normalized_name)
);

CREATE TABLE transactions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id           uuid               NOT NULL REFERENCES households(id)      ON DELETE CASCADE,
  account_id             uuid               REFERENCES accounts(id)                 ON DELETE CASCADE,
  credit_card_id         uuid               REFERENCES credit_cards(id)             ON DELETE CASCADE,
  card_statement_id      uuid               REFERENCES card_statements(id)          ON DELETE SET NULL,
  category_id            uuid               REFERENCES categories(id)               ON DELETE SET NULL,
  merchant_id            uuid               REFERENCES merchants(id)                ON DELETE SET NULL,
  import_batch_id        uuid,              -- FK adicionada depois (import_batches vem abaixo)
  posted_at              date               NOT NULL,
  competence_date        date               NOT NULL,
  amount_cents           bigint             NOT NULL,   -- negativo = saída, positivo = entrada
  currency               char(3)            NOT NULL DEFAULT 'BRL',
  description            text               NOT NULL,
  normalized_description text               NOT NULL,
  notes                  text,
  type                   transaction_type   NOT NULL DEFAULT 'expense',
  status                 transaction_status NOT NULL DEFAULT 'posted',
  fitid                  text,
  dedupe_hash            text               NOT NULL,
  category_source        category_source,
  category_confidence    numeric(3,2)       CHECK (category_confidence BETWEEN 0 AND 1),
  needs_review           boolean            NOT NULL DEFAULT false,
  sharing                sharing            NOT NULL DEFAULT 'shared',
  paid_by_user_id        uuid               REFERENCES users(id) ON DELETE SET NULL,
  installment_number     smallint,
  installment_total      smallint,
  installment_group_id   uuid,
  goal_id                uuid,              -- FK adicionada depois (goals vem abaixo)
  created_at             timestamptz        NOT NULL DEFAULT now(),
  updated_at             timestamptz        NOT NULL DEFAULT now(),

  -- ou é de conta, ou é de cartão. Nunca os dois, nunca nenhum.
  CONSTRAINT ck_tx_origin CHECK (num_nonnulls(account_id, credit_card_id) = 1),
  CONSTRAINT ck_tx_amount_not_zero CHECK (amount_cents <> 0),
  CONSTRAINT ck_tx_installment CHECK (
    (installment_number IS NULL AND installment_total IS NULL)
    OR (installment_number BETWEEN 1 AND installment_total)
  )
);

-- dedupe forte: FITID é único por conta quando o banco o fornece
CREATE UNIQUE INDEX uq_tx_account_fitid ON transactions(account_id, fitid) WHERE fitid IS NOT NULL;
-- dedupe fallback: cobre CSV de fatura, que raramente traz FITID
CREATE UNIQUE INDEX uq_tx_dedupe        ON transactions(household_id, dedupe_hash);

CREATE INDEX idx_tx_household_date ON transactions(household_id, posted_at DESC);
CREATE INDEX idx_tx_category       ON transactions(household_id, category_id, posted_at);
CREATE INDEX idx_tx_review         ON transactions(household_id) WHERE needs_review;
CREATE INDEX idx_tx_statement      ON transactions(card_statement_id);
CREATE INDEX idx_tx_installment    ON transactions(installment_group_id);
CREATE INDEX idx_tx_search         ON transactions
  USING gin (to_tsvector('portuguese', description));

CREATE TABLE transaction_splits (
  transaction_id uuid   NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  user_id        uuid   NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
  amount_cents   bigint NOT NULL,
  PRIMARY KEY (transaction_id, user_id)
);

CREATE TABLE categorization_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  match_type   match_type  NOT NULL DEFAULT 'contains',
  pattern      text        NOT NULL,
  category_id  uuid        NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  priority     integer     NOT NULL DEFAULT 100,
  auto_created boolean     NOT NULL DEFAULT false,
  hit_count    integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rules_household ON categorization_rules(household_id, priority);

-- ──────────────────────────── metas e projetos ────────────────────────────

CREATE TABLE goals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id         uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name                 text        NOT NULL,
  description          text,
  kind                 goal_kind   NOT NULL DEFAULT 'other',
  target_amount_cents  bigint      NOT NULL CHECK (target_amount_cents > 0),
  initial_amount_cents bigint      NOT NULL DEFAULT 0,
  target_date          date,
  linked_account_id    uuid        REFERENCES accounts(id) ON DELETE SET NULL,
  monthly_target_cents bigint,
  priority             smallint    NOT NULL DEFAULT 1,
  status               goal_status NOT NULL DEFAULT 'active',
  color                text        NOT NULL DEFAULT '#10B981',
  icon                 text        NOT NULL DEFAULT 'target',
  created_by_user_id   uuid        NOT NULL REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_goals_household ON goals(household_id, status, priority);

CREATE TABLE goal_contributions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid        NOT NULL REFERENCES households(id)  ON DELETE CASCADE,
  goal_id        uuid        NOT NULL REFERENCES goals(id)       ON DELETE CASCADE,
  user_id        uuid        NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  amount_cents   bigint      NOT NULL,   -- negativo = resgate
  contributed_at date        NOT NULL,
  transaction_id uuid        REFERENCES transactions(id) ON DELETE SET NULL,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_contrib_goal      ON goal_contributions(goal_id, contributed_at);
CREATE INDEX idx_contrib_household ON goal_contributions(household_id, contributed_at);

ALTER TABLE transactions
  ADD CONSTRAINT fk_tx_goal FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL;

-- ───────────────────────────── importação e IA ─────────────────────────────

CREATE TABLE import_batches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id       uuid          NOT NULL REFERENCES households(id)   ON DELETE CASCADE,
  created_by_user_id uuid          NOT NULL REFERENCES users(id),
  account_id         uuid          REFERENCES accounts(id)              ON DELETE SET NULL,
  credit_card_id     uuid          REFERENCES credit_cards(id)          ON DELETE SET NULL,
  filename           text          NOT NULL,
  file_hash          text          NOT NULL,   -- sha256: reimportar é no-op
  format             import_format NOT NULL,
  status             import_status NOT NULL DEFAULT 'processing',
  total_rows         integer       NOT NULL DEFAULT 0,
  imported_count     integer       NOT NULL DEFAULT 0,
  duplicate_count    integer       NOT NULL DEFAULT 0,
  error_count        integer       NOT NULL DEFAULT 0,
  statement_start    date,
  statement_end      date,
  error_log          jsonb,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT uq_import_file UNIQUE (household_id, file_hash)
);
CREATE INDEX idx_imports_household ON import_batches(household_id, created_at DESC);

ALTER TABLE transactions
  ADD CONSTRAINT fk_tx_import FOREIGN KEY (import_batch_id)
  REFERENCES import_batches(id) ON DELETE SET NULL;

CREATE TABLE ai_insights (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  reference_month date        NOT NULL,
  payload         jsonb       NOT NULL,
  model           text        NOT NULL,
  input_tokens    integer     NOT NULL DEFAULT 0,
  output_tokens   integer     NOT NULL DEFAULT 0,
  generated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_insight_month UNIQUE (household_id, reference_month)
);

CREATE TABLE audit_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid,
  user_id      uuid,
  action       text        NOT NULL,
  entity       text,
  entity_id    uuid,
  metadata     jsonb,
  ip           text,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_household ON audit_logs(household_id, created_at DESC);

-- ─────────────────────────── updated_at automático ───────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','households','accounts','credit_cards','card_statements',
    'merchants','transactions','goals'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;
END $$;

COMMIT;
