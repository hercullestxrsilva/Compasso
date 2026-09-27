-- Optional manual cloud snapshots. This is not automatic synchronization.
create table if not exists public.compasso_backups (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  path text not null unique,
  bytes bigint not null check (bytes > 0 and bytes <= 47185920),
  created_at timestamptz not null default now(),
  constraint path_belongs_to_owner check (split_part(path, '/', 1) = owner_id::text)
);
alter table public.compasso_backups enable row level security;
create policy "owners read snapshots" on public.compasso_backups for select to authenticated using ((select auth.uid()) = owner_id);
create policy "owners create snapshots" on public.compasso_backups for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "owners delete snapshots" on public.compasso_backups for delete to authenticated using ((select auth.uid()) = owner_id);
grant select,insert,delete on public.compasso_backups to authenticated;
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('compasso-backups','compasso-backups',false,47185920,array['application/json'])
on conflict(id) do nothing;
create policy "owners read backup files" on storage.objects for select to authenticated using (bucket_id='compasso-backups' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "owners create backup files" on storage.objects for insert to authenticated with check (bucket_id='compasso-backups' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "owners remove backup files" on storage.objects for delete to authenticated using (bucket_id='compasso-backups' and (storage.foldername(name))[1]=(select auth.uid())::text);
