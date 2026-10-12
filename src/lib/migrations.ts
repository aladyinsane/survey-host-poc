// Append-only. Never edit a migration that has shipped; add a new one.
export const migrations: { id: string; sql: string }[] = [
  {
    id: "001_init",
    sql: `
      CREATE TABLE responses (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        survey_id     text NOT NULL,
        token_hash    bytea NOT NULL UNIQUE,
        org_name      text NOT NULL,
        status        text NOT NULL DEFAULT 'in_progress'
                      CHECK (status IN ('in_progress', 'submitted', 'revoked')),
        answers_enc   bytea,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        submitted_at  timestamptz,
        expires_at    timestamptz NOT NULL DEFAULT now() + interval '90 days',
        CHECK (octet_length(token_hash) = 32),
        -- A submitted response always has its answers and a timestamp.
        CHECK (status <> 'submitted' OR (answers_enc IS NOT NULL AND submitted_at IS NOT NULL))
      );

      -- Never holds answers or tokens.
      CREATE TABLE audit_log (
        id          bigserial PRIMARY KEY,
        at          timestamptz NOT NULL DEFAULT now(),
        event       text NOT NULL,
        response_id uuid,
        detail      jsonb
      );
    `,
  },
  {
    id: "002_immutability_guards",
    sql: `
      -- Finished and revoked records cannot be changed back, and nothing is deleted, even by a
      -- future application bug. (A database administrator can still drop these triggers.)
      CREATE FUNCTION responses_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'responses cannot be deleted';
        END IF;
        IF OLD.status = 'submitted' AND (
             NEW.status <> 'submitted'
             OR NEW.answers_enc IS DISTINCT FROM OLD.answers_enc
             OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
             OR NEW.org_name IS DISTINCT FROM OLD.org_name) THEN
          RAISE EXCEPTION 'submitted responses are immutable';
        END IF;
        IF OLD.status = 'revoked' AND NEW.status <> 'revoked' THEN
          RAISE EXCEPTION 'revoked responses cannot be restored';
        END IF;
        RETURN NEW;
      END $$;

      CREATE TRIGGER responses_guard BEFORE UPDATE OR DELETE ON responses
        FOR EACH ROW EXECUTE FUNCTION responses_guard();

      CREATE FUNCTION audit_log_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'audit_log is append-only';
      END $$;

      CREATE TRIGGER audit_log_guard BEFORE UPDATE OR DELETE ON audit_log
        FOR EACH ROW EXECUTE FUNCTION audit_log_guard();
    `,
  },
  {
    id: "003_email_signin",
    sql: `
      -- Responses are owned by an email address instead of a link (ADR-0003).
      ALTER TABLE responses
        ADD COLUMN owner_email_hash bytea
          CHECK (owner_email_hash IS NULL OR octet_length(owner_email_hash) = 32),
        ADD COLUMN owner_email_enc bytea,
        ADD COLUMN npi text CHECK (npi IS NULL OR npi ~ '^[0-9]{10}$'),
        ADD COLUMN version integer NOT NULL DEFAULT 0;
      -- Kept only for rows created before this migration.
      ALTER TABLE responses ALTER COLUMN token_hash DROP NOT NULL;
      -- Replaced by the survey-wide close date (SURVEY_CLOSES_AT).
      ALTER TABLE responses ALTER COLUMN expires_at DROP NOT NULL, ALTER COLUMN expires_at DROP DEFAULT;

      CREATE UNIQUE INDEX responses_one_per_owner ON responses (survey_id, owner_email_hash)
        WHERE status <> 'revoked' AND owner_email_hash IS NOT NULL;
      CREATE INDEX responses_npi ON responses (survey_id, npi) WHERE status <> 'revoked';

      -- One live code per address; a new request replaces the row, which kills the old code.
      CREATE TABLE signin_codes (
        email_hash bytea PRIMARY KEY,
        code_hash  bytea NOT NULL,
        attempts   integer NOT NULL DEFAULT 0,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      -- Only the SHA-256 of the session id is stored.
      CREATE TABLE respondent_sessions (
        id_hash      bytea PRIMARY KEY,
        email_hash   bytea NOT NULL,
        email_enc    bytea NOT NULL,
        idle_seconds integer NOT NULL,
        created_at   timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        expires_at   timestamptz NOT NULL,
        ended_at     timestamptz
      );
      CREATE INDEX respondent_sessions_email ON respondent_sessions (email_hash);

      CREATE TABLE rate_limits (
        key          text PRIMARY KEY,
        window_start timestamptz NOT NULL,
        count        integer NOT NULL
      );

      -- Same guard as 002, now also freezing the owner and NPI of submitted responses.
      CREATE OR REPLACE FUNCTION responses_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'responses cannot be deleted';
        END IF;
        IF OLD.status = 'submitted' AND (
             NEW.status <> 'submitted'
             OR NEW.answers_enc IS DISTINCT FROM OLD.answers_enc
             OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
             OR NEW.org_name IS DISTINCT FROM OLD.org_name
             OR NEW.owner_email_hash IS DISTINCT FROM OLD.owner_email_hash
             OR NEW.owner_email_enc IS DISTINCT FROM OLD.owner_email_enc
             OR NEW.npi IS DISTINCT FROM OLD.npi) THEN
          RAISE EXCEPTION 'submitted responses are immutable';
        END IF;
        IF OLD.status = 'revoked' AND NEW.status <> 'revoked' THEN
          RAISE EXCEPTION 'revoked responses cannot be restored';
        END IF;
        RETURN NEW;
      END $$;
    `,
  },
];
