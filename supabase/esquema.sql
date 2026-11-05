-- Tablero en Voz · esquema de la base de datos (Supabase).
-- Se pega entero en Supabase → SQL Editor → New query → Run.
-- Se puede volver a correr: no borra datos.
--
-- Modelo:
--   profesores    una fila por cuenta de profesor (id = usuario de Supabase Auth)
--   alumnos       los alumnos de cada profesor; `codigo` es el link de invitación
--   dispositivos  qué sesión (anónima) es de qué alumno: el alumno nunca escribe contraseña
--   clases        una clase = varios capítulos (partidas o posiciones) en JSON
--   asignaciones  qué clase ve cada alumno
--   progreso      dónde quedó el alumno y cómo le fue en las preguntas, por clase

create table if not exists public.profesores (
  id uuid primary key references auth.users on delete cascade,
  nombre text not null default '',
  creado timestamptz not null default now()
);

create table if not exists public.alumnos (
  id uuid primary key default gen_random_uuid(),
  profesor_id uuid not null references public.profesores on delete cascade,
  nombre text not null check (length(nombre) between 1 and 80),
  codigo text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
  creado timestamptz not null default now()
);
create index if not exists alumnos_profesor on public.alumnos (profesor_id);

create table if not exists public.dispositivos (
  usuario_id uuid primary key references auth.users on delete cascade,
  alumno_id uuid not null references public.alumnos on delete cascade,
  creado timestamptz not null default now()
);
create index if not exists dispositivos_alumno on public.dispositivos (alumno_id);

