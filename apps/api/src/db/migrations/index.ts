/**
 * Migrations are TypeScript modules rather than `.sql` files on purpose: `tsc` does not copy
 * non-TS assets into `dist/`, so shipping SQL as data would mean adding a copy step to the
 * build and a matching COPY to the Dockerfile. Keeping them as exported strings means the
 * compiled output and the container image are correct by construction.
 *
 * Each migration is applied exactly once, in id order, inside a transaction.
 */

export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly sql: string;
}

const initial: Migration = {
  id: 1,
  name: 'initial_schema',
  sql: /* sql */ `
    CREATE TABLE sites (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL UNIQUE,
      kind          TEXT NOT NULL CHECK (kind IN ('solar', 'battery', 'hybrid')),
      capacity_mw   REAL NOT NULL CHECK (capacity_mw > 0),
      energy_mwh    REAL          CHECK (energy_mwh IS NULL OR energy_mwh > 0),
      region        TEXT NOT NULL,
      timezone      TEXT NOT NULL,
      grid_operator TEXT NOT NULL
    );

    CREATE TABLE alerts (
      id              TEXT PRIMARY KEY,
      site_id         TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      asset_id        TEXT,
      -- The set of alert types is enforced by Zod at every write boundary rather than by a
      -- CHECK constraint: adding a type should be a code change, not a schema migration.
      -- The read-side hydration schema still rejects anything unexpected that reaches the
      -- table by another route.
      type            TEXT NOT NULL,
      severity        TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
      status          TEXT NOT NULL CHECK (status IN ('new', 'acknowledged', 'in_progress', 'resolved', 'dismissed')),
      title           TEXT NOT NULL CHECK (length(trim(title)) > 0),
      description     TEXT NOT NULL CHECK (length(trim(description)) > 0),
      metrics         TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metrics)),
      detected_at     TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      acknowledged_at TEXT,
      resolved_at     TEXT,
      assignee        TEXT,
      source          TEXT NOT NULL,
      version         INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
    );

    CREATE INDEX idx_alerts_status      ON alerts(status);
    CREATE INDEX idx_alerts_severity    ON alerts(severity);
    CREATE INDEX idx_alerts_site        ON alerts(site_id);
    CREATE INDEX idx_alerts_type        ON alerts(type);
    CREATE INDEX idx_alerts_detected_at ON alerts(detected_at DESC);

    CREATE TABLE alert_notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id   TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
      author     TEXT NOT NULL CHECK (length(trim(author)) > 0),
      body       TEXT NOT NULL CHECK (length(trim(body)) > 0),
      created_at TEXT NOT NULL
    );

    CREATE INDEX idx_notes_alert ON alert_notes(alert_id, created_at);

    -- Append-only audit trail. Every status change, note and generated insight lands here,
    -- which is what makes "record follow-up actions" auditable rather than just editable.
    CREATE TABLE alert_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id    TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL,
      from_status TEXT,
      to_status   TEXT,
      actor       TEXT NOT NULL,
      detail      TEXT,
      created_at  TEXT NOT NULL
    );

    CREATE INDEX idx_events_alert ON alert_events(alert_id, created_at);

    -- Cached model output plus the provenance needed to audit it later.
    CREATE TABLE ai_insights (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id        TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
      provider        TEXT NOT NULL,
      model           TEXT NOT NULL,
      payload         TEXT NOT NULL CHECK (json_valid(payload)),
      degraded        INTEGER NOT NULL DEFAULT 0 CHECK (degraded IN (0, 1)),
      degraded_reason TEXT,
      warnings        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(warnings)),
      rule_baseline   TEXT NOT NULL CHECK (json_valid(rule_baseline)),
      disagreement    TEXT NOT NULL CHECK (json_valid(disagreement)),
      latency_ms      INTEGER NOT NULL CHECK (latency_ms >= 0),
      generated_at    TEXT NOT NULL,
      prompt_hash     TEXT NOT NULL,
      -- Hash of the alert content the answer describes. When the alert or its notes change
      -- this no longer matches, so a stale summary can never be served for new facts.
      content_hash    TEXT NOT NULL
    );

    CREATE INDEX idx_insights_alert ON ai_insights(alert_id, generated_at DESC);

    -- Operator verdict on a generated insight. Persisted so the quality of the AI feature can
    -- be measured against real usage instead of guessed at.
    CREATE TABLE insight_feedback (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      insight_id INTEGER NOT NULL REFERENCES ai_insights(id) ON DELETE CASCADE,
      helpful    INTEGER NOT NULL CHECK (helpful IN (0, 1)),
      comment    TEXT,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX idx_feedback_insight ON insight_feedback(insight_id);
  `,
};

export const MIGRATIONS: readonly Migration[] = [initial];
