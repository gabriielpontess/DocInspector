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

create or replace function private.docinspector_seed_workspace_access_code()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.docinspector_workspace_access_codes (workspace_id)
  values (new.id)
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;

revoke all on function private.docinspector_seed_workspace_access_code() from public, anon, authenticated;

drop trigger if exists docinspector_workspace_access_code_seed on public.sky17_workspaces;
create trigger docinspector_workspace_access_code_seed
after insert on public.sky17_workspaces
for each row execute function private.docinspector_seed_workspace_access_code();

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
  processing_token uuid,
  processing_started_at timestamptz,
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
    check (status in ('PENDING', 'PROCESSING', 'APPROVED', 'REJECTED')),
  constraint docinspector_access_requests_handled_state
    check (
      (
        status = 'PENDING'
        and handled_at is null
        and handled_by is null
        and processing_token is null
        and processing_started_at is null
      )
      or (
        status = 'PROCESSING'
        and handled_at is null
        and processing_token is not null
        and processing_started_at is not null
      )
      or (
        status in ('APPROVED', 'REJECTED')
        and handled_at is not null
        and processing_token is null
        and processing_started_at is null
      )
    )
);

create unique index docinspector_access_requests_active_email_idx
  on public.docinspector_access_requests (workspace_id, lower(email))
  where status in ('PENDING', 'PROCESSING');

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
