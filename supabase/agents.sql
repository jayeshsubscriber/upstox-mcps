-- Upstox agents prototype: its own corner of the Scanners project.
--
-- One table, closed to everyone (RLS on, no policies, no grants). The app
-- reaches it only through the functions below, which it calls with the public
-- anon key plus its own server key (AGENTS_DB_KEY), checked against the Vault
-- secret 'agents_server_key'. The anon key alone gets nothing, and the app
-- never holds the project's service-role key.
--
-- Rows: one per person (their email) and kind: 'state' (agents, requests,
-- activity), 'chat', 'upstox' (tokens, AES-GCM sealed by the app), 'user'
-- (PIN hash), 'usage:<day>'. A lease lock on a row makes a change atomic
-- across server instances; 'chat' uses it as "still answering".
--
-- Create the server key once (it is not in this file):
--   select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'agents_server_key',
--     'Upstox agents prototype: AGENTS_DB_KEY on Vercel');
-- Read it for Vercel:
--   select decrypted_secret from vault.decrypted_secrets where name = 'agents_server_key';

create table if not exists public.agents_kv (
  user_id text not null,
  kind text not null,
  value jsonb,
  lock_owner text,
  lock_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);
alter table public.agents_kv enable row level security;
revoke all on table public.agents_kv from public, anon, authenticated;

-- The gate every function goes through.
create or replace function public.agents_check(p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'agents_server_key' limit 1;
  if k is null or p_key is null or p_key <> k then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end $$;

create or replace function public.agents_get(p_key text, p_user text, p_kind text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.agents_kv;
begin
  perform public.agents_check(p_key);
  select * into r from public.agents_kv where user_id = p_user and kind = p_kind;
  if not found then
    return jsonb_build_object('value', null, 'locked', false);
  end if;
  return jsonb_build_object('value', r.value, 'locked', coalesce(r.lock_until > now(), false));
end $$;

-- Plain write, no lock (tokens, sign-in records).
create or replace function public.agents_put(p_key text, p_user text, p_kind text, p_value jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.agents_check(p_key);
  insert into public.agents_kv (user_id, kind, value, updated_at) values (p_user, p_kind, p_value, now())
  on conflict (user_id, kind) do update set value = excluded.value, updated_at = now();
end $$;

-- Takes the row's lease if it's free (or expired, or already ours). Returns {ok, value}.
create or replace function public.agents_lock(p_key text, p_user text, p_kind text, p_owner text, p_ms integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v jsonb;
begin
  perform public.agents_check(p_key);
  insert into public.agents_kv (user_id, kind) values (p_user, p_kind) on conflict (user_id, kind) do nothing;
  update public.agents_kv
     set lock_owner = p_owner, lock_until = now() + make_interval(secs => p_ms / 1000.0)
   where user_id = p_user and kind = p_kind
     and (lock_until is null or lock_until < now() or lock_owner = p_owner)
  returning value into v;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'value', v);
end $$;

-- Saves (when p_save) and releases, only if the lease is still ours. Returns whether it was.
create or replace function public.agents_unlock(p_key text, p_user text, p_kind text, p_owner text, p_value jsonb, p_save boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  ok boolean;
begin
  perform public.agents_check(p_key);
  update public.agents_kv
     set value = case when p_save then p_value else value end,
         updated_at = case when p_save then now() else updated_at end,
         lock_owner = null,
         lock_until = null
   where user_id = p_user and kind = p_kind and lock_owner = p_owner
  returning true into ok;
  return coalesce(ok, false);
end $$;

-- Counts one Claude use of p_what today for the person and for everyone ('*').
-- Refuses past p_limit for the person or p_all_limit in all (0 = no limit).
create or replace function public.agents_use(p_key text, p_user text, p_day text, p_what text, p_limit integer, p_all_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  k text := 'usage:' || p_day;
  mine integer;
  total integer;
begin
  perform public.agents_check(p_key);
  insert into public.agents_kv (user_id, kind, value) values ('*', k, '{}'::jsonb), (p_user, k, '{}'::jsonb)
  on conflict (user_id, kind) do nothing;
  perform 1 from public.agents_kv where kind = k and user_id in ('*', p_user) order by user_id for update;
  select coalesce((value ->> 'claude')::integer, 0) into total from public.agents_kv where user_id = '*' and kind = k;
  select coalesce((value ->> p_what)::integer, 0) into mine from public.agents_kv where user_id = p_user and kind = k;
  if p_all_limit > 0 and total >= p_all_limit then
    return jsonb_build_object('ok', false, 'used', mine, 'allFull', true);
  end if;
  if p_limit > 0 and mine >= p_limit then
    return jsonb_build_object('ok', false, 'used', mine);
  end if;
  update public.agents_kv set value = jsonb_set(coalesce(value, '{}'::jsonb), '{claude}', to_jsonb(total + 1)), updated_at = now()
   where user_id = '*' and kind = k;
  update public.agents_kv set value = jsonb_set(coalesce(value, '{}'::jsonb), array[p_what], to_jsonb(mine + 1)), updated_at = now()
   where user_id = p_user and kind = k;
  return jsonb_build_object('ok', true, 'used', mine + 1);
end $$;

-- Gives back one use that didn't get an answer (Claude refused the key, was down...). Never below 0.
create or replace function public.agents_refund(p_key text, p_user text, p_day text, p_what text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k text := 'usage:' || p_day;
begin
  perform public.agents_check(p_key);
  update public.agents_kv
     set value = jsonb_set(value, array[p_what], to_jsonb(greatest(coalesce((value ->> p_what)::integer, 0) - 1, 0))), updated_at = now()
   where user_id = p_user and kind = k and value ? p_what;
  update public.agents_kv
     set value = jsonb_set(value, '{claude}', to_jsonb(greatest(coalesce((value ->> 'claude')::integer, 0) - 1, 0))), updated_at = now()
   where user_id = '*' and kind = k and value ? 'claude';
end $$;

-- Only the anon role may call the entry points (with the server key); nobody calls the gate directly.
revoke all on function public.agents_check(text) from public, anon, authenticated;
revoke all on function public.agents_get(text, text, text) from public, anon, authenticated;
revoke all on function public.agents_put(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.agents_lock(text, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.agents_unlock(text, text, text, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.agents_use(text, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.agents_refund(text, text, text, text) from public, anon, authenticated;
grant execute on function public.agents_get(text, text, text) to anon;
grant execute on function public.agents_put(text, text, text, jsonb) to anon;
grant execute on function public.agents_lock(text, text, text, text, integer) to anon;
grant execute on function public.agents_unlock(text, text, text, text, jsonb, boolean) to anon;
grant execute on function public.agents_use(text, text, text, text, integer, integer) to anon;
grant execute on function public.agents_refund(text, text, text, text) to anon;
