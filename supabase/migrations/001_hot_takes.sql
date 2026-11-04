-- Run once in a new Supabase project's SQL editor. Do not expose internal state.
create schema if not exists hot_private;
revoke all on schema hot_private from public, anon, authenticated;

create table hot_private.rooms (
  code text primary key,
  state jsonb not null,
  created_at timestamptz not null default now()
);
alter table hot_private.rooms enable row level security;
revoke all on hot_private.rooms from public, anon, authenticated;

create table hot_private.prompts (id integer generated always as identity primary key, text text not null);
insert into hot_private.prompts(text) values
('Which pizza topping deserves more respect?'),
('Who is an actor everyone finds hot… except you?'),
('What food is wildly overrated?'),
('What is the most underrated condiment?'),
('Which movie does not deserve the hype?'),
('Who is a surprisingly attractive celebrity?'),
('What popular song is actually terrible?'),
('What is the worst thing to put on a hot dog?'),
('What is a food combination you would defend with your life?'),
('Which fictional villain had a point?'),
('Which beloved TV show should have ended sooner?'),
('What is the most overrated holiday?'),
('What is a fashion trend that needs to disappear?'),
('Which celebrity would be the worst roommate?'),
('What is the best thing to eat cold?'),
('Which movie sequel is better than the original?'),
('What is an acceptable thing to put ketchup on?'),
('Which social habit should be illegal at parties?'),
('What is the most overrated vacation activity?'),
('Which celebrity is more talented than people admit?'),
('What is an unpopular opinion you have about breakfast?'),
('What is the worst popular first-date idea?'),
('What is the most attractive quality people overlook?'),
('What is the best terrible reality TV show?'),
('Which snack would you happily ban forever?'),
('What is something adults should stop pretending to enjoy?'),
('Which actor is always playing the same character?'),
('What belongs on a sandwich but will start an argument?'),
('What is a movie everyone should watch exactly once?'),
('What is the most overrated thing about being an adult?');

create function hot_private.new_round(s jsonb, increment_round boolean) returns jsonb
language plpgsql set search_path = '' as $$
declare chosen hot_private.prompts; used jsonb := coalesce(s->'used','[]'::jsonb); people jsonb;
begin
  select * into chosen from hot_private.prompts p where not used @> to_jsonb(array[p.id]) order by random() limit 1;
  if not found then
    raise exception 'All prompts have been used. Start a new room.';
  end if;
  select jsonb_agg(p - 'answered' - 'voted' || '{"answered":false,"voted":false}'::jsonb order by ord)
    into people from jsonb_array_elements(s->'players') with ordinality as t(p,ord);
  return s || jsonb_build_object('phase','answering','round',(s->>'round')::int + case when increment_round then 1 else 0 end,
    'prompt',chosen.text,'used',used || to_jsonb(chosen.id),'deadline',now()+interval '60 seconds',
    'answers','[]'::jsonb,'ballots','{}'::jsonb,'players',people,'note',null);
end $$;

