-- Ajoute le prix de revient (coût) en plus du prix de vente, pour calculer la marge dans le Chiffrage.

alter table formations_catalogue add column if not exists prix_revient numeric;
alter table devis_lignes add column if not exists prix_revient numeric not null default 0;

update formations_catalogue set prix_revient = 319 where code = 'CONV-F1';
update formations_catalogue set prix_revient = 1434 where code = 'CONV-M';
update formations_catalogue set prix_revient = 797 where code = 'XPTS-F';
update formations_catalogue set prix_revient = 1434 where code = 'XPTS-M';
update formations_catalogue set prix_revient = 2231 where code = 'MINIL-M';
update formations_catalogue set prix_revient = 876 where code = 'FORMxx-FM';
update formations_catalogue set prix_revient = 797 where code = 'COIFxx-FM';
update formations_catalogue set prix_revient = 1195 where code = 'ODAW-IN';
update formations_catalogue set prix_revient = 3108 where code = 'ODAW-KU-S';
update formations_catalogue set prix_revient = 1673 where code = 'LMWCS';
