-- ============================================================
-- PICCOLO CORNER ATTENDANCE SYSTEM — Database Setup
-- Run this entire file in Supabase > SQL Editor > New Query
-- ============================================================

-- EMPLOYEES
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null,
  phone text unique not null,
  pin text not null,
  is_owner boolean default false,
  shift text default null,
  leave_balance integer default 12,
  face_descriptor jsonb default null,
  created_at timestamptz default now()
);

-- ATTENDANCE LOG
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete cascade,
  date date not null default current_date,
  check_in timestamptz,
  check_out timestamptz,
  status text not null default 'hadir',
  gps_lat_in numeric,
  gps_lng_in numeric,
  gps_dist_in integer,
  gps_lat_out numeric,
  gps_lng_out numeric,
  gps_dist_out integer,
  is_late boolean default false,
  late_minutes integer default 0,
  note text,
  doc_url text,
  doc_status text default null,
  approved_by uuid references employees(id),
  created_at timestamptz default now(),
  unique(employee_id, date)
);

-- GPS FRAUD LOG
create table if not exists gps_fraud_log (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete cascade,
  attempted_at timestamptz default now(),
  gps_lat numeric,
  gps_lng numeric,
  distance_m integer,
  radius_limit integer
);

-- LEAVE REQUESTS
create table if not exists leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete cascade,
  type text not null,
  date_start date not null,
  date_end date not null,
  days integer default 1,
  reason text,
  doc_url text,
  status text default 'pending',
  reviewed_by uuid references employees(id),
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

-- WORK SETTINGS
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

-- ROW LEVEL SECURITY
alter table employees enable row level security;
alter table attendance enable row level security;
alter table gps_fraud_log enable row level security;
alter table leave_requests enable row level security;
alter table work_settings enable row level security;

drop policy if exists "allow_all" on employees;
drop policy if exists "allow_all" on attendance;
drop policy if exists "allow_all" on gps_fraud_log;
drop policy if exists "allow_all" on leave_requests;
drop policy if exists "allow_all" on work_settings;

create policy "allow_all" on employees for all using (true) with check (true);
create policy "allow_all" on attendance for all using (true) with check (true);
create policy "allow_all" on gps_fraud_log for all using (true) with check (true);
create policy "allow_all" on leave_requests for all using (true) with check (true);
create policy "allow_all" on work_settings for all using (true) with check (true);

-- DEFAULT OWNER ACCOUNT (PIN: 000000)
insert into employees (name, role, phone, pin, is_owner, leave_balance)
values ('Owner', 'Owner', '08000000000', '000000', true, 0)
on conflict(phone) do nothing;

-- STORAGE BUCKET FOR DOCUMENTS
insert into storage.buckets (id, name, public)
values ('documents', 'documents', true)
on conflict(id) do nothing;

drop policy if exists "allow_all_storage" on storage.objects;
create policy "allow_all_storage" on storage.objects
  for all using (bucket_id = 'documents') with check (bucket_id = 'documents');

select 'SUCCESS! Database ready for Piccolo Corner.' as status;
