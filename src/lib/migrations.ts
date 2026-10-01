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
];
