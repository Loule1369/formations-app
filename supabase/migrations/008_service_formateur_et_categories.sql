-- Service du formateur (FORDOC, SAV, DIH, INSTALL...) : permet de ventiler les frais de déplacement
-- par service dans le Chiffrage, en plus du statut interne/fordoc déjà existant.
alter table formateurs add column if not exists service text;

update formateurs set service = 'FORDOC' where nom = 'Jean FORDOC1';
update formateurs set service = 'FORDOC' where nom = 'Corinne FORDOC2';
update formateurs set service = 'SAV' where nom = 'Isabelle SAV';
update formateurs set service = 'DIH' where nom = 'Maxime DIH';
update formateurs set service = 'INSTALL' where nom = 'Eglantine INSTALL';

-- Grandes thématiques du devis (formation, déplacement/hébergement, administratif, licences Ascentline...).
alter table devis_lignes add column if not exists categorie text not null default 'autre';
