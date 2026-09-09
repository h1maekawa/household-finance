-- 取引の内訳（Transaction Items）。
--
-- カード明細は「セブンイレブン ¥1,800」の1行しか無く、食費・タバコ・日用品の
-- どれなのか判別できない。1件の取引を商品・用途単位へ分けられるようにする。
--
-- 不変条件:
--   items が0件      … 未分割。許可する
--   items が1件以上  … 合計が transactions.amount と一致すること
--
-- 行トリガーで合計を検査すると、1件ずつINSERTする途中で必ず不一致になり
-- 通らない。書き込みは replace_integration... ではなく
-- replace_transaction_items() で「全消し→一括INSERT→検査」を1トランザクションに
-- まとめ、authenticated からの直接書き込みは許可しない。

create table if not exists transaction_items (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  item_name text not null,
  amount integer not null check (amount > 0),
  category text not null,
  -- 表示順。レシートの並びを保つ
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists transaction_items_transaction_idx
  on transaction_items (transaction_id, position);
create index if not exists transaction_items_user_category_idx
  on transaction_items (user_id, category);

alter table transaction_items enable row level security;

-- 読むのは自分の内訳だけ。書き込みポリシーは作らない（関数経由のみ）
drop policy if exists transaction_items_select_own on transaction_items;
create policy transaction_items_select_own on transaction_items
  for select using (auth.uid() = user_id);

revoke insert, update, delete on transaction_items from authenticated;
grant select on transaction_items to authenticated;

/* ── 内訳の置換 ───────────────────────────────── */

-- items は [{"item_name": "...", "amount": 700, "category": "食費"}, ...] の JSONB 配列。
-- 空配列を渡すと分割を解除する。
--
-- user_id はクライアントから受け取らない。auth.uid() で決め、対象の取引が
-- 本人のものかを関数内で確認する。
create or replace function replace_transaction_items(
  p_transaction_id uuid,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_amount integer;
  v_total integer;
  v_count integer;
begin
  if v_user is null then
    raise exception 'authentication required';
  end if;

  -- 所有権の確認。他人の取引は「見つからない」として扱う
  select amount into v_amount
  from transactions
  where id = p_transaction_id and user_id = v_user;

  if not found then
    raise exception 'transaction not found';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be an array';
  end if;

  -- 既存の内訳を消してから入れ直す。部分更新にすると途中状態で
  -- 合計が合わなくなるため、常に全置換にする
  delete from transaction_items where transaction_id = p_transaction_id;

  select count(*) into v_count from jsonb_array_elements(p_items);

  if v_count > 0 then
    insert into transaction_items (
      transaction_id, user_id, item_name, amount, category, position
    )
    select
      p_transaction_id,
      v_user,
      coalesce(nullif(btrim(item->>'item_name'), ''), '内訳'),
      (item->>'amount')::integer,
      coalesce(nullif(btrim(item->>'category'), ''), '未分類'),
      (ordinality - 1)::integer
    from jsonb_array_elements(p_items) with ordinality as t(item, ordinality);

    -- 合計の一致はここで確定させる。アプリ側の検証はUX用で、最終保証はDB
    select coalesce(sum(amount), 0) into v_total
    from transaction_items
    where transaction_id = p_transaction_id;

    if v_total <> v_amount then
      raise exception 'items total (%) must equal transaction amount (%)', v_total, v_amount;
    end if;
  end if;

  return jsonb_build_object('transaction_id', p_transaction_id, 'item_count', v_count);
end;
$$;

revoke all on function replace_transaction_items(uuid, jsonb) from public, anon;
grant execute on function replace_transaction_items(uuid, jsonb) to authenticated;
