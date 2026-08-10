-- Permet de dupliquer une formation en plusieurs groupes (ex: 2 sessions pour 2 groupes de participants).
alter table demande_lignes add column if not exists groupe integer;
