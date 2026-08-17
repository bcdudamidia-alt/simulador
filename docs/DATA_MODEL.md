# Pareo — Modelo de dados relacional

PostgreSQL 16. DDL executável em [`apps/api/sql/001_init.sql`](../apps/api/sql/001_init.sql);
fonte da verdade para a aplicação em [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma).

---

## 1. Diagrama

```
                          ┌──────────────┐
                          │    users     │  identidade (login)
                          │──────────────│
                          │ id PK        │
                          │ email UNIQUE │
                          │ password_hash│
                          └──────┬───────┘
                                 │ 1
                                 │
                                 │ N
                    ┌────────────▼────────────┐
                    │   household_members     │  papel do usuário no household
                    │─────────────────────────│
                    │ household_id FK ────────┼──┐
                    │ user_id FK              │  │
                    │ role (owner|partner|…)  │  │
                    └─────────────────────────┘  │
                                                 │ N
                                          ┌──────▼───────┐
                                          │  households  │  ← RAIZ DE ISOLAMENTO
                                          │──────────────│     tudo abaixo tem
                                          │ id PK        │     household_id
                                          │ name         │
                                          │ currency     │
                                          └──────┬───────┘
                 ┌──────────────┬────────────────┼──────────────┬───────────────┐
                 │              │                │              │               │
         ┌───────▼──────┐ ┌─────▼───────┐ ┌──────▼──────┐ ┌─────▼──────┐ ┌──────▼──────┐
         │   accounts   │ │credit_cards │ │ categories  │ │   goals    │ │import_batches│
         │──────────────│ │─────────────│ │─────────────│ │────────────│ │─────────────│
         │ id PK        │ │ id PK       │ │ id PK       │ │ id PK      │ │ id PK       │
         │ household_id │ │ household_id│ │ parent_id ↺ │ │ target_amt │ │ file_hash   │
         │ owner_user_id│ │ account_id  │ │ kind        │ │ target_date│ │ status      │
         │ type         │ │ closing_day │ │ is_system   │ │ status     │ │ row counts  │
         │ number_enc 🔒│ │ due_day     │ └──────┬──────┘ └─────┬──────┘ └──────┬──────┘
         │ balance      │ │ last4_enc 🔒│        │              │               │
         └───────┬──────┘ └──────┬──────┘        │        ┌─────▼──────────┐    │
                 │               │               │        │goal_contribut. │    │
                 │ 1             │ 1             │        │────────────────│    │
                 │               │               │        │ goal_id FK     │    │
                 │        ┌──────▼────────┐      │        │ user_id FK     │    │
                 │        │card_statements│      │        │ amount, date   │    │
                 │        │───────────────│      │        └────────────────┘    │
                 │        │ period_ref    │      │                              │
                 │        │ due_date      │      │                              │
                 │        │ total_amount  │      │                              │
                 │        └──────┬────────┘      │                              │
                 │               │               │                              │
                 │ N             │ N             │ N                          N │
         ┌───────▼───────────────▼───────────────▼──────────────────────────────▼──┐
         │                            transactions                                  │
         │──────────────────────────────────────────────────────────────────────────│
         │ id PK · household_id FK · account_id FK? · credit_card_id FK?            │
         │ card_statement_id FK? · category_id FK? · merchant_id FK?                │
         │ import_batch_id FK? · posted_at · amount_cents (± sinal) · description   │
         │ fitid · dedupe_hash · category_source (rule|history|ai|user)             │
         │ category_confidence · sharing (shared|user) · paid_by_user_id            │
         │ UNIQUE (account_id, fitid) · UNIQUE (household_id, dedupe_hash)          │
         └───────┬──────────────────────────────────────────────────┬───────────────┘
                 │ 1                                                │ N
                 │ N                                                │
      ┌──────────▼──────────┐                            ┌──────────▼──────────┐
      │ transaction_splits  │  rateio entre o casal      │      merchants      │
      │─────────────────────│                            │─────────────────────│
      │ transaction_id FK   │                            │ normalized_name UQ  │
      │ user_id FK          │                            │ default_category_id │
      │ amount_cents        │                            │ seen_count          │
      └─────────────────────┘                            └─────────────────────┘

      ┌──────────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
      │ categorization_rules │  │  refresh_tokens  │  │     ai_insights      │
      │──────────────────────│  │──────────────────│  │──────────────────────│
      │ household_id FK      │  │ user_id FK       │  │ household_id FK      │
      │ match_type (contains │  │ token_hash UQ    │  │ reference_month      │
      │   |starts|regex)     │  │ family_id        │  │ payload JSONB        │
      │ pattern · priority   │  │ revoked_at       │  │ model · tokens       │
      │ category_id FK       │  │ expires_at       │  └──────────────────────┘
      └──────────────────────┘  └──────────────────┘

      🔒 = criptografado em repouso (AES-256-GCM) + blind index para busca
```

