alter table public.billing_cycles
  add column if not exists status_change_reason text;

create table if not exists public.billing_cycle_audit_log (
  id uuid primary key default gen_random_uuid(),
  billing_cycle_id uuid references public.billing_cycles(id) on delete set null,
  branch_id uuid not null references public.branches(id),
  resident_id uuid not null references public.residents(id),
  billing_month text not null,
  action text not null check (action in ('CLOSED', 'UNLOCKED')),
  previous_is_locked boolean not null,
  new_is_locked boolean not null,
  reason text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists billing_cycle_audit_log_branch_month_idx
  on public.billing_cycle_audit_log (branch_id, billing_month, changed_at desc);

create index if not exists billing_cycle_audit_log_resident_idx
  on public.billing_cycle_audit_log (resident_id, changed_at desc);

alter table public.billing_cycle_audit_log enable row level security;

revoke all on table public.billing_cycle_audit_log from anon;
revoke insert, update, delete on table public.billing_cycle_audit_log from authenticated;
grant select on table public.billing_cycle_audit_log to authenticated;

drop policy if exists billing_cycle_audit_log_select_admin_branch
  on public.billing_cycle_audit_log;

create policy billing_cycle_audit_log_select_admin_branch
  on public.billing_cycle_audit_log
  for select
  to authenticated
  using (
    (select public.is_super_admin())
    or (
      (select public.auth_role()) = 'admin'
      and branch_id = (select public.auth_branch_id())
    )
  );

create or replace function public.audit_billing_cycle_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_previous_locked boolean;
  v_action text;
  v_reason text;
begin
  v_previous_locked := case when tg_op = 'INSERT' then false else old.is_locked end;

  if new.is_locked is not distinct from v_previous_locked then
    return new;
  end if;

  v_action := case when new.is_locked then 'CLOSED' else 'UNLOCKED' end;
  v_reason := nullif(trim(coalesce(new.status_change_reason, '')), '');

  if v_reason is null then
    v_reason := case
      when new.is_locked then 'Billing cycle closed after confirmation'
      else 'Reason not supplied by legacy client'
    end;
  end if;

  insert into public.billing_cycle_audit_log (
    billing_cycle_id,
    branch_id,
    resident_id,
    billing_month,
    action,
    previous_is_locked,
    new_is_locked,
    reason,
    changed_by,
    changed_at
  ) values (
    new.id,
    new.branch_id,
    new.resident_id,
    new.billing_month,
    v_action,
    v_previous_locked,
    new.is_locked,
    v_reason,
    coalesce((select auth.uid()), new.locked_by),
    now()
  );

  return new;
end;
$function$;

revoke all on function public.audit_billing_cycle_status_change() from public;
revoke all on function public.audit_billing_cycle_status_change() from anon;
revoke all on function public.audit_billing_cycle_status_change() from authenticated;

drop trigger if exists billing_cycle_status_audit_trigger
  on public.billing_cycles;

create trigger billing_cycle_status_audit_trigger
after insert or update of is_locked on public.billing_cycles
for each row
execute function public.audit_billing_cycle_status_change();
