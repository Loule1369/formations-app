-- Ordre d'affichage manuel des lignes de devis au sein d'une même catégorie (boutons monter/descendre
-- dans le Chiffrage). 0 par défaut pour toutes les lignes existantes : elles gardent leur ordre de
-- création (via created_at) tant qu'on n'a pas explicitement réordonné une catégorie.
alter table devis_lignes add column if not exists ordre numeric not null default 0;
