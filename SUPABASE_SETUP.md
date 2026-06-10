# Supabase Setup for Gig Squad

Run this SQL in the Supabase dashboard (SQL Editor):

```sql
create table gs_households (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  created_at timestamptz default now()
);

create table gs_household_state (
  household_id uuid references gs_households(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz default now(),
  primary key (household_id)
);

alter table gs_households enable row level security;
alter table gs_household_state enable row level security;

create policy "public read" on gs_households for select using (true);
create policy "public insert" on gs_households for insert with check (true);
create policy "public read" on gs_household_state for select using (true);
create policy "public insert" on gs_household_state for insert with check (true);
create policy "public update" on gs_household_state for update using (true);
```

After running the SQL, confirm and the app code will be updated.
