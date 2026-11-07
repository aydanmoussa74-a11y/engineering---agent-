ALTER TABLE agent_tasks
  ADD COLUMN IF NOT EXISTS plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS acceptance_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS current_step text,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS approval_state text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS result jsonb,
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE agent_tasks
  ADD CONSTRAINT agent_tasks_attempt_count_check CHECK (attempt_count >= 0),
  ADD CONSTRAINT agent_tasks_max_attempts_check CHECK (max_attempts BETWEEN 1 AND 10),
  ADD CONSTRAINT agent_tasks_approval_state_check CHECK (approval_state IN ('not_required', 'pending', 'approved', 'rejected'));

ALTER TABLE task_events
  ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'checkpoint',
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS agent_skills (
  tenant_id text NOT NULL,
  skill_id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'installed' CHECK (status IN ('installed', 'enabled', 'disabled', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, skill_id),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS agent_skill_versions (
  tenant_id text NOT NULL,
  skill_id uuid NOT NULL,
  version text NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  content text NOT NULL,
  manifest jsonb NOT NULL,
  dependencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  requested_permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, skill_id, version),
  FOREIGN KEY (tenant_id, skill_id) REFERENCES agent_skills(tenant_id, skill_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_skill_permissions (
  tenant_id text NOT NULL,
  skill_id uuid NOT NULL,
  version text NOT NULL,
  permission_scope text NOT NULL,
  approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, skill_id, version, permission_scope),
  FOREIGN KEY (tenant_id, skill_id, version)
    REFERENCES agent_skill_versions(tenant_id, skill_id, version) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_skill_events (
  id bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  skill_id uuid NOT NULL,
  version text,
  event_type text NOT NULL CHECK (event_type IN ('installed', 'enabled', 'disabled', 'version_added', 'archived', 'permission_requested', 'permission_approved', 'permission_rejected')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_skills_scope_status_idx
  ON agent_skills (tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS agent_skill_versions_lookup_idx
  ON agent_skill_versions (tenant_id, skill_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_skill_events_lookup_idx
  ON agent_skill_events (tenant_id, skill_id, id DESC);
CREATE INDEX IF NOT EXISTS agent_tasks_execution_idx
  ON agent_tasks (tenant_id, status, updated_at DESC);

INSERT INTO schema_migrations(version)
VALUES ('002_skills_registry_and_execution.sql')
ON CONFLICT (version) DO NOTHING;
