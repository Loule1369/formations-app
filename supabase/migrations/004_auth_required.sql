-- Restreint l'accès aux données aux seuls utilisateurs authentifiés (au lieu de "tout le monde").

drop policy if exists "allow all - clients" on clients;
drop policy if exists "allow all - formateurs" on formateurs;
drop policy if exists "allow all - absences" on absences;
drop policy if exists "allow all - formations_catalogue" on formations_catalogue;
drop policy if exists "allow all - demandes" on demandes;
drop policy if exists "allow all - demande_lignes" on demande_lignes;
drop policy if exists "allow all - scenarios" on scenarios;
drop policy if exists "allow all - creneaux" on creneaux;
drop policy if exists "allow all - devis_lignes" on devis_lignes;

create policy "authentifie - clients" on clients for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authentifie - formateurs" on formateurs for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authentifie - absences" on absences for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authentifie - formations_catalogue" on formations_catalogue for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authentifie - demandes" on demandes for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authentifie - demande_lignes" on demande_lignes for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authentifie - scenarios" on scenarios for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authentifie - creneaux" on creneaux for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authentifie - devis_lignes" on devis_lignes for all using (auth.uid() is not null) with check (auth.uid() is not null);
