-- Clients fictifs, mais catalogue de formations et tarifs réels
-- (source : "Tarification formations pour 2026.xlsx" et "2026_Outil de chiffrage des offres de formation.xlsx").

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

insert into formateurs (nom, statut, base_depart, competences) values
  ('Jean FORDOC1', 'fordoc', 'Paris', array['COIFxx-FM', 'FORMxx-FM']),
  ('Corinne FORDOC2', 'fordoc', 'Lyon', array['CONV-F1', 'CONV-M']),
  ('Isabelle SAV', 'interne', 'Lille', array['XPTS-F', 'XPTS-M', 'MINIL-M']),
  ('Maxime DIH', 'interne', 'Nantes', array['ODAW-IN', 'ODAW-KU-S']),
  ('Eglantine INSTALL', 'interne', 'Toulouse', array['LMWCS']);

insert into clients (nom, secteur) values
  ('Entrepôt Fictif Nord SARL', 'Logistique e-commerce'),
  ('LogiTest Distribution SA', 'Grande distribution');