---

## 2. Tabelas

### 2.1 Identidade e isolamento

#### `users`
Identidade de login. **Não** carrega dado financeiro — isso vive no household.

| coluna | tipo | notas |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `email` | `citext` UNIQUE | case-insensitive; `citext` evita `lower(email)` espalhado |
| `password_hash` | `text` | bcrypt cost 12. Nunca sai da camada de service |
| `name` | `text` | |
| `avatar_url` | `text` NULL | |
| `mfa_secret_enc` | `bytea` NULL | TOTP cifrado (v1.1) |
| `email_verified_at` | `timestamptz` NULL | |
| `last_login_at` | `timestamptz` NULL | |
| `created_at` / `updated_at` | `timestamptz` | |

#### `households`
A "carteira do casal". **Raiz de isolamento**: toda tabela de domínio referencia `household_id`,
e é esse valor que a RLS compara com a variável de sessão `app.current_household`.

| coluna | tipo | notas |
|---|---|---|
| `id` | `uuid` PK | |
| `name` | `text` | "Casa da Ana e do Bruno" |
| `currency` | `char(3)` | `BRL` |
| `timezone` | `text` | `America/Sao_Paulo` — define o corte do mês nos relatórios |
| `created_at` / `updated_at` | `timestamptz` | |

Um usuário solteiro tem um household de um membro só. Não existe caminho "sem household":
o registro cria os dois de uma vez, dentro da mesma transação.

#### `household_members`

| coluna | tipo | notas |
|---|---|---|
| `household_id` | `uuid` FK → households | `ON DELETE CASCADE` |
| `user_id` | `uuid` FK → users | `ON DELETE CASCADE` |
| `role` | `enum` | `owner` \| `partner` \| `viewer` |
| `joined_at` | `timestamptz` | |
| PK | `(household_id, user_id)` | |

`viewer` (contador, planejador financeiro) só lê. `partner` tem acesso total exceto
remover o household ou expulsar o `owner`.

#### `refresh_tokens`
Refresh rotativo com detecção de reuso.

| coluna | tipo | notas |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK | |
| `token_hash` | `text` UNIQUE | sha256 do token. O token em claro nunca é persistido |
| `family_id` | `uuid` | todos os tokens derivados do mesmo login. Reuso detectado → revoga a família inteira |
| `expires_at` | `timestamptz` | 30 dias |
| `revoked_at` | `timestamptz` NULL | |
| `user_agent` / `ip` | `text` NULL | para a tela "sessões ativas" |

---

### 2.2 Contas e cartões

#### `accounts`

| coluna | tipo | notas |
|---|---|---|
| `id` | `uuid` PK | |
| `household_id` | `uuid` FK | |
| `owner_user_id` | `uuid` FK NULL | `NULL` = **conta conjunta**; preenchido = conta individual |
| `name` | `text` | "Nubank Bruno" |
| `type` | `enum` | `checking` \| `savings` \| `investment` \| `cash` \| `other` |
| `institution_code` | `text` NULL | código COMPE/ISPB, casado com o `<BANKID>` do OFX |
| `institution_name` | `text` NULL | |
| `number_enc` | `bytea` NULL | 🔒 número da conta cifrado |
| `number_bidx` | `bytea` NULL | blind index — permite achar a conta pelo número do OFX sem decifrar |
| `current_balance_cents` | `bigint` | denormalizado; recalculado na importação |
| `balance_synced_at` | `timestamptz` NULL | do `<LEDGERBAL>` do OFX |
| `color` / `icon` | `text` | UI |
| `is_archived` | `boolean` | soft delete — conta com histórico nunca é apagada |

Índices: `(household_id, is_archived)`, `(household_id, number_bidx)`.

#### `credit_cards`

