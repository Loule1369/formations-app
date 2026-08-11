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
  service text,
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
  duree_prep_h numeric,
  prerequis text,
  prix numeric,
  prix_revient numeric,
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
  groupe integer,
  created_at timestamptz not null default now()
);

create table scenarios (
  id uuid primary key default gen_random_uuid(),
  demande_id uuid not null references demandes(id) on delete cascade,
  nom text not null default 'Option A',
  est_retenu boolean not null default false,
  created_at timestamptz not null default now()
);

create table creneaux (
  id uuid primary key default gen_random_uuid(),
  demande_id uuid references demandes(id) on delete cascade,
  demande_ligne_id uuid references demande_lignes(id) on delete cascade,
  scenario_id uuid references scenarios(id) on delete cascade,
  formateur_id uuid not null references formateurs(id) on delete cascade,
  type text not null check (type in ('formation', 'deplacement')),
  date date not null,
  heure_debut time not null,
  heure_fin time not null,
  notes text,
  modifie_manuellement boolean not null default false,
  created_at timestamptz not null default now()
);

create table devis_lignes (
  id uuid primary key default gen_random_uuid(),
  demande_id uuid not null references demandes(id) on delete cascade,
  libelle text not null,
  quantite numeric not null default 1,
  prix_unitaire numeric not null default 0,
  prix_revient numeric not null default 0,
  categorie text not null default 'autre',
  origine text,
  created_at timestamptz not null default now()
);

-- RLS : ouverte pour le prototype solo (clé publique anon utilisée côté client)
alter table clients enable row level security;
alter table formateurs enable row level security;
alter table absences enable row level security;
alter table formations_catalogue enable row level security;
alter table demandes enable row level security;
alter table demande_lignes enable row level security;
alter table scenarios enable row level security;
alter table creneaux enable row level security;
alter table devis_lignes enable row level security;

-- Accès réservé aux utilisateurs authentifiés (voir supabase/migrations/004_auth_required.sql).
create policy "authentifie - clients" on clients for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authentifie - formateurs" on formateurs for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authentifie - absences" on absences for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authentifie - formations_catalogue" on formations_catalogue for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authentifie - demandes" on demandes for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authentifie - demande_lignes" on demande_lignes for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authentifie - scenarios" on scenarios for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authentifie - creneaux" on creneaux for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authentifie - devis_lignes" on devis_lignes for all using (auth.uid() is not null) with check (auth.uid() is not null);
