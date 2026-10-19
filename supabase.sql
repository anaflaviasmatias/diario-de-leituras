-- Diário de Leituras: cole tudo isto no SQL Editor do Supabase e clique em "Run".

-- 1. Tabela dos livros (cada pessoa só vê e mexe nos próprios livros)
create table if not exists public.books (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null default '',
  author      text not null default '',
  status      text not null default 'lido',
  rating      numeric(2,1) not null default 0,
  summary     text not null default '',
  notes       text not null default '',
  quotes      jsonb not null default '[]'::jsonb,
  started     text not null default '',
  finished    text not null default '',
  pages       int,
  genre       text not null default '',
  format      text not null default '',
  year        int,
  ord         int,
  cover_url   text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.books enable row level security;

drop policy if exists "ver meus livros" on public.books;
drop policy if exists "criar meus livros" on public.books;
drop policy if exists "editar meus livros" on public.books;
drop policy if exists "apagar meus livros" on public.books;
create policy "ver meus livros"    on public.books for select to authenticated using (auth.uid() = user_id);
create policy "criar meus livros"  on public.books for insert to authenticated with check (auth.uid() = user_id);
create policy "editar meus livros" on public.books for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "apagar meus livros" on public.books for delete to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on public.books to authenticated;

-- 2. Atualização ao vivo entre celular e computador
do $$ begin
  alter publication supabase_realtime add table public.books;
exception when duplicate_object then null; end $$;

-- 3. Pasta para as capas que você enviar pelo app
insert into storage.buckets (id, name, public) values ('capas', 'capas', true)
on conflict (id) do nothing;

drop policy if exists "enviar minhas capas" on storage.objects;
drop policy if exists "trocar minhas capas" on storage.objects;
drop policy if exists "apagar minhas capas" on storage.objects;
create policy "enviar minhas capas" on storage.objects for insert to authenticated
  with check (bucket_id = 'capas' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "trocar minhas capas" on storage.objects for update to authenticated
  using (bucket_id = 'capas' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "apagar minhas capas" on storage.objects for delete to authenticated
  using (bucket_id = 'capas' and (storage.foldername(name))[1] = auth.uid()::text);

-- 4. Meia estrela (para bancos criados antes desta mudança)
alter table public.books alter column rating type numeric(2,1);
-- Diário de Leituras: perfis, seguir e estantes visíveis para quem tem conta.
-- Cole tudo no SQL Editor do Supabase e clique em "Run". Pode rodar mais de uma vez sem problema.

-- 1. Perfil de cada pessoa (nome, @usuário e uma frase sobre ela)
create table if not exists public.profiles (
  id          uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  username    text not null unique check (username ~ '^[a-z0-9_.]{3,20}$'),
  name        text not null default '',
  bio         text not null default '',
  created_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "ver perfis" on public.profiles;
drop policy if exists "criar meu perfil" on public.profiles;
drop policy if exists "editar meu perfil" on public.profiles;
create policy "ver perfis"        on public.profiles for select to authenticated using (true);
create policy "criar meu perfil"  on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "editar meu perfil" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
grant select, insert, update on public.profiles to authenticated;

-- 2. Quem segue quem
create table if not exists public.follows (
  follower    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  following   uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower, following),
  check (follower <> following)
);
alter table public.follows enable row level security;
drop policy if exists "ver quem segue quem" on public.follows;
drop policy if exists "seguir" on public.follows;
drop policy if exists "deixar de seguir" on public.follows;
create policy "ver quem segue quem" on public.follows for select to authenticated using (true);
create policy "seguir"              on public.follows for insert to authenticated with check (auth.uid() = follower);
create policy "deixar de seguir"    on public.follows for delete to authenticated using (auth.uid() = follower);
grant select, insert, delete on public.follows to authenticated;

-- 3. Livros: quem tem conta vê a estante dos outros; cada um só altera os próprios
drop policy if exists "ver meus livros" on public.books;
drop policy if exists "ver livros de quem tem conta" on public.books;
create policy "ver livros de quem tem conta" on public.books for select to authenticated using (true);

-- 4. Capas: leitura da pasta pelo app (necessária para trocar capas)
drop policy if exists "ver capas" on storage.objects;
create policy "ver capas" on storage.objects for select to authenticated using (bucket_id = 'capas');
