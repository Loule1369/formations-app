-- Remplace le catalogue fictif par un échantillon du vrai catalogue (source : Tarification formations
-- pour 2026.xlsx, feuille ACTIF ; prix de vente HT). Supprime aussi les lignes de demande existantes qui
-- pointaient vers l'ancien catalogue fictif (données de test uniquement).

delete from demande_lignes where formation_id in (select id from formations_catalogue);
delete from formations_catalogue;

insert into formations_catalogue (code, nom, duree_h, prix) values
  ('CONV-F1', 'CONVOYEURS INTELIS : S''approprier le fonctionnement niv 1', 2, 530),
  ('CONV-M', 'CONVOYEURS INTELIS : Effectuer la maintenance', 14, 2860),
  ('XPTS-F', 'XPTS : S''approprier le fonctionnement', 6, 1360),
  ('XPTS-M', 'XPTS : Effectuer la maintenance', 14, 2860),
  ('MINIL-M', 'MINILOAD : Effectuer la maintenance', 21, 4520),
  ('FORMxx-FM', 'FORMEUSE F12 / F15 / F16 : fonctionnement et maintenance', 7, 1660),
  ('COIFxx-FM', 'FERMEUSE C10 / C12 / C24 : fonctionnement et maintenance', 6, 1360),
  ('ODAW-IN', 'ODATIO WMS - Découverte des flux Odatio', 11, 2260),
  ('ODAW-KU-S', 'ODATIO WMS : Key User (environnement Standard)', 28, 6180),
  ('LMWCS', 'LM WCS : Piloter les flux', 7, 3040);

update formateurs set competences = array['COIFxx-FM', 'FORMxx-FM'] where nom = 'Jean FORDOC1';
update formateurs set competences = array['CONV-F1', 'CONV-M'] where nom = 'Corinne FORDOC2';
update formateurs set competences = array['XPTS-F', 'XPTS-M', 'MINIL-M'] where nom = 'Isabelle SAV';
update formateurs set competences = array['ODAW-IN', 'ODAW-KU-S'] where nom = 'Maxime DIH';
update formateurs set competences = array['LMWCS'] where nom = 'Eglantine INSTALL';
