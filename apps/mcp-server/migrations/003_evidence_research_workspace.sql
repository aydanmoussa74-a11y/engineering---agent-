
CREATE TABLE IF NOT EXISTS research_briefs (
  tenant_id text NOT NULL,
  research_id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id text NOT NULL,
  title text NOT NULL,
  research_question text NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','researching','synthesizing','completed','blocked')),
  synthesis text,
  limitations jsonb NOT NULL DEFAULT '[]'::jsonb,
  unresolved_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,research_id)
);

CREATE TABLE IF NOT EXISTS research_sources (
  tenant_id text NOT NULL,
  source_id uuid NOT NULL DEFAULT gen_random_uuid(),
  research_id uuid NOT NULL,
  url text NOT NULL,
  title text NOT NULL,
  publisher text,
  source_type text NOT NULL CHECK (source_type IN ('official_docs','api_reference','sdk','changelog','repository','technical_article','community_discussion','other')),
  authority_level text NOT NULL CHECK (authority_level IN ('official','primary','secondary','community','unverified')),
  excerpt text NOT NULL DEFAULT '',
  notes text,
  content_sha256 text,
  published_at timestamptz,
  accessed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,source_id),
  UNIQUE (tenant_id,research_id,url),
  FOREIGN KEY (tenant_id,research_id) REFERENCES research_briefs(tenant_id,research_id) ON DELETE CASCADE,
  CHECK (length(excerpt) <= 12000),
  CHECK (url ~ '^https?://')
);

CREATE TABLE IF NOT EXISTS research_claims (
  tenant_id text NOT NULL,
  claim_id uuid NOT NULL DEFAULT gen_random_uuid(),
  research_id uuid NOT NULL,
  claim text NOT NULL,
  classification text NOT NULL CHECK (classification IN ('observed','documented','inferred','unverified')),
  confidence text NOT NULL CHECK (confidence IN ('high','medium','low')),
  source_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  rationale text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,claim_id),
  FOREIGN KEY (tenant_id,research_id) REFERENCES research_briefs(tenant_id,research_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS research_events (
  id bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  research_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('created','source_added','claim_recorded','status_changed','synthesis_saved')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS research_briefs_scope_updated_idx
  ON research_briefs (tenant_id,project_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS research_sources_brief_accessed_idx
  ON research_sources (tenant_id,research_id,accessed_at DESC);
CREATE INDEX IF NOT EXISTS research_claims_brief_created_idx
  ON research_claims (tenant_id,research_id,created_at DESC);
CREATE INDEX IF NOT EXISTS research_events_brief_idx
  ON research_events (tenant_id,research_id,id DESC);

INSERT INTO schema_migrations(version)
VALUES ('003_evidence_research_workspace.sql')
ON CONFLICT (version) DO NOTHING;
