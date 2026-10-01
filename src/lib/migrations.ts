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
];
