-- Marque un bloc "Déplacement" comme ajusté à la main, pour que la resynchronisation automatique
-- (déclenchée à chaque changement d'un bloc formation) ne l'écrase plus.
alter table creneaux add column if not exists modifie_manuellement boolean not null default false;
