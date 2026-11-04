-- Run once after 002/003, then start a fresh room for a complete five-round recap.
begin;
alter function hot_private.tick(jsonb) rename to score_tick;
create function hot_private.tick(s jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare scored jsonb; highlights jsonb;
begin
  scored:=hot_private.score_tick(s);
  -- Record once, only when votes have been scored and authors can be revealed.
  if s->>'phase' not in ('results','finished') and scored->>'phase' in ('results','finished') then
    select jsonb_agg(jsonb_build_object('id',a->>'id','text',a->>'text','author',p->>'name') order by a->>'id')
      into highlights from jsonb_array_elements(scored->'answers') a
      join jsonb_array_elements(scored->'players') p on p->>'id'=a->>'player'
      where (a->>'heat_units')::int=(select max((answer->>'heat_units')::int) from jsonb_array_elements(scored->'answers') answer);
    scored:=scored||jsonb_build_object('history',coalesce(s->'history','[]'::jsonb)||jsonb_build_array(
      jsonb_build_object('round',(scored->>'round')::int,'prompt',scored->>'prompt','takes',highlights)));
  end if;
  return scored;
end $$;

alter function hot_private.snapshot(jsonb,text,text) rename to round_snapshot;
create function hot_private.snapshot(s jsonb,viewer text,room_code text) returns jsonb
language sql set search_path='' as $$
  select hot_private.round_snapshot(s,viewer,room_code)||jsonb_build_object(
    'history',case when s->>'phase'='finished' then coalesce(s->'history','[]'::jsonb) else '[]'::jsonb end);
$$;
revoke all on all functions in schema hot_private from public,anon,authenticated;
commit;
