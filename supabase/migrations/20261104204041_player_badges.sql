-- Apply after 004_game_recap.sql. Badges are validated and lobby changes use the room row lock.
begin;
create or replace function public.hot_game(p_action text,p_code text default '',p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid text:=auth.uid()::text; v_code text:=upper(trim(p_code)); r hot_private.rooms;
  s jsonb; member jsonb; idx int; replacement text; result jsonb;
begin
  if uid is null then raise exception 'Please sign in anonymously first.'; end if;
  if p_action not in ('create','join','sync','resume','leave','start','next','answer','vote','badge') then raise exception 'Unknown action.'; end if;
  if p_action in ('create','join','badge') and coalesce(p_payload->>'badge','hot-sauce') not in
    ('hot-wings','hot-breath','hot-honey','hot-sun','hot-sauce','hot-pepper','hot-coffee','hot-potato') then
    raise exception 'Choose one of the eight player icons.';
  end if;
  if p_action='create' then
    result:=hot_private.hot_game_core(p_action,p_code,p_payload);
    v_code:=result->>'code';
    update hot_private.rooms set state=jsonb_set(state,'{players,0,badge}',to_jsonb(coalesce(p_payload->>'badge','hot-sauce')))
      where code=v_code returning state into s;
    return hot_private.snapshot(s,uid,v_code);
  end if;
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
  if p_action='badge' and s->>'phase'='lobby' then
    s:=jsonb_set(s,array['players',idx::text,'badge'],to_jsonb(coalesce(p_payload->>'badge','hot-sauce')));
  end if;
  update hot_private.rooms set state=s where code=v_code;
  result:=hot_private.hot_game_core(case when p_action in ('resume','badge') then 'sync' else p_action end,v_code,p_payload);
  if p_action='join' and member is null then
    select state into s from hot_private.rooms where code=v_code;
    select (ord-1)::int into idx from jsonb_array_elements(s->'players') with ordinality t(p,ord) where p->>'id'=uid;
    s:=jsonb_set(s,array['players',idx::text,'badge'],to_jsonb(coalesce(p_payload->>'badge','hot-sauce')));
    update hot_private.rooms set state=s where code=v_code;
    result:=hot_private.snapshot(s,uid,v_code);
  end if;
  update hot_private.rooms set last_activity_at=now() where code=v_code;
  return result;
end $$;
revoke all on function public.hot_game(text,text,jsonb) from public,anon;
grant execute on function public.hot_game(text,text,jsonb) to authenticated;

create or replace function hot_private.tick(s jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare scored jsonb; highlights jsonb;
begin
  scored:=hot_private.score_tick(s);
  -- Record once, only when votes have been scored and authors can be revealed.
  if s->>'phase' not in ('results','finished') and scored->>'phase' in ('results','finished') then
    select jsonb_agg(jsonb_build_object('id',a->>'id','text',a->>'text','author',p->>'name','badge',coalesce(p->>'badge','hot-sauce')) order by a->>'id')
      into highlights from jsonb_array_elements(scored->'answers') a
      join jsonb_array_elements(scored->'players') p on p->>'id'=a->>'player'
      where (a->>'heat_units')::int=(select max((answer->>'heat_units')::int) from jsonb_array_elements(scored->'answers') answer);
    scored:=scored||jsonb_build_object('history',coalesce(s->'history','[]'::jsonb)||jsonb_build_array(
      jsonb_build_object('round',(scored->>'round')::int,'prompt',scored->>'prompt','takes',highlights)));
  end if;
  return scored;
end $$;

create or replace function hot_private.snapshot(s jsonb,viewer text,room_code text) returns jsonb
language plpgsql set search_path='' as $$
declare result jsonb; people jsonb; answers jsonb; a jsonb; author_badge text;
begin
  result:=hot_private.round_snapshot(s,viewer,room_code);
  select jsonb_agg(v||jsonb_build_object('badge',coalesce(p->>'badge','hot-sauce')) order by ord)
    into people from jsonb_array_elements(result->'players') with ordinality t(v,ord)
    join jsonb_array_elements(s->'players') p on p->>'id'=v->>'id';
  answers:=result->'answers';
  if s->>'phase' in ('results','finished') then
    answers:='[]'::jsonb;
    for a in select value from jsonb_array_elements(result->'answers') loop
      select coalesce(p->>'badge','hot-sauce') into author_badge
        from jsonb_array_elements(s->'answers') original
        join jsonb_array_elements(s->'players') p on p->>'id'=original->>'player'
        where original->>'id'=a->>'id';
      answers:=answers||(a||jsonb_build_object('badge',coalesce(author_badge,'hot-sauce')));
    end loop;
  end if;
  return result||jsonb_build_object('players',people,'answers',answers,
    'history',case when s->>'phase'='finished' then coalesce(s->'history','[]'::jsonb) else '[]'::jsonb end);
end $$;
revoke all on all functions in schema hot_private from public,anon,authenticated;
commit;