-- Stripe Event の受理を atomic にする。
--
-- アプリ側で「SELECT → 判定 → UPSERT」を行うと、同じイベントがほぼ同時に
-- 2つ届いたときに両方が「未登録」と判定して業務処理へ進む余地がある。
-- event_id が主キーでも、UPSERT では衝突側も更新に成功してしまうため防げない。
--
-- 1文の INSERT ... ON CONFLICT DO UPDATE ... WHERE で判定ごと原子化する。
-- 一意インデックス上で直列化されるので、権利を取れるのは必ず1ワーカーだけ。
-- 更新条件を満たさない場合は0行となり、RETURNING が何も返さない = claim 失敗。

create or replace function claim_stripe_event(
  p_event_id text,
  p_event_type text,
  p_stale_after interval default interval '5 minutes'
) returns boolean
language plpgsql
as $$
declare
  v_claimed boolean;
begin
  insert into stripe_events (event_id, event_type, status, attempts, received_at)
  values (p_event_id, p_event_type, 'processing', 1, now())
  on conflict (event_id) do update
    set status = 'processing',
        attempts = stripe_events.attempts + 1,
        received_at = now(),
        last_error = null
    -- failed（前回失敗）と、放置された processing（異常終了）だけ引き取る。
    -- processed は二度と処理しない。処理中の新しい行は横取りしない。
    where stripe_events.status = 'failed'
       or (stripe_events.status = 'processing'
           and stripe_events.received_at < now() - p_stale_after)
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

-- 課金の内部処理なので、一般ユーザーからは呼べないようにする。
-- Supabase は関数を PostgREST 経由で公開するため、明示的に剥がす。
revoke all on function claim_stripe_event(text, text, interval) from public;
revoke all on function claim_stripe_event(text, text, interval) from anon;
revoke all on function claim_stripe_event(text, text, interval) from authenticated;
grant execute on function claim_stripe_event(text, text, interval) to service_role;
