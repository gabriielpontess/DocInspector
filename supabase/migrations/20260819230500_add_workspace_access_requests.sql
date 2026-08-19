create table public.docinspector_workspace_access_codes (
  workspace_id uuid primary key references public.sky17_workspaces(id) on delete cascade,
  request_code text not null default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint docinspector_workspace_access_codes_code_format
    check (request_code ~ '^[0-9A-F]{12}$'),
  constraint docinspector_workspace_access_codes_code_unique
    unique (request_code)
);

insert into public.docinspector_workspace_access_codes (workspace_id)
select id
from public.sky17_workspaces
on conflict (workspace_id) do nothing;

create table public.docinspector_access_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.sky17_workspaces(id) on delete cascade,
  email text not null,
  display_name text not null,
  message text,
  status text not null default 'PENDING',
  source_origin text,
  handled_by uuid references auth.users(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint docinspector_access_requests_email_format
    check (
      email = lower(btrim(email))
      and char_length(email) between 3 and 254
      and position('@' in email) > 1
    ),
  constraint docinspector_access_requests_display_name_length
    check (char_length(btrim(display_name)) between 2 and 120),
  constraint docinspector_access_requests_message_length
    check (message is null or char_length(message) <= 500),
  constraint docinspector_access_requests_origin_length
    check (source_origin is null or char_length(source_origin) <= 255),
  constraint docinspector_access_requests_status_check
    check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  constraint docinspector_access_requests_handled_state
    check (
      (status = 'PENDING' and handled_at is null and handled_by is null)
      or (status <> 'PENDING' and handled_at is not null)
    )
);

create unique index docinspector_access_requests_pending_email_idx
  on public.docinspector_access_requests (workspace_id, lower(email))
  where status = 'PENDING';

create index docinspector_access_requests_workspace_created_idx
  on public.docinspector_access_requests (workspace_id, created_at desc);

alter table public.docinspector_workspace_access_codes enable row level security;
alter table public.docinspector_access_requests enable row level security;

revoke all on table public.docinspector_workspace_access_codes from public, anon, authenticated;
revoke all on table public.docinspector_access_requests from public, anon, authenticated;

create trigger docinspector_workspace_access_codes_touch_updated_at
before update on public.docinspector_workspace_access_codes
for each row execute function private.docinspector_touch_updated_at();

create trigger docinspector_access_requests_touch_updated_at
before update on public.docinspector_access_requests
for each row execute function private.docinspector_touch_updated_at();
