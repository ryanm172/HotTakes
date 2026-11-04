-- Apply after player_badges. Start a fresh game to test the complete new flow.
begin;

alter function hot_private.new_round(jsonb,boolean) rename to new_round_base;
create function hot_private.new_round(s jsonb,increment_round boolean) returns jsonb
language sql set search_path='' as $$
  select hot_private.new_round_base(s-'hotseat',increment_round);
$$;

create function hot_private.finish_round(s jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare people jsonb; highlights jsonb;
begin
  select jsonb_agg(p||jsonb_build_object('score_units',(p->>'score_units')::int+coalesce(
    (select (a->>'point_units')::int from jsonb_array_elements(s->'answers') a where a->>'player'=p->>'id'),0)) order by ord)
    into people from jsonb_array_elements(s->'players') with ordinality t(p,ord);
  select jsonb_agg(jsonb_build_object('id',a->>'id','text',a->>'text','author',p->>'name',
    'badge',coalesce(p->>'badge','hot-sauce')) order by a->>'id') into highlights
    from jsonb_array_elements(s->'answers') a join jsonb_array_elements(s->'players') p on p->>'id'=a->>'player'
    where case when s ? 'hotseat' then coalesce((a->>'hottest')::boolean,false) else
      (a->>'heat_units')::int=(select max((v->>'heat_units')::int) from jsonb_array_elements(s->'answers') v) end;
  return s||jsonb_build_object('players',people,'deadline',null,
    'phase',case when (s->>'round')::int=5 then 'finished' else 'results' end,
    'history',coalesce(s->'history','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
      'round',(s->>'round')::int,'prompt',s->>'prompt','takes',highlights)));
end $$;