| coluna | tipo | notas |
|---|---|---|
| `id` | `uuid` PK | |
| `household_id` | `uuid` FK | |
| `owner_user_id` | `uuid` FK NULL | `NULL` = cartão do casal |
| `payment_account_id` | `uuid` FK NULL → accounts | conta de onde a fatura é debitada |
| `name` | `text` | "Inter Black" |
| `brand` | `enum` | `visa` \| `mastercard` \| `elo` \| `amex` \| `hipercard` \| `other` |
| `last4_enc` | `bytea` NULL | 🔒 |
| `holder_name_enc` | `bytea` NULL | 🔒 |
| `credit_limit_cents` | `bigint` NULL | |
| `closing_day` | `smallint` | 1–31, dia de fechamento |
| `due_day` | `smallint` | 1–31, dia de vencimento |
| `is_archived` | `boolean` | |

> **Nunca** armazenamos PAN completo, CVV ou validade. Só os 4 últimos dígitos — e ainda
> assim cifrados, porque `last4 + nome do titular` é dado pessoal sob a LGPD.

#### `card_statements` (faturas)

| coluna | tipo | notas |
|---|---|---|
| `id` | `uuid` PK | |
| `household_id`, `credit_card_id` | `uuid` FK | |
| `reference_month` | `date` | sempre dia 1 — a competência da fatura |
| `closing_date` / `due_date` | `date` | |
| `total_amount_cents` | `bigint` | soma das transações da fatura |
| `paid_amount_cents` | `bigint` | |
| `status` | `enum` | `open` \| `closed` \| `paid` \| `overdue` |
| UNIQUE | `(credit_card_id, reference_month)` | |

Uma compra parcelada gera **N transações**, uma por fatura, com
`installment_number` / `installment_total` e o mesmo `installment_group_id`. Isso faz a
projeção de gastos futuros ser uma simples query por data, sem lógica especial.

---

### 2.3 Categorias e transações

#### `categories`
Árvore de dois níveis (grupo → subcategoria). O catálogo padrão
(`system-categories.ts`) é **copiado** para cada household novo — não existem linhas
globais compartilhadas.

| coluna | tipo | notas |
|---|---|---|
| `id` | `uuid` PK | |
| `household_id` | `uuid` FK **NOT NULL** | categoria sempre pertence a um household |
| `parent_id` | `uuid` FK NULL → categories | auto-relacionamento |
| `name` | `text` | |
| `slug` | `text` | `alimentacao.delivery` — chave estável usada pelo prompt de IA |
| `kind` | `enum` | `expense` \| `income` \| `transfer` \| `investment` |
| `color` / `icon` | `text` | |
| `is_system` | `boolean` | veio do catálogo padrão: pode ser renomeada, não pode ser apagada |
| UNIQUE | `(household_id, slug)` | |

`transfer` existe para que mover dinheiro entre contas próprias **não** conte como
despesa nem receita nos gráficos — erro clássico de app financeiro.

#### `merchants`
Estabelecimento normalizado, extraído da descrição. É o que dá memória ao sistema:
depois que "PAG*PADARIABELA" vira Alimentação uma vez, toda ocorrência futura acerta sem IA.

| coluna | tipo | notas |
|---|---|---|
| `id` | `uuid` PK | |
| `household_id` | `uuid` FK | |
| `normalized_name` | `text` | uppercase, sem prefixos de adquirente, sem dígitos de NSU |
| `display_name` | `text` | "Padaria Bela" |
| `default_category_id` | `uuid` FK NULL | |
| `seen_count` | `int` | usado no passo [2] do pipeline |
| UNIQUE | `(household_id, normalized_name)` | |

#### `transactions` — tabela central

