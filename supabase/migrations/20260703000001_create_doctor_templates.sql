CREATE TABLE IF NOT EXISTS doctor_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL,
  name TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE doctor_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doctor_templates_own" ON doctor_templates
  FOR ALL USING (doctor_id = auth.uid());
