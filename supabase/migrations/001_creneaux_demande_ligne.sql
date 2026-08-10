alter table creneaux
  add column if not exists demande_ligne_id uuid references demande_lignes(id) on delete cascade;
