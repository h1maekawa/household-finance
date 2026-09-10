-- 目標のマイルストーン（スペック §19）。
--
-- 3,000万円のような大きな目標は、そのままでは「遠すぎて何も分からない」。
-- 500万 → 1,000万 → 3,000万 のように途中の通過点へ分割して、
-- 「次にどこを目指すか」を出せるようにする。
--
-- 刻み方はユーザーが決める。システムが勝手に固定しない（候補は提示するが、
-- 保存するのはユーザーが確定したときだけ）。
--
-- 不変条件:
--   amount は 1円以上
--   同一目標内で amount は重複しない
--   position は amount の昇順（並び順を保存側で決め、画面のソートに依存しない）
--
-- 全置換は replace_goal_milestones() で1トランザクションにまとめる。
-- 「消してから入れる」を2回のリクエストに分けると、途中で失敗したときに
-- ユーザーが入力したマイルストーンが消えたままになる。

create table if not exists goal_milestones (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references life_goals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null check (amount > 0),
  -- 任意の呼び名。未入力なら画面が金額から作る
  label text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (goal_id, amount)
);

create index if not exists goal_milestones_goal_idx
  on goal_milestones (goal_id, position);
create index if not exists goal_milestones_user_idx
  on goal_milestones (user_id);

alter table goal_milestones enable row level security;

-- 読むのは自分のマイルストーンだけ。書き込みポリシーは作らない（関数経由のみ）
drop policy if exists goal_milestones_select_own on goal_milestones;
create policy goal_milestones_select_own on goal_milestones
  for select using (auth.uid() = user_id);

revoke insert, update, delete on goal_milestones from authenticated;
grant select on goal_milestones to authenticated;

-- ---------------------------------------------------------------- 全置換
--
-- user_id はクライアントから受け取らず auth.uid() で決める。
-- 目標そのものが本人のものであることも、ここで確認する
-- （goal_milestones の user_id だけを見ると、他人の目標へ自分のIDで
--  マイルストーンを付けられてしまう）。
create or replace function replace_goal_milestones(
  p_goal_id uuid,
  p_milestones jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
begin
  if v_user is null then
    raise exception 'authentication required';
  end if;

  perform 1 from life_goals where id = p_goal_id and user_id = v_user;
  if not found then
    raise exception 'goal not found';
  end if;

  if jsonb_typeof(p_milestones) <> 'array' then
    raise exception 'milestones must be an array';
  end if;

  select count(*) into v_count from jsonb_array_elements(p_milestones);
  -- 上限は「刻みすぎて読めなくなる」ことの防止と、書き込み量の上限を兼ねる
  if v_count > 12 then
    raise exception 'milestones must be 12 or fewer';
  end if;

  delete from goal_milestones where goal_id = p_goal_id;

  if v_count > 0 then
    -- 重複金額は畳み、金額の昇順で position を振り直す。
    -- 並び順を画面のソートに任せると、別の画面から読んだときに崩れる
    insert into goal_milestones (goal_id, user_id, amount, label, position)
    select
      p_goal_id,
      v_user,
      amount,
      label,
      (row_number() over (order by amount) - 1)::integer
    from (
      select distinct on ((item->>'amount')::integer)
        (item->>'amount')::integer as amount,
        nullif(btrim(item->>'label'), '') as label
      from jsonb_array_elements(p_milestones) as t(item)
      order by (item->>'amount')::integer
    ) as unique_amounts;

    select count(*) into v_count from goal_milestones where goal_id = p_goal_id;
  end if;

  return jsonb_build_object('goal_id', p_goal_id, 'milestone_count', v_count);
end;
$$;

revoke all on function replace_goal_milestones(uuid, jsonb) from public, anon;
grant execute on function replace_goal_milestones(uuid, jsonb) to authenticated;
