-- Apply after 001. Existing rooms inherit their latest member heartbeat.
begin;
alter table hot_private.rooms add column last_activity_at timestamptz;
update hot_private.rooms r set last_activity_at=coalesce(
  (select max((p->>'seen')::timestamptz) from jsonb_array_elements(r.state->'players') p),r.created_at);
alter table hot_private.rooms alter column last_activity_at set default now();
alter table hot_private.rooms alter column last_activity_at set not null;
create index rooms_last_activity on hot_private.rooms(last_activity_at);

create function hot_private.prune_lobby(s jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare people jsonb; replacement text;
begin
  if s->>'phase'<>'lobby' then return s; end if;
  select coalesce(jsonb_agg(p order by ord),'[]'::jsonb) into people
    from jsonb_array_elements(s->'players') with ordinality t(p,ord)
    where (p->>'seen')::timestamptz>now()-interval '10 minutes';
  s:=jsonb_set(s,'{players}',people);
  if not exists(select 1 from jsonb_array_elements(people) p where p->>'id'=s->>'host') then
    select p->>'id' into replacement from jsonb_array_elements(people) with ordinality t(p,ord)
      order by ((p->>'seen')::timestamptz>now()-interval '30 seconds') desc,ord limit 1;
    s:=jsonb_set(s,'{host}',to_jsonb(coalesce(replacement,'')));
  end if;
  return s;
end $$;

-- Keep the existing scoring/state machine private behind lifecycle checks.
alter function public.hot_game(text,text,jsonb) rename to hot_game_core;
alter function public.hot_game_core(text,text,jsonb) set schema hot_private;
revoke all on function hot_private.hot_game_core(text,text,jsonb) from public,anon,authenticated;

create function public.hot_game(p_action text,p_code text default '',p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid text:=auth.uid()::text; v_code text:=upper(trim(p_code)); r hot_private.rooms;
  s jsonb; member jsonb; idx int; replacement text; result jsonb;
begin
  if uid is null then raise exception 'Please sign in anonymously first.'; end if;
  if p_action not in ('create','join','sync','resume','leave','start','next','answer','vote') then raise exception 'Unknown action.'; end if;
  if p_action='create' then return hot_private.hot_game_core(p_action,p_code,p_payload); end if;
  if v_code !~ '^[A-Z0-9]{6}$' then raise exception 'Enter a six-character room code.'; end if;
  select * into r from hot_private.rooms where code=v_code for update;
  if not found then return jsonb_build_object('unavailable','Room closed or expired. Create or join another room.'); end if;
  if r.last_activity_at<=now()-interval '1 hour' then
    delete from hot_private.rooms where code=v_code;
    return jsonb_build_object('unavailable','This room expired after one hour of inactivity.');
  end if;
  s:=hot_private.prune_lobby(r.state);
  if jsonb_array_length(s->'players')=0 then
    delete from hot_private.rooms where code=v_code;
    return jsonb_build_object('unavailable','This lobby closed because all players left or timed out.');
  end if;
  select p,(ord-1)::int into member,idx from jsonb_array_elements(s->'players') with ordinality t(p,ord) where p->>'id'=uid;
  if p_action='leave' then
    -- Idempotent retries must not remove someone else's slot or extend room life.
    if member is null or coalesce((member->>'left')::boolean,false) then return jsonb_build_object('left',true); end if;
    if s->>'phase'='lobby' then
      s:=jsonb_set(s,'{players}',(s->'players')-idx);
      if jsonb_array_length(s->'players')=0 or (s->>'host'=uid and not exists(
        select 1 from jsonb_array_elements(s->'players') p where (p->>'seen')::timestamptz>now()-interval '30 seconds')) then
        delete from hot_private.rooms where code=v_code;
        return jsonb_build_object('left',true);
      end if;
    else
      s:=jsonb_set(s,array['players',idx::text,'left'],'true');
      s:=jsonb_set(s,array['players',idx::text,'seen'],to_jsonb(now()-interval '31 seconds'));
    end if;
    if s->>'host'=uid then
      select p->>'id' into replacement from jsonb_array_elements(s->'players') with ordinality t(p,ord)
        where p->>'id'<>uid and (p->>'seen')::timestamptz>now()-interval '30 seconds' order by ord limit 1;
      if replacement is not null then s:=jsonb_set(s,'{host}',to_jsonb(replacement)); end if;
    end if;
    update hot_private.rooms set state=s,last_activity_at=now() where code=v_code;
    return jsonb_build_object('left',true,'phase',s->>'phase');
  end if;
  if member is null and p_action<>'join' then
    return jsonb_build_object('unavailable','Join this room again if the lobby is still open. Your slot may have timed out.');
  end if;
  if coalesce((member->>'left')::boolean,false) and p_action not in ('join','resume') then
    return jsonb_build_object('departed',true);
  end if;
  if member is not null then s:=jsonb_set(s,array['players',idx::text,'left'],'false'); end if;
  update hot_private.rooms set state=s where code=v_code;
  result:=hot_private.hot_game_core(case when p_action='resume' then 'sync' else p_action end,v_code,p_payload);
  update hot_private.rooms set last_activity_at=now() where code=v_code;
  return result;
end $$;
revoke all on function public.hot_game(text,text,jsonb) from public,anon;
grant execute on function public.hot_game(text,text,jsonb) to authenticated;

create function hot_private.cleanup_rooms() returns void
language plpgsql security definer set search_path='' as $$
declare r hot_private.rooms; s jsonb;
begin
  -- Same row locks as requests; skip busy rooms and catch them next run.
  for r in select * from hot_private.rooms
    where last_activity_at<=now()-interval '1 hour' or state->>'phase'='lobby'
    for update skip locked loop
    if r.last_activity_at<=now()-interval '1 hour' then
      delete from hot_private.rooms where code=r.code;
    elsif r.state->>'phase'='lobby' then
      s:=hot_private.prune_lobby(r.state);
      if jsonb_array_length(s->'players')=0 then delete from hot_private.rooms where code=r.code;
      elsif s is distinct from r.state then update hot_private.rooms set state=s where code=r.code;
      end if;
    end if;
  end loop;
end $$;
revoke all on all functions in schema hot_private from public,anon,authenticated;
commit;
