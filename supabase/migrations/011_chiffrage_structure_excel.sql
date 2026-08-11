-- Colonnes pour reproduire la structure du fichier Excel de référence : une ligne par formation avec
-- jours de préparation / nombre de groupes / jours d'animation détaillés, plus un champ commentaires.
alter table devis_lignes add column if not exists jours_preparation numeric;
alter table devis_lignes add column if not exists nb_groupes numeric;
alter table devis_lignes add column if not exists jours_animation_unitaire numeric;
alter table devis_lignes add column if not exists commentaires text;

-- Remise et arrondi final du devis (ligne "REMISE" / "ARRONDI" du récapitulatif).
alter table demandes add column if not exists remise_pv numeric not null default 0;
alter table demandes add column if not exists remise_pr numeric not null default 0;
alter table demandes add column if not exists arrondi_pv numeric;
alter table demandes add column if not exists arrondi_pr numeric;
