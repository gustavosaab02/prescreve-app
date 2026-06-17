-- ══════════════════════════════════════════════════════════
-- RLS — Row Level Security para todas as tabelas sensíveis
-- Bloqueia acesso via anon key. Edge functions (service_role)
-- não são afetadas — elas bypassam RLS automaticamente.
-- ══════════════════════════════════════════════════════════

-- PATIENTS
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;

-- Paciente vê/edita o próprio registro (match por email do auth)
CREATE POLICY "patient_own" ON patients
  FOR ALL TO authenticated
  USING (email = auth.email())
  WITH CHECK (email = auth.email());

-- Médico vê/gerencia os pacientes vinculados a ele
CREATE POLICY "doctor_manages_patients" ON patients
  FOR ALL TO authenticated
  USING (doctor_id = auth.uid())
  WITH CHECK (doctor_id = auth.uid());

-- ──────────────────────────────────────────────────────────

-- DOCTORS
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;

-- Médico vê/edita o próprio perfil
CREATE POLICY "doctor_own" ON doctors
  FOR ALL TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Paciente pode ler dados básicos do seu médico
CREATE POLICY "patient_reads_own_doctor" ON doctors
  FOR SELECT TO authenticated
  USING (
    id IN (SELECT doctor_id FROM patients WHERE email = auth.email())
  );

-- ──────────────────────────────────────────────────────────

-- RECOMMENDATIONS
ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;

-- Médico gerencia as próprias prescrições
CREATE POLICY "doctor_recommendations" ON recommendations
  FOR ALL TO authenticated
  USING (doctor_id = auth.uid())
  WITH CHECK (doctor_id = auth.uid());

-- Paciente lê/atualiza as próprias prescrições
CREATE POLICY "patient_recommendations" ON recommendations
  FOR ALL TO authenticated
  USING (
    patient_id IN (SELECT id FROM patients WHERE email = auth.email())
  )
  WITH CHECK (
    patient_id IN (SELECT id FROM patients WHERE email = auth.email())
  );

-- ──────────────────────────────────────────────────────────

-- RECOMMENDATION_ITEMS
ALTER TABLE recommendation_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doctor_rec_items" ON recommendation_items
  FOR ALL TO authenticated
  USING (
    recommendation_id IN (SELECT id FROM recommendations WHERE doctor_id = auth.uid())
  )
  WITH CHECK (
    recommendation_id IN (SELECT id FROM recommendations WHERE doctor_id = auth.uid())
  );

CREATE POLICY "patient_rec_items" ON recommendation_items
  FOR SELECT TO authenticated
  USING (
    recommendation_id IN (
      SELECT r.id FROM recommendations r
      JOIN patients p ON r.patient_id = p.id
      WHERE p.email = auth.email()
    )
  );

-- ──────────────────────────────────────────────────────────

-- COTACOES
ALTER TABLE cotacoes ENABLE ROW LEVEL SECURITY;

-- Paciente lê cotações das suas prescrições
CREATE POLICY "patient_reads_cotacoes" ON cotacoes
  FOR SELECT TO authenticated
  USING (
    recommendation_id IN (
      SELECT r.id FROM recommendations r
      JOIN patients p ON r.patient_id = p.id
      WHERE p.email = auth.email()
    )
  );

-- Médico lê cotações das suas prescrições
CREATE POLICY "doctor_reads_cotacoes" ON cotacoes
  FOR SELECT TO authenticated
  USING (
    recommendation_id IN (
      SELECT id FROM recommendations WHERE doctor_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────

-- FARMACIAS_PARCEIRAS — qualquer usuário autenticado pode ler
ALTER TABLE farmacias_parceiras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_reads_farmacias" ON farmacias_parceiras
  FOR SELECT TO authenticated
  USING (true);
