-- Sépare les heures de préparation des heures d'animation : la préparation est due une seule fois
-- par formation, même si plusieurs groupes suivent la même session (contrairement à l'animation).
alter table formations_catalogue add column if not exists duree_prep_h numeric;

update formations_catalogue set duree_prep_h = 2 where code = 'CONV-F1';
update formations_catalogue set duree_prep_h = 4 where code = 'CONV-M';
update formations_catalogue set duree_prep_h = 4 where code = 'XPTS-F';
update formations_catalogue set duree_prep_h = 4 where code = 'XPTS-M';
update formations_catalogue set duree_prep_h = 7 where code = 'MINIL-M';
update formations_catalogue set duree_prep_h = 4 where code = 'FORMxx-FM';
update formations_catalogue set duree_prep_h = 4 where code = 'COIFxx-FM';
update formations_catalogue set duree_prep_h = 4 where code = 'ODAW-IN';
update formations_catalogue set duree_prep_h = 11 where code = 'ODAW-KU-S';
update formations_catalogue set duree_prep_h = 14 where code = 'LMWCS';
