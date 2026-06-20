-- Multi-event migration for the StubHub watcher (project "Ranked Voting").
--
-- The base table stubhub_price_snapshots already carries event_id, so this
-- migration only (1) makes the convenience views event-aware, (2) adds helpful
-- indexes, and (3) deletes the decommissioned June 19 event's data.
--
-- Apply with:  psql "<connection-string>" -f sql/001_multi_event.sql
-- Idempotent: safe to run more than once.

begin;

-- 1) Event-aware convenience views (security_invoker so anon RLS applies). ----
drop view if exists stubhub_latest_prices;
create view stubhub_latest_prices
  with (security_invoker = true) as
select distinct on (event_id, class_name)
  event_id, class_name, min_price, total_for_qty, listings, tickets, captured_at
from stubhub_price_snapshots
order by event_id, class_name, captured_at desc;

drop view if exists stubhub_daily_low;
create view stubhub_daily_low
  with (security_invoker = true) as
select
  event_id,
  (captured_at at time zone 'America/Los_Angeles')::date as day_pt,
  class_name,
  min(min_price) as day_min_price,
  max(min_price) as day_max_price,
  round(avg(min_price)::numeric, 2) as day_avg_price,
  count(*) as samples
from stubhub_price_snapshots
group by event_id, day_pt, class_name;

grant select on stubhub_latest_prices to anon;
grant select on stubhub_daily_low to anon;

-- 2) Indexes for per-event reads as history grows. -------------------------
create index if not exists idx_snap_event_time
  on stubhub_price_snapshots (event_id, captured_at desc);
create index if not exists idx_snap_event_class_time
  on stubhub_price_snapshots (event_id, class_name, captured_at desc);

-- 3) Decommission the old June 19 event (id 153020544). --------------------
delete from stubhub_price_snapshots where event_id = '153020544';
-- Drop its alert state and the pre-multi-event single-key state row.
delete from stubhub_app_state where key in ('alert-state', 'alert-state:153020544');

commit;