| coluna | tipo | notas |
|---|---|---|
| `id` | `uuid` PK | |
| `household_id` | `uuid` FK | **sempre presente** |
| `account_id` | `uuid` FK NULL | exclusivo com `credit_card_id` (CHECK) |
| `credit_card_id` | `uuid` FK NULL | |
| `card_statement_id` | `uuid` FK NULL | fatura à qual pertence |
| `category_id` | `uuid` FK NULL | `NULL` = ainda não categorizada |
| `merchant_id` | `uuid` FK NULL | |
| `import_batch_id` | `uuid` FK NULL | `NULL` = lançamento manual |
| `posted_at` | `date` | data contábil (`DTPOSTED` do OFX) |
| `competence_date` | `date` | data de competência — para cartão, a da fatura |
| `amount_cents` | `bigint` | **negativo = saída, positivo = entrada** |
| `currency` | `char(3)` | |
| `description` | `text` | descrição original, como veio do banco |
| `normalized_description` | `text` | maiúsculas, sem acento/ruído — base do merchant e das regras |
| `notes` | `text` NULL | anotação do usuário |
| `type` | `enum` | `expense` \| `income` \| `transfer` \| `refund` |
| `status` | `enum` | `pending` \| `posted` \| `reconciled` |
| `fitid` | `text` NULL | id único do banco (OFX). Chave forte de dedupe |
| `dedupe_hash` | `text` | `sha256(conta ‖ data ‖ valor ‖ descrição normalizada)` — fallback para CSV sem FITID |
| `category_source` | `enum` NULL | `rule` \| `history` \| `ai` \| `user` |
| `category_confidence` | `numeric(3,2)` NULL | 0.00–1.00 |
| `needs_review` | `boolean` | `true` quando confiança < 0.7 |
| `sharing` | `enum` | `shared` (do casal) \| `personal` (só de quem pagou) |
| `paid_by_user_id` | `uuid` FK NULL | quem efetivamente pagou |
| `installment_number` / `installment_total` | `smallint` NULL | 3/12 |
| `installment_group_id` | `uuid` NULL | amarra as parcelas da mesma compra |
| `goal_id` | `uuid` FK NULL | transação que é aporte em uma meta |
| `created_at` / `updated_at` | `timestamptz` | |

Restrições e índices:

```sql
CHECK (num_nonnulls(account_id, credit_card_id) = 1)   -- ou conta, ou cartão
UNIQUE (account_id, fitid) WHERE fitid IS NOT NULL      -- dedupe forte
UNIQUE (household_id, dedupe_hash)                      -- dedupe fallback
INDEX  (household_id, posted_at DESC)                   -- extrato e dashboard
INDEX  (household_id, category_id, posted_at)           -- despesa por categoria
INDEX  (household_id, needs_review) WHERE needs_review  -- fila de revisão
INDEX  GIN (to_tsvector('portuguese', description))     -- busca textual
```

#### `transaction_splits`
Rateio de uma despesa compartilhada. Ausência de linhas = 100% de quem pagou.
A soma dos splits precisa bater com o valor da transação (validado no service).

| coluna | tipo |
|---|---|
| `transaction_id` `uuid` FK, `user_id` `uuid` FK, `amount_cents` `bigint`, PK `(transaction_id, user_id)` |

#### `categorization_rules`
Regras determinísticas — criadas pelo usuário ou aprendidas quando ele corrige a IA.

| coluna | tipo | notas |
|---|---|---|
| `id` `uuid` PK, `household_id` `uuid` FK | | |
| `match_type` | `enum` | `contains` \| `starts_with` \| `equals` \| `regex` |
| `pattern` | `text` | comparado contra `normalized_description` |
| `category_id` | `uuid` FK | |
| `priority` | `int` | menor = avaliada primeiro |
| `auto_created` | `boolean` | `true` = nasceu de uma correção do usuário |
| `hit_count` | `int` | telemetria: regras nunca usadas viram sugestão de limpeza |

---

### 2.4 Metas e projetos do casal

#### `goals`

| coluna | tipo | notas |
|---|---|---|
| `id` | `uuid` PK | |
| `household_id` | `uuid` FK | |
| `name` | `text` | "Casamento", "Entrada do apê" |
| `description` | `text` NULL | |
| `kind` | `enum` | `wedding` \| `property` \| `travel` \| `emergency_fund` \| `vehicle` \| `education` \| `other` |
| `target_amount_cents` | `bigint` | |
| `initial_amount_cents` | `bigint` | valor que já existia quando a meta foi criada |
| `target_date` | `date` NULL | |
| `linked_account_id` | `uuid` FK NULL | conta/investimento que lastreia a meta |
| `monthly_target_cents` | `bigint` NULL | aporte planejado; se `NULL`, é calculado |
| `priority` | `smallint` | ordenação quando o dinheiro não cobre tudo |
| `status` | `enum` | `active` \| `paused` \| `achieved` \| `cancelled` |
| `color` / `icon` | `text` | |
| `created_by_user_id` | `uuid` FK | |

O acumulado **não** é coluna: é `initial_amount_cents + SUM(goal_contributions.amount_cents)`.
Saldo derivado de coluna denormalizada é a origem número um de divergência em app financeiro.
Se virar gargalo, cache em materialized view — nunca em `UPDATE` disparado por trigger.

#### `goal_contributions`

