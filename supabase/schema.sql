-- Schéma initial "formations-app" — prototype personnel, données fictives uniquement.
-- RLS ouverte en lecture/écriture pour un usage solo. À restreindre si l'app devient multi-utilisateurs.

create extension if not exists pgcrypto;

create table clients (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  secteur text,
  notes text,
  created_at timestamptz not null default now()
);

create table formateurs (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  statut text not null check (statut in ('interne', 'fordoc')),
  base_depart text,
  competences text[] default '{}',
  created_at timestamptz not null default now()
);

create table absences (
  id uuid primary key default gen_random_uuid(),
  formateur_id uuid not null references formateurs(id) on delete cascade,
  date_debut date not null,
  date_fin date not null,
  motif text,
  created_at timestamptz not null default now()
);

create table formations_catalogue (
  id uuid primary key default gen_random_uuid(),
  code text,
  nom text not null,
  duree_h numeric not null,
  prerequis text,
  prix numeric,
  created_at timestamptz not null default now()
);

create table demandes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  statut text not null default 'besoin_exprime'
    check (statut in ('besoin_exprime', 'devis_envoye', 'valide', 'saisi_queoval', 'termine')),
  date_creation date not null default current_date,
  notes text,
  created_at timestamptz not null default now()
);

create table demande_lignes (
  id uuid primary key default gen_random_uuid(),
  demande_id uuid not null references demandes(id) on delete cascade,
  formation_id uuid not null references formations_catalogue(id),
  nb_participants int,
  created_at timestamptz not null default now()
);

create table creneaux (
  id uuid primary key default gen_random_uuid(),
  demande_id uuid references demandes(id) on delete cascade,
  formateur_id uuid not null references formateurs(id) on delete cascade,
  type text not null check (type in ('formation', 'deplacement')),
  date date not null,
  heure_debut time not null,
  heure_fin time not null,
  notes text,
  created_at timestamptz not null default now()
);

create table devis_lignes (
  id uuid primary key default gen_random_uuid(),
  demande_id uuid not null references demandes(id) on delete cascade,
  libelle text not null,
  quantite numeric not null default 1,
  prix_unitaire numeric not null default 0,
  created_at timestamptz not null default now()
);

-- RLS : ouverte pour le prototype solo (clé publique anon utilisée côté client)
alter table clients enable row level security;
alter table formateurs enable row level security;
alter table absences enable row level security;
alter table formations_catalogue enable row level security;
alter table demandes enable row level security;
alter table demande_lignes enable row level security;
alter table creneaux enable row level security;
alter table devis_lignes enable row level security;

create policy "allow all - clients" on clients for all using (true) with check (true);
create policy "allow all - formateurs" on formateurs for all using (true) with check (true);
create policy "allow all - absences" on absences for all using (true) with check (true);
create policy "allow all - formations_catalogue" on formations_catalogue for all using (true) with check (true);
create policy "allow all - demandes" on demandes for all using (true) with check (true);
create policy "allow all - demande_lignes" on demande_lignes for all using (true) with check (true);
create policy "allow all - creneaux" on creneaux for all using (true) with check (true);
create policy "allow all - devis_lignes" on devis_lignes for all using (true) with check (true);
