-- Pareo — Row Level Security
--
-- Filtrar por household_id no código é a primeira defesa. A RLS é a rede que segura
-- o dia em que alguém esquecer um WHERE — e o dia em que um bug de IDOR aparecer.
--
-- A API executa, no início de cada transação de request:
--     SET LOCAL app.current_household = '<uuid já autorizado pelo JWT>';
-- SET LOCAL morre no fim da transação, o que é obrigatório com pool de conexões:
-- sem isso, a próxima request reaproveitaria o household da anterior.
--
-- Requer que a aplicação conecte com um usuário SEM BYPASSRLS e sem ser owner
-- das tabelas (o owner ignora a policy a menos que FORCE seja aplicado abaixo).
--
--   CREATE ROLE pareo_app LOGIN PASSWORD '…';
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pareo_app;
--
-- Aplicar:  psql "$DATABASE_URL" -f sql/002_rls.sql

BEGIN;

CREATE OR REPLACE FUNCTION current_household() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_household', true), '')::uuid
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounts','credit_cards','card_statements','categories','merchants',
    'transactions','categorization_rules','goals','goal_contributions',
    'import_batches','ai_insights','household_members','household_invites'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING      (household_id = current_household())
        WITH CHECK (household_id = current_household())
    $p$, t);
  END LOOP;
END $$;

-- transaction_splits não tem household_id próprio: herda o da transação.
ALTER TABLE transaction_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_splits FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transaction_splits
  USING (EXISTS (
    SELECT 1 FROM transactions t
     WHERE t.id = transaction_splits.transaction_id
       AND t.household_id = current_household()
  ));

-- households: um membro só enxerga o household em que está.
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE households FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON households
  USING (id = current_household());

-- users e refresh_tokens ficam FORA da RLS: são acessados no fluxo de login,
-- antes de existir um household resolvido. O isolamento ali é feito por
-- WHERE explícito no service de auth, que nunca recebe id vindo do cliente.

COMMIT;
