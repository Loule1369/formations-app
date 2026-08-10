-- Permet plusieurs versions de planning ("scénarios") par demande, testables en parallèle.

create table if not exists scenarios (
  id uuid primary key default gen_random_uuid(),
  demande_id uuid not null references demandes(id) on delete cascade,
  nom text not null default 'Option A',
  est_retenu boolean not null default false,
  created_at timestamptz not null default now()
);

alter table scenarios enable row level security;
create policy "allow all - scenarios" on scenarios for all using (true) with check (true);

alter table creneaux add column if not exists scenario_id uuid references scenarios(id) on delete cascade;

-- Backfill : un scénario par défaut pour chaque demande qui a déjà des créneaux
insert into scenarios (demande_id, nom)
select distinct demande_id, 'Option A'
from creneaux
where demande_id is not null
  and not exists (select 1 from scenarios s where s.demande_id = creneaux.demande_id);

update creneaux c
set scenario_id = s.id
from scenarios s
where c.scenario_id is null and c.demande_id = s.demande_id;
