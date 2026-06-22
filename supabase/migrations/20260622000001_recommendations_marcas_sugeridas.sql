-- Adiciona coluna marcas_sugeridas à tabela recommendations
-- Usada pelo site (prescreve-app.html) para guardar marcas sugeridas pelo médico
-- Formato: [{id, nome, site_url}]
ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS marcas_sugeridas JSONB;
