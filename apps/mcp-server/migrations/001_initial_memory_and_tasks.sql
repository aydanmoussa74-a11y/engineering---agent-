CREATE TABLE IF NOT EXISTS memory_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'project_fact', 'architecture_decision', 'evidence', 'outcome', 'preference', 'known_issue'
  )),
  content text NOT NULL,
  source_ref text,
  confidence text NOT NULL CHECK (confidence IN ('observed', 'documented', 'inferred', 'unverified')),
  created_at timestamptz NOT NULL DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED
);

CREATE INDEX IF NOT EXISTS memory_records_scope_created_idx
  ON memory_records (tenant_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_records_search_idx
  ON memory_records USING gin (search_vector);

CREATE TABLE IF NOT EXISTS agent_tasks (
  tenant_id text NOT NULL,
  task_id text NOT NULL,
  project_id text NOT NULL,
  goal text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'queued', 'investigating', 'planning', 'awaiting_approval', 'executing',
    'verifying', 'completed', 'paused', 'blocked', 'failed', 'cancelled'
  )),
  checkpoint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, task_id)
);

CREATE INDEX IF NOT EXISTS agent_tasks_scope_updated_idx
  ON agent_tasks (tenant_id, project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS task_events (
  id bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  task_id text NOT NULL,
  status text NOT NULL,
  checkpoint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_events_scope_task_idx
  ON task_events (tenant_id, task_id, id DESC);
