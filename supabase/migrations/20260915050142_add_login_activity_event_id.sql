alter table public.login_activity
  add column if not exists event_id uuid;

create unique index if not exists login_activity_event_id_uidx
  on public.login_activity (event_id)
  where event_id is not null;

comment on column public.login_activity.event_id is
  'Client-generated idempotency key used to prevent duplicate successful-login audit entries during retries.';