| coluna | tipo | notas |
|---|---|---|
| `id` `uuid` PK, `goal_id` `uuid` FK, `household_id` `uuid` FK | | |
| `user_id` | `uuid` FK | **quem aportou** — é isso que permite "Ana: 60% · Bruno: 40%" |
| `amount_cents` | `bigint` | negativo = resgate |
| `contributed_at` | `date` | |
| `transaction_id` | `uuid` FK NULL | quando o aporte veio de uma transação real importada |
| `note` | `text` NULL | |

---

### 2.5 Importação e IA

#### `import_batches`

| coluna | tipo | notas |
|---|---|---|
| `id` `uuid` PK, `household_id` `uuid` FK, `created_by_user_id` `uuid` FK | | |
| `account_id` / `credit_card_id` | `uuid` FK NULL | destino |
| `filename` | `text` | |
| `file_hash` | `text` | sha256. UNIQUE `(household_id, file_hash)` → reimportar é no-op |
| `format` | `enum` | `ofx` \| `csv` \| `manual` |
| `status` | `enum` | `processing` \| `completed` \| `failed` \| `partial` |
| `total_rows` / `imported_count` / `duplicate_count` / `error_count` | `int` | |
| `statement_start` / `statement_end` | `date` NULL | período coberto |
| `error_log` | `jsonb` NULL | linhas rejeitadas, com motivo |

#### `ai_insights`

| coluna | tipo | notas |
|---|---|---|
| `id` `uuid` PK, `household_id` `uuid` FK | | |
| `reference_month` | `date` | dia 1 do mês analisado |
| `payload` | `jsonb` | saída estruturada do LLM (resumo, alertas, dicas, impacto nas metas) |
| `model` / `input_tokens` / `output_tokens` | | custo e auditabilidade |
| `generated_at` | `timestamptz` | |
| UNIQUE | `(household_id, reference_month)` | regenerar faz upsert |

#### `audit_logs`
Trilha de auditoria para ações sensíveis (login, convite, exportação, exclusão).

| coluna | tipo |
|---|---|
| `id`, `household_id` NULL, `user_id` NULL, `action`, `entity`, `entity_id`, `metadata jsonb`, `ip`, `user_agent`, `created_at` |

---

## 3. Isolamento por household (RLS)

Filtrar por `household_id` no código é a primeira linha de defesa; RLS é a rede de segurança
para o dia em que alguém esquecer um `where`.

```sql
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transactions
  USING (household_id = current_setting('app.current_household', true)::uuid);
```

A API abre cada request em transação e executa
`SET LOCAL app.current_household = $1` com o household já autorizado pelo JWT.
`SET LOCAL` garante que o valor morre no fim da transação — essencial com pool de conexões.

---

## 4. Decisões que valem defender em revisão

1. **`bigint` em centavos, não `numeric`, no código da aplicação.** `NUMERIC(14,2)` no banco
   para relatórios SQL; a API trafega inteiro. Elimina qualquer chance de `0.1 + 0.2` chegar
   perto de um saldo.
2. **`households` como raiz, não `users`.** Modelar "casal" como um campo `partner_id` em
   `users` quebra no primeiro divórcio, no segundo casamento e no caso do trio de amigos que
   divide apartamento. Household é um agregado; a relação é `N:N` com papel.
3. **Conta conjunta = `owner_user_id NULL`**, não uma tabela `joint_accounts`. Uma coluna
   nullable expressa a mesma coisa e evita `UNION` em toda consulta de extrato.
4. **`transactions.category_id` pode ser `NULL`; `categories.household_id` não.**
   Transação recém-importada existe antes de ser classificada — forçar categoria na
   inserção obrigaria a inventar "Outros", que suja todo relatório. Já a categoria
   sempre tem dono: um catálogo global com override por household exigiria lógica de
   merge e sombreamento em toda leitura, e `household_id` nulo quebraria tanto a
   unicidade de slug (no Postgres, `NULL` é distinto de `NULL`) quanto a policy de RLS.
   O custo aceito é que adicionar categoria ao catálogo depois exige uma migração que a
   propague — trabalho explícito, e não surpresa.
5. **Parcelamento como N linhas, não como coluna de "parcelas restantes".** A projeção dos
   próximos 12 meses vira `WHERE competence_date BETWEEN …`, sem código de expansão.
6. **Dedupe em duas camadas.** `FITID` é confiável quando existe, mas CSV de fatura raramente
   tem. O hash de fallback cobre o resto e ainda deixa passar o caso legítimo de dois cafés
   idênticos no mesmo dia — porque nesse caso o usuário tem o botão "importar mesmo assim".
