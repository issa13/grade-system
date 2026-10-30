-- =====================================================================
-- نظام إدارة العلامات — التحديث 4: إشعارات على التلفون (Push)
-- شغّل هذا الملف مرة واحدة من: Supabase → SQL Editor → New query → Run
-- (بعد 003). لا يمس البيانات الموجودة، وآمن لإعادة التشغيل.
-- =====================================================================

create or replace function public.app_schema_version() returns int
language sql immutable as $$ select 4 $$;
grant execute on function public.app_schema_version() to anon, authenticated;

-- كل جهاز (تلفون/كمبيوتر) فعّل الإشعارات له سطر هنا.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) <= 200),
  auth text not null check (length(auth) <= 100),
  device text check (length(device) <= 120),          -- مثلاً «Android · Chrome»
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,                               -- آخر إشعار وصل بنجاح
  failures int not null default 0
);
create index if not exists idx_push_owner on public.push_subscriptions(owner_id);

-- ما أُرسل سابقاً: نفس التنبيه لا يُرسل مرتين (إلا إذا تغيّرت حالته، مثلاً غياب جديد).
create table if not exists public.push_sent (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null,
  fingerprint text,
  sent_at timestamptz not null default now(),
  primary key (owner_id, key)
);

-- RLS: كل أستاذ يرى أجهزته فقط. (بدون سجل تعديلات: تتغير تلقائياً كل ساعة وتملأ السجل بلا فائدة)
do $$
declare t text;
begin
  foreach t in array array['push_subscriptions','push_sent']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format('create policy owner_all on public.%I for all to authenticated
                    using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
end $$;
