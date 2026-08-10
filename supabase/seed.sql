-- Données fictives pour le prototype (aucun vrai client/formateur).

insert into formations_catalogue (code, nom, duree_h, prerequis, prix) values
  ('CONV-OP', 'Convoyeurs automatisés - opérateurs', 4, null, 800),
  ('CONV-MGR', 'Convoyeurs automatisés - encadrement', 3, 'CONV-OP recommandé', 700),
  ('STOCK-AUTO', 'Stockage automatisé - opérateurs', 7, null, 1200),
  ('FORMEUSE', 'Formeuse de cartons - conduite et maintenance niveau 1', 7, null, 1100),
  ('FERMEUSE', 'Fermeuse de cartons - conduite et maintenance niveau 1', 4, null, 800),
  ('WMS-BASE', 'WMS - pilotage des flux (utilisateurs)', 7, null, 1300),
  ('WMS-ADMIN', 'WMS - administration et paramétrage', 14, 'WMS-BASE requis', 2400),
  ('WCS-SUPERV', 'WCS - supervision des équipements', 7, null, 1300);

insert into formateurs (nom, statut, base_depart, competences) values
  ('Jean FORDOC1', 'fordoc', 'Paris', array['FORMEUSE', 'FERMEUSE']),
  ('Corinne FORDOC2', 'fordoc', 'Lyon', array['CONV-OP', 'CONV-MGR']),
  ('Isabelle SAV', 'interne', 'Lille', array['STOCK-AUTO', 'WCS-SUPERV']),
  ('Maxime DIH', 'interne', 'Nantes', array['WMS-BASE', 'WMS-ADMIN']),
  ('Eglantine INSTALL', 'interne', 'Toulouse', array['CONV-OP', 'STOCK-AUTO']);

insert into clients (nom, secteur) values
  ('Entrepôt Fictif Nord SARL', 'Logistique e-commerce'),
  ('LogiTest Distribution SA', 'Grande distribution');
