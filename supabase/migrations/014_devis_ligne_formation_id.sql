-- Référence directe vers le catalogue sur les lignes de devis "formation" : permet de savoir de façon
-- fiable si une ligne Manuel existante correspond déjà à une formation du planning, pour éviter qu'une
-- même formation apparaisse sur 2 lignes (une manuelle + une générée automatiquement).
alter table devis_lignes add column if not exists formation_id uuid references formations_catalogue(id);
