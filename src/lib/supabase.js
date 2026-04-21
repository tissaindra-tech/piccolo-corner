import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ─── SQL to run once in Supabase SQL Editor ───────────────────────────────────
// Copy-paste the block below into Supabase > SQL Editor > New Query > Run
/*
-- EMPLOYEES
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null,
  phone text unique not null,
  pin text not null,               -- hashed 6-digit PIN
  is_owner boolean default false,
  shift text default null,         -- 'pagi' | 'siang' | 'malam' | null
  leave_balance integer default 12,
  face_descriptor jsonb default null,
  created_at timestamptz default now()
);

-- ATTENDANCE LOG
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id),
  date date not null default current_date,
  check_in timestamptz,
  check_out timestamptz,
  status text not null default 'hadir', -- hadir | sakit | cuti | ctb | day_off
  gps_lat_in numeric,
  gps_lng_in numeric,
  gps_dist_in integer,
  gps_lat_out numeric,
  gps_lng_out numeric,
  gps_dist_out integer,
  is_late boolean default false,
  late_minutes integer default 0,
  note text,
  doc_url text,                    -- surat dokter / resep
  doc_status text default null,    -- pending | approved | rejected
  approved_by uuid references employees(id),
  created_at timestamptz default now(),
  unique(employee_id, date)
);

-- GPS FRAUD LOG
create table if not exists gps_fraud_log (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id),
  attempted_at timestamptz default now(),
  gps_lat numeric,
  gps_lng numeric,
  distance_m integer,
  radius_limit integer
);

-- LEAVE REQUESTS
create table if not exists leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id),
  type text not null,              -- cuti | ctb | sakit | day_off
  date_start date not null,
  date_end date not null,
  days integer default 1,
  reason text,
  doc_url text,
  status text default 'pending',   -- pending | approved | rejected
  reviewed_by uuid references employees(id),
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

-- WORK SETTINGS (single row config)
create table if not exists work_settings (
  id integer primary key default 1,
  open_time time default '10:00',
  close_time time default '20:00',
  late_tolerance_minutes integer default 15,
  doc_upload_deadline_days integer default 3,
  gps_radius_meters integer default 100,
  cafe_lat numeric default -8.6786,
  cafe_lng numeric default 115.2115,
  max_dayoff_per_week integer default 1,
  dayoff_allowed_days text[] default array['mon','tue','wed','thu','fri'],
  updated_at timestamptz default now()
);
insert into work_settings(id) values(1) on conflict(id) do nothing;

-- RLS: enable but allow all for now (tighten after testing)
alter table employees enable row level security;
alter table attendance enable row level security;
alter table gps_fraud_log enable row level security;
alter table leave_requests enable row level security;
alter table work_settings enable row level security;

create policy "allow_all" on employees for all using (true);
create policy "allow_all" on attendance for all using (true);
create policy "allow_all" on gps_fraud_log for all using (true);
create policy "allow_all" on leave_requests for all using (true);
create policy "allow_all" on work_settings for all using (true);

-- SEED: default owner account (PIN: 000000)
insert into employees (name, role, phone, pin, is_owner, leave_balance)
values ('Owner', 'Owner', '08000000000', '000000', true, 0)
on conflict(phone) do nothing;
*/
