-- Base schema: workspaces, workspace_members, documents, document_status enum.
-- RLS is enabled in a separate migration so reviewers can read policies independently.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.document_status as enum (
  'pending',
  'processing',
  'complete',
  'failed',
  'needs_review'
);

-- ---------------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- workspace_members
-- ---------------------------------------------------------------------------
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_id_idx
  on public.workspace_members (user_id);

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null,
  filename text not null,
  storage_path text not null unique,
  doc_type text,
  doc_type_confidence numeric,
  status public.document_status not null default 'pending',
  extracted_data jsonb,
  edited_fields jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_doc_type_check
    check (doc_type is null or doc_type in ('w2', '1099_nec', '1099_misc', 'k1', 'unknown'))
);

create index documents_workspace_id_idx
  on public.documents (workspace_id);

create index documents_workspace_id_status_idx
  on public.documents (workspace_id, status);

create index documents_workspace_id_created_at_desc_idx
  on public.documents (workspace_id, created_at desc);
