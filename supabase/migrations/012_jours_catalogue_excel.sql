-- Jours de préparation / animation lus DIRECTEMENT dans les colonnes K (Nb jours animation) et
-- L (Nb jours prep) de l'onglet "ACTIF" du fichier "Tarification formations pour 2026.xlsx" — plutôt
-- que recalculés depuis les heures (duree_h / 7), pour coller exactement au fichier de référence
-- (l'arrondi Excel n'est pas une simple division : c'est un arrondi au quart de jour le plus proche).
alter table formations_catalogue add column if not exists jours_animation_catalogue numeric;
alter table formations_catalogue add column if not exists jours_preparation_catalogue numeric;

update formations_catalogue set jours_animation_catalogue = 0.25, jours_preparation_catalogue = 0.25 where code = 'CONV-F1';
update formations_catalogue set jours_animation_catalogue = 2,    jours_preparation_catalogue = 0.5  where code = 'CONV-M';
update formations_catalogue set jours_animation_catalogue = 0.75, jours_preparation_catalogue = 0.5  where code = 'XPTS-F';
update formations_catalogue set jours_animation_catalogue = 2,    jours_preparation_catalogue = 0.5  where code = 'XPTS-M';
update formations_catalogue set jours_animation_catalogue = 3,    jours_preparation_catalogue = 1    where code = 'MINIL-M';
update formations_catalogue set jours_animation_catalogue = 1,    jours_preparation_catalogue = 0.5  where code = 'FORMxx-FM';
update formations_catalogue set jours_animation_catalogue = 0.75, jours_preparation_catalogue = 0.5  where code = 'COIFxx-FM';
update formations_catalogue set jours_animation_catalogue = 1.5,  jours_preparation_catalogue = 0.5  where code = 'ODAW-IN';
update formations_catalogue set jours_animation_catalogue = 4,    jours_preparation_catalogue = 1.5  where code = 'ODAW-KU-S';
update formations_catalogue set jours_animation_catalogue = 1,    jours_preparation_catalogue = 2    where code = 'LMWCS';

-- Les lignes de devis générées avant cette mise à jour utilisaient encore l'ancienne structure
-- (Animation + Préparation séparées, ou un calcul en jours différent) : on les efface pour forcer
-- une régénération propre au prochain clic sur "Générer / réinitialiser depuis ce planning" — les
-- lignes ajoutées à la main (origine = null) ne sont pas touchées.
delete from devis_lignes where origine = 'planning' and categorie = 'formation';
