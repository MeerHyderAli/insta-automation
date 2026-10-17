-- 0004_plans.sql
-- Plan catalogue. No billing integration: plans are assigned to a workspace by
-- the server (new workspaces start on 'free') and can be changed manually.

insert into public.plans (id, name, description, limits)
values
  (
    'free',
    'Free',
    'Evaluate comment automation on one account.',
    '{"accounts":1,"rules":3,"resources":10,"members":1,"private_replies_month":100,"comments_month":500}'::jsonb
  ),
  (
    'creator',
    'Creator',
    'For solo creators running a content funnel.',
    '{"accounts":2,"rules":20,"resources":50,"members":3,"private_replies_month":2000,"comments_month":5000}'::jsonb
  ),
  (
    'studio',
    'Studio',
    'For small teams managing several accounts.',
    '{"accounts":5,"rules":100,"resources":250,"members":10,"private_replies_month":10000,"comments_month":25000}'::jsonb
  )
on conflict (id) do update
  set name = excluded.name,
      description = excluded.description,
      limits = excluded.limits;
