CREATE TABLE IF NOT EXISTS change_proposals (
  tenant_id text NOT NULL,
  proposal_id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id text,
  project_id text NOT NULL,
  repository text NOT NULL,
  branch_name text NOT NULL,
  base_commit text NOT NULL,
  patch text NOT NULL,
  patch_sha256 text NOT NULL,
  changed_paths jsonb NOT NULL,
  proposed_checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','superseded')),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  decided_by text,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,proposal_id),
  CHECK (repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  CHECK (base_commit ~ '^[a-f0-9]{40}$'),
  CHECK (patch_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (length(patch) <= 100000)
);

CREATE INDEX IF NOT EXISTS change_proposals_project_created_idx
  ON change_proposals (tenant_id,project_id,created_at DESC);
CREATE INDEX IF NOT EXISTS change_proposals_status_expiry_idx
  ON change_proposals (tenant_id,status,expires_at);

INSERT INTO schema_migrations(version)
VALUES ('004_change_proposals.sql')
ON CONFLICT (version) DO NOTHING;
