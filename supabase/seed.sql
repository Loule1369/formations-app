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
  ('Test Formateur Interne 1', 'interne', 'Lyon', array['CONV-OP', 'CONV-MGR', 'STOCK-AUTO']),
  ('Test Formateur Interne 2', 'interne', 'Lille', array['WMS-BASE', 'WMS-ADMIN', 'WCS-SUPERV']),
  ('Test Formateur FORDOC', 'fordoc', 'Paris', array['FORMEUSE', 'FERMEUSE']);

insert into clients (nom, secteur) values
  ('Entrepôt Fictif Nord SARL', 'Logistique e-commerce'),
  ('LogiTest Distribution SA', 'Grande distribution');