create or replace function hot_private.tick(s jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare scored jsonb; candidates jsonb; judges jsonb; h jsonb; counts jsonb;
  people_count int; candidate_count int; pool int; lo int; hi int; survivors int; answers jsonb; entry jsonb; n int;
begin
  if s->>'phase' in ('results','finished') then return s; end if;
  if s->>'phase'='hotseat_speaking' and now()>=(s->>'deadline')::timestamptz then
    h:=s->'hotseat'; n:=(h->>'index')::int+1;
    s:=s||jsonb_build_object('deadline',null,'phase',case when n=jsonb_array_length(h->'order') then 'hotseat_voting' else 'hotseat_ready' end,
      'hotseat',h||jsonb_build_object('index',n));
  end if;
  if s->>'phase'='hotseat_voting' then
    h:=s->'hotseat';
    if (select count(*) from jsonb_object_keys(h->'votes'))<jsonb_array_length(h->'judges') then return s; end if;
    select jsonb_object_agg(id,(select count(*) from jsonb_each_text(h->'votes') v where v.value=id))
      into counts from jsonb_array_elements_text(h->'order') t(id);
    select min(value::int),max(value::int) into lo,hi from jsonb_each_text(counts);
    select count(*) into survivors from jsonb_each_text(counts) where lo=hi or value::int>lo;
    pool:=(h->>'pool_units')::int; answers:='[]'::jsonb;
    for entry in select value from jsonb_array_elements(s->'answers') loop
      if counts ? (entry->>'id') then
        n:=case when lo=hi or (counts->>(entry->>'id'))::int>lo then pool/survivors else 0 end;
        entry:=entry||jsonb_build_object('point_units',n,'points',n/840.0,'defenseVotes',(counts->>(entry->>'id'))::int,
          'hottest',lo=hi or (counts->>(entry->>'id'))::int=lo);
      end if;
      answers:=answers||entry;
    end loop;
    return hot_private.finish_round(s||jsonb_build_object('answers',answers));
  end if;
  if s->>'phase' like 'hotseat_%' then return s; end if;
  scored:=hot_private.score_tick(s);
  if scored->>'phase' not in ('results','finished') then return scored; end if;
  -- The original scorer computes provisional points; restore the unawarded totals.
  scored:=scored||jsonb_build_object('players',s->'players');
  select jsonb_agg(a->>'id' order by random()),sum((a->>'point_units')::int)
    into candidates,pool from jsonb_array_elements(scored->'answers') a
    where (a->>'heat_units')::int=(select max((v->>'heat_units')::int) from jsonb_array_elements(scored->'answers') v);
  select jsonb_agg(p->>'id' order by ord) into judges from jsonb_array_elements(scored->'players') with ordinality t(p,ord)
    where not exists(select 1 from jsonb_array_elements(scored->'answers') a
      where a->>'player'=p->>'id' and candidates ? (a->>'id'));
  candidate_count:=jsonb_array_length(candidates);
  people_count:=jsonb_array_length(coalesce(judges,'[]'::jsonb));
  if candidate_count>1 and people_count>0 and coalesce((s->>'hotseat_enabled')::boolean,false) then
    return scored||jsonb_build_object('phase','hotseat_ready','deadline',null,'note',null,
      'hotseat',jsonb_build_object('order',candidates,'judges',judges,'index',0,'pool_units',pool,'votes','{}'::jsonb));
  end if;
  if candidate_count>1 and people_count=0 and coalesce((s->>'hotseat_enabled')::boolean,false) then scored:=scored||jsonb_build_object('note','Everyone is tied for hottest. No outside judges, so points are shared.'); end if;
  return hot_private.finish_round(scored);
end $$;

create function hot_private.hotseat_action(s jsonb,uid text,action text,payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare h jsonb:=s->'hotseat'; speaker text; target text;
begin
  -- Tokens make retries and delayed clicks harmless across rounds and speakers.
  if (payload->>'round') is distinct from (s->>'round') or (payload->>'prompt') is distinct from (s->>'prompt') then return s; end if;
  if action='hotseat_vote' then
    if s->>'phase'<>'hotseat_voting' then return s; end if;
    if not (h->'judges' ? uid) then raise exception 'Only outside judges can vote on explanations.'; end if;
    if h->'votes' ? uid then raise exception 'Your explanation vote is already locked.'; end if;
    target:=payload->>'candidate';
    if target is null or not (h->'order' ? target) then raise exception 'Choose a Hot Seat contestant.'; end if;
    return jsonb_set(s,array['hotseat','votes',uid],to_jsonb(target));
  end if;
  if (payload->>'speaker') is distinct from (h->'order'->>(h->>'index')::int) then return s; end if;
  if action='hotseat_start' and s->>'phase'='hotseat_ready' then
    if s->>'host'<>uid then raise exception 'Only the host can start a speaking turn.'; end if;
    return s||jsonb_build_object('phase','hotseat_speaking','deadline',now()+interval '60 seconds');
  elsif action='hotseat_done' and s->>'phase'='hotseat_speaking' then
    select a->>'player' into speaker from jsonb_array_elements(s->'answers') a where a->>'id'=payload->>'speaker';
    if uid<>speaker then raise exception 'Only the current speaker can finish early.'; end if;
    return hot_private.tick(s||jsonb_build_object('deadline',now()));
  end if;
  return s;
end $$;

alter function hot_private.snapshot(jsonb,text,text) rename to badge_snapshot;
create function hot_private.snapshot(s jsonb,viewer text,room_code text) returns jsonb
language plpgsql set search_path='' as $$
declare result jsonb; h jsonb:=s->'hotseat'; contestants jsonb; entry jsonb; answers jsonb:='[]'; original jsonb;
  pending boolean:=s->>'phase' like 'hotseat_%';
begin
  result:=hot_private.badge_snapshot(case when pending then s||'{"phase":"results"}'::jsonb else s end,viewer,room_code);
  if h is null then return result; end if;
  select jsonb_agg(jsonb_build_object('id',a->>'id','player',p->>'id','name',p->>'name',
    'badge',coalesce(p->>'badge','hot-sauce'),'text',a->>'text') order by ord) into contestants
    from jsonb_array_elements_text(h->'order') with ordinality t(id,ord)
    join jsonb_array_elements(s->'answers') a on a->>'id'=id
    join jsonb_array_elements(s->'players') p on p->>'id'=a->>'player';
  for entry in select value from jsonb_array_elements(result->'answers') loop
    select v into original from jsonb_array_elements(s->'answers') v where v->>'id'=entry->>'id';
    if pending then entry:=entry-'points';
    elsif original ? 'defenseVotes' then entry:=entry||jsonb_build_object('defenseVotes',original->'defenseVotes','hottest',original->'hottest');
    end if;
    answers:=answers||entry;
  end loop;
  return result||jsonb_build_object('phase',s->>'phase','answers',answers,'deadline',s->'deadline',
    'hotseat',jsonb_build_object('contestants',contestants,'order',h->'order','index',h->'index',
      'pool',(h->>'pool_units')::int/840.0,'judges',h->'judges',
      'submitted',(select coalesce(jsonb_agg(key),'[]'::jsonb) from jsonb_object_keys(h->'votes') key),
      'myVote',h->'votes'->>viewer));
end $$;

create or replace function public.hot_game(p_action text,p_code text default '',p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid text:=auth.uid()::text; v_code text:=upper(trim(p_code)); r hot_private.rooms;
  s jsonb; member jsonb; idx int; replacement text; result jsonb;
begin
  if uid is null then raise exception 'Please sign in anonymously first.'; end if;
  if p_action not in ('create','join','sync','resume','leave','start','next','answer','vote','badge','hotseat_start','hotseat_done','hotseat_vote') then raise exception 'Unknown action.'; end if;
  if p_action in ('create','join','badge') and coalesce(p_payload->>'badge','hot-sauce') not in
    ('hot-wings','hot-breath','hot-honey','hot-sun','hot-sauce','hot-pepper','hot-coffee','hot-potato') then
    raise exception 'Choose one of the eight player icons.';
  end if;
  if p_action='create' then
    result:=hot_private.hot_game_core(p_action,p_code,p_payload);
    v_code:=result->>'code';
    update hot_private.rooms set state=jsonb_set(state,'{players,0,badge}',to_jsonb(coalesce(p_payload->>'badge','hot-sauce')))
      ||jsonb_build_object('hotseat_enabled',coalesce(p_payload->>'hotseat'='true',false))
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
  if p_action in ('hotseat_start','hotseat_done','hotseat_vote') then
    -- Synchronize membership, host transfer and timer expiry before authorizing controls.
    perform hot_private.hot_game_core('sync',v_code,'{}'::jsonb);
    select state into s from hot_private.rooms where code=v_code;
    s:=hot_private.hotseat_action(s,uid,p_action,p_payload);
    update hot_private.rooms set state=s where code=v_code;
  end if;
  result:=hot_private.hot_game_core(case when p_action in ('resume','badge','hotseat_start','hotseat_done','hotseat_vote') then 'sync' else p_action end,v_code,p_payload);
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


revoke all on all functions in schema hot_private from public,anon,authenticated;
commit;
