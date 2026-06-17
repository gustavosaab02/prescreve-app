-- Revogar acesso da role anon às tabelas sensíveis.
-- O app usa Supabase Auth (role: authenticated) — anon não precisa
-- ter acesso direto a nenhuma tabela com dados de saúde ou pessoais.

REVOKE ALL ON patients              FROM anon;
REVOKE ALL ON doctors               FROM anon;
REVOKE ALL ON recommendations       FROM anon;
REVOKE ALL ON recommendation_items  FROM anon;
REVOKE ALL ON cotacoes              FROM anon;

-- Garantir que RLS está habilitado (belt-and-suspenders)
ALTER TABLE patients             ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctors              ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE cotacoes             ENABLE ROW LEVEL SECURITY;

-- Dropar e recriar políticas para garantir estado limpo
DROP POLICY IF EXISTS "patient_own"              ON patients;
DROP POLICY IF EXISTS "doctor_manages_patients"  ON patients;
DROP POLICY IF EXISTS "doctor_own"               ON doctors;
DROP POLICY IF EXISTS "patient_reads_own_doctor" ON doctors;
DROP POLICY IF EXISTS "doctor_recommendations"   ON recommendations;
DROP POLICY IF EXISTS "patient_recommendations"  ON recommendations;
DROP POLICY IF EXISTS "doctor_rec_items"         ON recommendation_items;
DROP POLICY IF EXISTS "patient_rec_items"        ON recommendation_items;
DROP POLICY IF EXISTS "patient_reads_cotacoes"   ON cotacoes;
DROP POLICY IF EXISTS "doctor_reads_cotacoes"    ON cotacoes;
DROP POLICY IF EXISTS "authenticated_reads_farmacias" ON farmacias_parceiras;

-- PATIENTS
CREATE POLICY "patient_own" ON patients
  FOR ALL TO authenticated
  USING (email = auth.email())
  WITH CHECK (email = auth.email());

CREATE POLICY "doctor_manages_patients" ON patients
  FOR ALL TO authenticated
  USING (doctor_id = auth.uid())
  WITH CHECK (doctor_id = auth.uid());

-- DOCTORS
CREATE POLICY "doctor_own" ON doctors
  FOR ALL TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "patient_reads_own_doctor" ON doctors
  FOR SELECT TO authenticated
  USING (id IN (SELECT doctor_id FROM patients WHERE email = auth.email()));

-- RECOMMENDATIONS
CREATE POLICY "doctor_recommendations" ON recommendations
  FOR ALL TO authenticated
  USING (doctor_id = auth.uid())
  WITH CHECK (doctor_id = auth.uid());

CREATE POLICY "patient_recommendations" ON recommendations
  FOR ALL TO authenticated
  USING (patient_id IN (SELECT id FROM patients WHERE email = auth.email()))
  WITH CHECK (patient_id IN (SELECT id FROM patients WHERE email = auth.email()));

-- RECOMMENDATION_ITEMS
CREATE POLICY "doctor_rec_items" ON recommendation_items
  FOR ALL TO authenticated
  USING (recommendation_id IN (SELECT id FROM recommendations WHERE doctor_id = auth.uid()))
  WITH CHECK (recommendation_id IN (SELECT id FROM recommendations WHERE doctor_id = auth.uid()));

CREATE POLICY "patient_rec_items" ON recommendation_items
  FOR SELECT TO authenticated
  USING (recommendation_id IN (
    SELECT r.id FROM recommendations r
    JOIN patients p ON r.patient_id = p.id
    WHERE p.email = auth.email()
  ));

-- COTACOES
CREATE POLICY "patient_reads_cotacoes" ON cotacoes
  FOR SELECT TO authenticated
  USING (recommendation_id IN (
    SELECT r.id FROM recommendations r
    JOIN patients p ON r.patient_id = p.id
    WHERE p.email = auth.email()
  ));

CREATE POLICY "doctor_reads_cotacoes" ON cotacoes
  FOR SELECT TO authenticated
  USING (recommendation_id IN (
    SELECT id FROM recommendations WHERE doctor_id = auth.uid()
  ));

-- FARMACIAS — authenticated pode ler
ALTER TABLE farmacias_parceiras ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_reads_farmacias" ON farmacias_parceiras
  FOR SELECT TO authenticated USING (true);
