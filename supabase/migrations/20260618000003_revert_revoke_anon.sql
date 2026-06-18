-- O REVOKE FROM anon estava quebrando o app porque detectarPerfil
-- pode rodar antes da sessão estar pronta. Com RLS ativo as políticas
-- já garantem que anon não vê nenhuma linha — o REVOKE é desnecessário.

GRANT SELECT, INSERT, UPDATE, DELETE ON patients             TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON doctors              TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON recommendations      TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON recommendation_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON cotacoes             TO anon;
GRANT SELECT                         ON farmacias_parceiras  TO anon;
