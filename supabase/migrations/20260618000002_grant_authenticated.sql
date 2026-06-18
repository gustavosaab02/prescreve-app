-- Garantir que o role authenticated tem acesso às tabelas sensíveis.
-- O REVOKE FROM anon pode afetar o role authenticated em alguns cenários
-- do Supabase/PostgREST. Grants explícitos garantem que o app funciona.

GRANT SELECT, INSERT, UPDATE, DELETE ON patients              TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON doctors               TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON recommendations       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON recommendation_items  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON cotacoes              TO authenticated;
GRANT SELECT                         ON farmacias_parceiras   TO authenticated;
