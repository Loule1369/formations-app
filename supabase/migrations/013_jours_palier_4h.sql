-- Nouvelle règle de conversion heures → jours pour le chiffrage, à la demande du chef de projet :
-- un palier par demi-journée de 4h (arrondi au-dessus), plutôt que l'arrondi au quart de jour (base 7h)
-- calqué sur le fichier Excel. Exemples : 6h/7h/8h = 1 jour, 9-12h = 1,5 jour, 13-16h = 2 jours.
-- jours = CEIL(heures / 4) * 0.5
update formations_catalogue set jours_animation_catalogue = 0.5, jours_preparation_catalogue = 0.5 where code = 'CONV-F1';
update formations_catalogue set jours_animation_catalogue = 2,   jours_preparation_catalogue = 0.5 where code = 'CONV-M';
update formations_catalogue set jours_animation_catalogue = 1,   jours_preparation_catalogue = 0.5 where code = 'XPTS-F';
update formations_catalogue set jours_animation_catalogue = 2,   jours_preparation_catalogue = 0.5 where code = 'XPTS-M';
update formations_catalogue set jours_animation_catalogue = 3,   jours_preparation_catalogue = 1   where code = 'MINIL-M';
update formations_catalogue set jours_animation_catalogue = 1,   jours_preparation_catalogue = 0.5 where code = 'FORMxx-FM';
update formations_catalogue set jours_animation_catalogue = 1,   jours_preparation_catalogue = 0.5 where code = 'COIFxx-FM';
update formations_catalogue set jours_animation_catalogue = 1.5, jours_preparation_catalogue = 0.5 where code = 'ODAW-IN';
update formations_catalogue set jours_animation_catalogue = 3.5, jours_preparation_catalogue = 1.5 where code = 'ODAW-KU-S';
update formations_catalogue set jours_animation_catalogue = 1,   jours_preparation_catalogue = 2   where code = 'LMWCS';

-- Les lignes de devis "formation" générées avant ce changement de barème gardent l'ancien calcul
-- figé : on les efface pour qu'elles se régénèrent avec les nouveaux jours au prochain chargement du
-- chiffrage (resynchronisation automatique). Les lignes modifiées à la main (Manuel) ne sont pas
-- touchées par une resynchronisation normale — utilisez "Tout réinitialiser" si besoin de les forcer.
delete from devis_lignes where origine = 'planning' and categorie = 'formation';