create function hot_private.tick(s jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare player_count int; answer_count int; ballot_count int; points_units int;
  a jsonb; b jsonb; p jsonb; results jsonb := '[]'; people jsonb := '[]';
  heat_sum int; heat_count int; pos int; tally jsonb := '[]'; hotter int; tie_count int;
begin
  player_count := jsonb_array_length(s->'players');
  answer_count := jsonb_array_length(s->'answers');
  if s->>'phase' = 'answering' and (answer_count = player_count or now() >= (s->>'deadline')::timestamptz) then
    if answer_count < 3 then
      return hot_private.new_round(s,false) || jsonb_build_object('note','Fewer than three takes arrived. New prompt, same round.');
    end if;
    s := s || '{"phase":"voting","deadline":null}'::jsonb;
  end if;
  select count(*) into ballot_count from jsonb_object_keys(s->'ballots');
  if s->>'phase' = 'voting' and ballot_count = player_count then
    -- A complete ballot from every original player means every answer has the
    -- same number of ratings. Heat units use LCM(1..7)=420, avoiding float ties.
    for a in select value from jsonb_array_elements(s->'answers') loop
      heat_sum := 0; heat_count := 0;
      for b in select value from jsonb_each(s->'ballots') loop
        select ord::int into pos from jsonb_array_elements_text(b) with ordinality as t(id,ord) where id = a->>'id';
        if pos is not null then
          heat_sum := heat_sum + 420 * (jsonb_array_length(b)-pos) / (jsonb_array_length(b)-1);
          heat_count := heat_count + 1;
        end if;
      end loop;
      if heat_count <> player_count - 1 then raise exception 'Invalid rating count'; end if;
      tally := tally || jsonb_build_object('id',a->>'id','units',heat_sum,'heat',100.0*heat_sum/(420*heat_count));
    end loop;
    for a in select value from jsonb_array_elements(s->'answers') loop
      select (t->>'units')::int into heat_sum from jsonb_array_elements(tally) t where t->>'id'=a->>'id';
      select count(*) filter(where (t->>'units')::int > heat_sum), count(*) filter(where (t->>'units')::int = heat_sum)
        into hotter,tie_count from jsonb_array_elements(tally) t;
      select sum(case when place=0 then 0 else answer_count-place end)*840/tie_count
        into points_units from generate_series(hotter,hotter+tie_count-1) place;

      -- JSON numeric score, with exact integer point units retained internally.
      results := results || (a || jsonb_build_object('heat',100.0*heat_sum/(420*(player_count-1)),
        'heat_units',heat_sum,'point_units',points_units,'points',points_units/840.0));
    end loop;
    select jsonb_agg(entry.item order by (entry.item->>'heat_units')::int desc,entry.item->>'id') into results from jsonb_array_elements(results) as entry(item);
    for p in select value from jsonb_array_elements(s->'players') loop
      select (entry.item->>'point_units')::int into points_units from jsonb_array_elements(results) as entry(item) where entry.item->>'player'=p->>'id';
      people := people || (p || jsonb_build_object('score_units',(p->>'score_units')::int + coalesce(points_units,0)));
    end loop;
    s := s || jsonb_build_object('phase',case when (s->>'round')::int=5 then 'finished' else 'results' end,'answers',results,'players',people);
  end if;
  return s;
end $$;

create function hot_private.snapshot(s jsonb, viewer text, room_code text) returns jsonb
language plpgsql set search_path = '' as $$
declare people jsonb; answers jsonb := '[]'; a jsonb; author_name text; own boolean; is_result boolean;
begin
  is_result := s->>'phase' in ('results','finished');
  select jsonb_agg(jsonb_build_object('id',p->>'id','name',p->>'name',
    'online',(p->>'seen')::timestamptz > now()-interval '30 seconds',
    'answered',(p->>'answered')::boolean,'voted',(p->>'voted')::boolean,'total',(p->>'score_units')::int/840.0) order by ord)
    into people from jsonb_array_elements(s->'players') with ordinality as t(p,ord);
  if s->>'phase' in ('voting','results','finished') then
    for a in select value from jsonb_array_elements(s->'answers') loop
      own := a->>'player'=viewer;
      if is_result then
        select p->>'name' into author_name from jsonb_array_elements(s->'players') p where p->>'id'=a->>'player';
        answers := answers || jsonb_build_object('id',a->>'id','text',a->>'text','mine',own,'author',author_name,'heat',a->'heat','points',a->'points');
      else
        answers := answers || jsonb_build_object('id',a->>'id','text',a->>'text','mine',own);
      end if;
    end loop;
  end if;
  return jsonb_build_object('code',room_code,'phase',s->>'phase','host',s->>'host','me',viewer,'round',(s->>'round')::int,
    'prompt',s->>'prompt','deadline',s->'deadline','players',people,'answers',answers,'note',s->>'note');
end $$;

create function public.hot_game(p_action text, p_code text default '', p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid text := auth.uid()::text; s jsonb; v_code text := upper(trim(p_code)); player jsonb;
  nickname text := trim(coalesce(p_payload->>'name','')); idx int; connected int; replacement text;
  text_answer text; ids jsonb; expected int; valid int; ballot_id text;
begin
  if uid is null then raise exception 'Please sign in anonymously first.'; end if;
  if p_action not in ('create','join','sync','start','next','answer','vote') then raise exception 'Unknown action.'; end if;
  if p_action in ('create','join') and (length(nickname)<1 or length(nickname)>20) then raise exception 'Use a nickname of 1–20 characters.'; end if;
  if p_action='create' then
    player := jsonb_build_object('id',uid,'name',nickname,'seen',now(),'answered',false,'voted',false,'score_units',0);
    s := jsonb_build_object('phase','lobby','host',uid,'round',0,'prompt','','players',jsonb_build_array(player),'answers','[]'::jsonb,'ballots','{}'::jsonb,'used','[]'::jsonb,'deadline',null);
    loop
      v_code := upper(substr(md5(gen_random_uuid()::text),1,6));
      begin insert into hot_private.rooms(code,state) values(v_code,s); exit; exception when unique_violation then end;
    end loop;
    return hot_private.snapshot(s,uid,v_code);
  end if;
  if v_code !~ '^[A-Z0-9]{6}$' then raise exception 'Enter a six-character room code.'; end if;
  select r.state into s from hot_private.rooms r where r.code=v_code for update;
  if not found then raise exception 'Room not found. Check the code.'; end if;
  select (ord-1)::int,p into idx,player from jsonb_array_elements(s->'players') with ordinality as t(p,ord) where p->>'id'=uid;
  if player is null then
    if p_action<>'join' then raise exception 'Join this room first.'; end if;
    if s->>'phase'<>'lobby' then raise exception 'This game has started. New players can join only in the lobby.'; end if;
    if jsonb_array_length(s->'players')>=8 then raise exception 'This room is full.'; end if;
    if exists(select 1 from jsonb_array_elements(s->'players') p where lower(p->>'name')=lower(nickname)) then raise exception 'That nickname is taken in this room.'; end if;
    player := jsonb_build_object('id',uid,'name',nickname,'seen',now(),'answered',false,'voted',false,'score_units',0);
    idx := jsonb_array_length(s->'players');
    s := jsonb_set(s,'{players}',s->'players'||player);
  end if;
  s := jsonb_set(s,array['players',idx::text,'seen'],to_jsonb(now()));
  if not exists(select 1 from jsonb_array_elements(s->'players') p where p->>'id'=s->>'host' and (p->>'seen')::timestamptz>now()-interval '30 seconds') then
    select p->>'id' into replacement from jsonb_array_elements(s->'players') with ordinality as t(p,ord)
      where (p->>'seen')::timestamptz>now()-interval '30 seconds' order by ord limit 1;
    if replacement is not null then s := jsonb_set(s,'{host}',to_jsonb(replacement)); end if;
  end if;
  -- Check time before accepting an answer. Expired writes are never accepted.
  s := hot_private.tick(s);
  select p into player from jsonb_array_elements(s->'players') p where p->>'id'=uid;
  select count(*) into connected from jsonb_array_elements(s->'players') p where (p->>'seen')::timestamptz>now()-interval '30 seconds';
  if p_action in ('start','next') then
    if s->>'host'<>uid then raise exception 'Only the host can advance the game.'; end if;
    if (p_action='start' and s->>'phase'<>'lobby') or (p_action='next' and s->>'phase'<>'results') then raise exception 'The game has already moved on.'; end if;
    if connected<4 then raise exception 'At least four players must be connected.'; end if;
    s := hot_private.new_round(s,true);
  elsif p_action='answer' then
    if s->>'phase'<>'answering' or (p_payload->>'prompt') is distinct from (s->>'prompt') then
      -- Persist any deadline transition, but do not attach a stale answer to a new prompt.
      update hot_private.rooms r set state=s where r.code=v_code;
      return hot_private.snapshot(s,uid,v_code);
    end if;
    if (player->>'answered')::boolean then raise exception 'Your answer is already locked.'; end if;
    text_answer := trim(coalesce(p_payload->>'text',''));
    if length(text_answer)<1 or length(text_answer)>140 then raise exception 'Answers must contain 1–140 characters.'; end if;
    s := jsonb_set(s,'{answers}',s->'answers'||jsonb_build_object('id',gen_random_uuid()::text,'player',uid,'text',text_answer));
    s := jsonb_set(s,array['players',idx::text,'answered'],'true');
  elsif p_action='vote' then
    if s->>'phase'<>'voting' or (p_payload->>'prompt') is distinct from (s->>'prompt') then raise exception 'Voting has ended or the round changed.'; end if;
    if (player->>'voted')::boolean then raise exception 'Your ranking is already locked.'; end if;
    ids := p_payload->'ids';
    if ids is null or jsonb_typeof(ids)<>'array' then raise exception 'Submit a complete ranking.'; end if;
    select count(*) into expected from jsonb_array_elements(s->'answers') a where a->>'player'<>uid;
    select count(distinct value) into valid from jsonb_array_elements_text(ids);
    if jsonb_array_length(ids)<>expected or valid<>expected then raise exception 'Rank every other answer exactly once.'; end if;
    for ballot_id in select value from jsonb_array_elements_text(ids) loop
      if not exists(select 1 from jsonb_array_elements(s->'answers') a where a->>'id'=ballot_id and a->>'player'<>uid) then raise exception 'Invalid answer in ranking.'; end if;
    end loop;
    s := jsonb_set(s,array['ballots',uid],ids);
    s := jsonb_set(s,array['players',idx::text,'voted'],'true');
  end if;
  s := hot_private.tick(s);
  update hot_private.rooms r set state=s where r.code=v_code;
  return hot_private.snapshot(s,uid,v_code);
end $$;

revoke all on all functions in schema hot_private from public, anon, authenticated;
revoke all on function public.hot_game(text,text,jsonb) from public, anon;
grant execute on function public.hot_game(text,text,jsonb) to authenticated;
