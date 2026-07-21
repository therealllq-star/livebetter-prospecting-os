-- Stage B: RLS migration preparation for the existing CRM tables
-- Purpose:
--   Allow authenticated users full CRUD access to the existing CRM tables for the
--   current single-user MVP. These policies intentionally do not use ownership
--   columns because the tables do not currently expose user_id/owner_id.
--
-- Important:
--   - No anonymous/public access is granted.
--   - No schema changes are made here.
--   - These policies should be replaced with owner/team-based RLS before multi-user access.

-- Ensure the policies are applied to the public schema.
set search_path = public;

-- leads
drop policy if exists "authenticated_select_all_leads" on public.leads;
drop policy if exists "authenticated_insert_all_leads" on public.leads;
drop policy if exists "authenticated_update_all_leads" on public.leads;
drop policy if exists "authenticated_delete_all_leads" on public.leads;

create policy "authenticated_select_all_leads"
  on public.leads
  for select
  to authenticated
  using (auth.uid() is not null);

create policy "authenticated_insert_all_leads"
  on public.leads
  for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "authenticated_update_all_leads"
  on public.leads
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "authenticated_delete_all_leads"
  on public.leads
  for delete
  to authenticated
  using (auth.uid() is not null);

-- activities
drop policy if exists "authenticated_select_all_activities" on public.activities;
drop policy if exists "authenticated_insert_all_activities" on public.activities;
drop policy if exists "authenticated_update_all_activities" on public.activities;
drop policy if exists "authenticated_delete_all_activities" on public.activities;

create policy "authenticated_select_all_activities"
  on public.activities
  for select
  to authenticated
  using (auth.uid() is not null);

create policy "authenticated_insert_all_activities"
  on public.activities
  for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "authenticated_update_all_activities"
  on public.activities
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "authenticated_delete_all_activities"
  on public.activities
  for delete
  to authenticated
  using (auth.uid() is not null);

-- appointments
drop policy if exists "authenticated_select_all_appointments" on public.appointments;
drop policy if exists "authenticated_insert_all_appointments" on public.appointments;
drop policy if exists "authenticated_update_all_appointments" on public.appointments;
drop policy if exists "authenticated_delete_all_appointments" on public.appointments;

create policy "authenticated_select_all_appointments"
  on public.appointments
  for select
  to authenticated
  using (auth.uid() is not null);

create policy "authenticated_insert_all_appointments"
  on public.appointments
  for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "authenticated_update_all_appointments"
  on public.appointments
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "authenticated_delete_all_appointments"
  on public.appointments
  for delete
  to authenticated
  using (auth.uid() is not null);

-- conversations
drop policy if exists "authenticated_select_all_conversations" on public.conversations;
drop policy if exists "authenticated_insert_all_conversations" on public.conversations;
drop policy if exists "authenticated_update_all_conversations" on public.conversations;
drop policy if exists "authenticated_delete_all_conversations" on public.conversations;

create policy "authenticated_select_all_conversations"
  on public.conversations
  for select
  to authenticated
  using (auth.uid() is not null);

create policy "authenticated_insert_all_conversations"
  on public.conversations
  for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "authenticated_update_all_conversations"
  on public.conversations
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "authenticated_delete_all_conversations"
  on public.conversations
  for delete
  to authenticated
  using (auth.uid() is not null);

-- lead_notes
drop policy if exists "authenticated_select_all_lead_notes" on public.lead_notes;
drop policy if exists "authenticated_insert_all_lead_notes" on public.lead_notes;
drop policy if exists "authenticated_update_all_lead_notes" on public.lead_notes;
drop policy if exists "authenticated_delete_all_lead_notes" on public.lead_notes;

create policy "authenticated_select_all_lead_notes"
  on public.lead_notes
  for select
  to authenticated
  using (auth.uid() is not null);

create policy "authenticated_insert_all_lead_notes"
  on public.lead_notes
  for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "authenticated_update_all_lead_notes"
  on public.lead_notes
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "authenticated_delete_all_lead_notes"
  on public.lead_notes
  for delete
  to authenticated
  using (auth.uid() is not null);

-- tasks
drop policy if exists "authenticated_select_all_tasks" on public.tasks;
drop policy if exists "authenticated_insert_all_tasks" on public.tasks;
drop policy if exists "authenticated_update_all_tasks" on public.tasks;
drop policy if exists "authenticated_delete_all_tasks" on public.tasks;

create policy "authenticated_select_all_tasks"
  on public.tasks
  for select
  to authenticated
  using (auth.uid() is not null);

create policy "authenticated_insert_all_tasks"
  on public.tasks
  for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "authenticated_update_all_tasks"
  on public.tasks
  for update
  to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "authenticated_delete_all_tasks"
  on public.tasks
  for delete
  to authenticated
  using (auth.uid() is not null);
