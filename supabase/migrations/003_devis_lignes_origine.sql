-- Distingue les lignes de devis générées automatiquement depuis le planning des lignes ajoutées à la main,
-- pour pouvoir régénérer les premières sans toucher aux secondes (ex: licences Ascentline saisies manuellement).
alter table devis_lignes add column if not exists origine text;