create table if not exists public.clases (
  id uuid primary key default gen_random_uuid(),
  profesor_id uuid not null references public.profesores on delete cascade,
  titulo text not null check (length(titulo) between 1 and 200),
  capitulos jsonb not null default '[]' check (jsonb_typeof(capitulos) = 'array'),
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index if not exists clases_profesor on public.clases (profesor_id);

create table if not exists public.asignaciones (
  clase_id uuid not null references public.clases on delete cascade,
  alumno_id uuid not null references public.alumnos on delete cascade,
  creado timestamptz not null default now(),
  primary key (clase_id, alumno_id)
);
create index if not exists asignaciones_alumno on public.asignaciones (alumno_id);

create table if not exists public.progreso (
  alumno_id uuid not null references public.alumnos on delete cascade,
  clase_id uuid not null references public.clases on delete cascade,
  datos jsonb not null default '{}',
  actualizado timestamptz not null default now(),
  primary key (alumno_id, clase_id)
);

-- ---------- funciones auxiliares (security definer: evitan recursión entre políticas) ----------

create or replace function public.mis_alumnos() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select alumno_id from public.dispositivos where usuario_id = auth.uid()
$$;

create or replace function public.es_mi_alumno(a uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.alumnos where id = a and profesor_id = auth.uid())
$$;

create or replace function public.es_mi_clase(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clases where id = c and profesor_id = auth.uid())
$$;

-- El alumno abre el link de invitación: su sesión queda vinculada a ese alumno.
create or replace function public.canjear_invitacion(p_codigo text) returns json
language plpgsql security definer set search_path = '' as $$
declare
  a public.alumnos;
  p text;
begin
  if auth.uid() is null then raise exception 'sin_sesion'; end if;
  select * into a from public.alumnos where codigo = p_codigo;
  if not found then raise exception 'invitacion_invalida'; end if;
  insert into public.dispositivos (usuario_id, alumno_id) values (auth.uid(), a.id)
    on conflict (usuario_id) do update set alumno_id = excluded.alumno_id, creado = now();
  select nombre into p from public.profesores where id = a.profesor_id;
  return json_build_object('id', a.id, 'nombre', a.nombre, 'profesor', p);
end $$;

revoke execute on function public.mis_alumnos() from public, anon;
revoke execute on function public.es_mi_alumno(uuid) from public, anon;
revoke execute on function public.es_mi_clase(uuid) from public, anon;
revoke execute on function public.canjear_invitacion(text) from public, anon;
grant execute on function public.mis_alumnos() to authenticated;
grant execute on function public.es_mi_alumno(uuid) to authenticated;
grant execute on function public.es_mi_clase(uuid) to authenticated;
grant execute on function public.canjear_invitacion(text) to authenticated;

-- ---------- permisos por fila ----------

alter table public.profesores enable row level security;
alter table public.alumnos enable row level security;
alter table public.dispositivos enable row level security;
alter table public.clases enable row level security;
alter table public.asignaciones enable row level security;
alter table public.progreso enable row level security;

revoke all on public.profesores, public.alumnos, public.dispositivos, public.clases, public.asignaciones, public.progreso from anon;
grant select, insert, update, delete on public.profesores, public.alumnos, public.dispositivos, public.clases, public.asignaciones, public.progreso to authenticated;

drop policy if exists "profesor: su perfil" on public.profesores;
create policy "profesor: su perfil" on public.profesores for all to authenticated
  using (id = auth.uid())
  -- Una sesión anónima (la del alumno) no puede volverse profesor.
  with check (id = auth.uid() and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false);
drop policy if exists "alumno: ve a su profesor" on public.profesores;
create policy "alumno: ve a su profesor" on public.profesores for select to authenticated
  using (id in (select a.profesor_id from public.alumnos a where a.id in (select public.mis_alumnos())));

drop policy if exists "profesor: sus alumnos" on public.alumnos;
create policy "profesor: sus alumnos" on public.alumnos for all to authenticated
  using (profesor_id = auth.uid()) with check (profesor_id = auth.uid());
drop policy if exists "alumno: se ve a sí mismo" on public.alumnos;
create policy "alumno: se ve a sí mismo" on public.alumnos for select to authenticated
  using (id in (select public.mis_alumnos()));

drop policy if exists "dispositivos: ver" on public.dispositivos;
create policy "dispositivos: ver" on public.dispositivos for select to authenticated
  using (usuario_id = auth.uid() or public.es_mi_alumno(alumno_id));
drop policy if exists "dispositivos: desvincular" on public.dispositivos;
create policy "dispositivos: desvincular" on public.dispositivos for delete to authenticated
  using (usuario_id = auth.uid() or public.es_mi_alumno(alumno_id));

drop policy if exists "profesor: sus clases" on public.clases;
create policy "profesor: sus clases" on public.clases for all to authenticated
  using (profesor_id = auth.uid()) with check (profesor_id = auth.uid());
drop policy if exists "alumno: clases asignadas" on public.clases;
create policy "alumno: clases asignadas" on public.clases for select to authenticated
  using (exists (select 1 from public.asignaciones s where s.clase_id = id and s.alumno_id in (select public.mis_alumnos())));

drop policy if exists "profesor: asigna" on public.asignaciones;
create policy "profesor: asigna" on public.asignaciones for all to authenticated
  using (public.es_mi_alumno(alumno_id) and public.es_mi_clase(clase_id))
  with check (public.es_mi_alumno(alumno_id) and public.es_mi_clase(clase_id));
drop policy if exists "alumno: sus asignaciones" on public.asignaciones;
create policy "alumno: sus asignaciones" on public.asignaciones for select to authenticated
  using (alumno_id in (select public.mis_alumnos()));

drop policy if exists "alumno: su progreso" on public.progreso;
create policy "alumno: su progreso" on public.progreso for all to authenticated
  using (alumno_id in (select public.mis_alumnos()))
  with check (alumno_id in (select public.mis_alumnos()));
drop policy if exists "profesor: progreso de sus alumnos" on public.progreso;
create policy "profesor: progreso de sus alumnos" on public.progreso for select to authenticated
  using (public.es_mi_alumno(alumno_id));
drop policy if exists "profesor: borra progreso" on public.progreso;
create policy "profesor: borra progreso" on public.progreso for delete to authenticated
  using (public.es_mi_alumno(alumno_id));

-- ---------- audios (Storage) ----------
-- Ruta de cada archivo: <id del profesor>/<nombre>.webm

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audios', 'audios', false, 10485760, array['audio/*'])
on conflict (id) do nothing;

drop policy if exists "audios: profesor sube" on storage.objects;
create policy "audios: profesor sube" on storage.objects for insert to authenticated
  with check (bucket_id = 'audios' and (storage.foldername(name))[1] = auth.uid()::text
              and exists (select 1 from public.profesores where id = auth.uid()));
drop policy if exists "audios: profesor ve y borra" on storage.objects;
create policy "audios: profesor ve y borra" on storage.objects for select to authenticated
  using (bucket_id = 'audios' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "audios: profesor borra" on storage.objects;
create policy "audios: profesor borra" on storage.objects for delete to authenticated
  using (bucket_id = 'audios' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "audios: alumno escucha" on storage.objects;
create policy "audios: alumno escucha" on storage.objects for select to authenticated
  using (bucket_id = 'audios' and (storage.foldername(name))[1] in
         (select a.profesor_id::text from public.alumnos a where a.id in (select public.mis_alumnos())));

-- ---------- lectura de diagramas con IA ----------
-- La función de Supabase "leer-diagrama" llama a usar_ia() antes de cada lectura:
-- solo pueden usarla los profesores y los alumnos vinculados, con un tope diario.

create table if not exists public.uso_ia (
  usuario_id uuid not null references auth.users (id) on delete cascade,
  dia        date not null default current_date,
  cantidad   int  not null default 0,
  primary key (usuario_id, dia)
);
alter table public.uso_ia enable row level security;
revoke all on public.uso_ia from anon, authenticated;

create or replace function public.usar_ia() returns int
language plpgsql security definer set search_path = public as $$
declare
  tope int;
  n int;
begin
  if auth.uid() is null then raise exception 'sin_sesion'; end if;
  if exists (select 1 from profesores where id = auth.uid())
     and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false then
    tope := 150;
  elsif exists (select 1 from dispositivos where usuario_id = auth.uid()) then
    tope := 40;
  else
    raise exception 'sin_permiso_ia';
  end if;
  insert into uso_ia (usuario_id, dia, cantidad) values (auth.uid(), current_date, 1)
  on conflict (usuario_id, dia) do update set cantidad = uso_ia.cantidad + 1
  returning cantidad into n;
  if n > tope then raise exception 'limite_ia'; end if;
  return tope - n;
end $$;
revoke execute on function public.usar_ia() from public, anon;
grant execute on function public.usar_ia() to authenticated;
