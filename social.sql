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
