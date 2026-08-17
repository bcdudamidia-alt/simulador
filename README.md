# Pareo

Controle financeiro pessoal e de casal: multi-contas, cartões, importação de
extratos OFX/CSV, categorização por IA e metas compartilhadas de longo prazo.

> **Estado:** MVP navegável. As seis telas funcionam ponta a ponta contra a API
> real — login, painel, lançamentos, importação, contas/cartões e metas. O que
> ainda falta está em [Próximos passos](#próximos-passos) e em
> [`docs/SECURITY.md §10`](docs/SECURITY.md).

---

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Visão geral, stack e o porquê de cada escolha, estrutura de pastas, fluxos |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Modelo relacional tabela a tabela + decisões defensáveis |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Modelo de ameaças, controles e pendências |
| [`docs/prompts/categorizacao.md`](docs/prompts/categorizacao.md) | Prompt de classificação de transações |
| [`docs/prompts/insights-mensais.md`](docs/prompts/insights-mensais.md) | Prompt do consultor financeiro do casal |

---

## Rodando localmente

Requisitos: Node 22+, Docker (para o Postgres).

```bash
# 1. dependências
npm install

# 2. banco
npm run db:up                              # sobe o Postgres em :5432

# 3. configuração da API
cp apps/api/.env.example apps/api/.env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # 3×:
#   JWT_SECRET, ENCRYPTION_KEY, BLIND_INDEX_KEY

# 4. schema + dados de exemplo
npm run db:migrate                         # cria as tabelas
psql "$DATABASE_URL" -f apps/api/sql/002_rls.sql   # RLS (opcional no dev)
npm run db:seed                            # casal demo com 3 meses de histórico

# 5. subir
npm run dev:api                            # http://localhost:3333/api/v1
npm run dev:web                            # http://localhost:3000
```

Login do seed: `ana@exemplo.com` / `bruno@exemplo.com`, senha `pareo-dev-123456`.

Sem backend no ar, a tela de login oferece **"ver uma demonstração"**: o painel
e as metas usam dados fictícios, rotulados como tais em uma faixa fixa no topo, e
as ações de escrita ficam desabilitadas em vez de fingir que salvaram.

### Testes

```bash
npm test --workspace @pareo/api
```

33 testes cobrindo o parser de OFX (SGML e XML), normalização de descrição,
parsing de valor em pt-BR/en e deduplicação.

```bash
npm run typecheck        # api + web
npm run build --workspace @pareo/web
```

O seed é **determinístico e idempotente**: rodar três vezes deixa as mesmas 48
transações. Isso é testável na mão e vale como garantia de que reimportar não
duplica.

---

## O que já está implementado

**Backend** (`apps/api`)

- Auth: bcrypt cost 12, JWT 15 min, refresh rotativo com detecção de reuso,
  rate limit por IP+e-mail, resposta em tempo constante contra enumeração
- Importação OFX 1.x (SGML) e 2.x (XML) + CSV com detecção de layout, encoding
  cp1252/UTF-8 e idempotência por hash de arquivo
- Deduplicação em duas camadas (FITID + hash de fallback)
- Categorização em três níveis: regra → histórico do estabelecimento → LLM
- Aprendizado por correção: corrigir uma vez cria a regra e reclassifica as irmãs
- Insights mensais com agregação em SQL e saída JSON validada
- Metas com simulação de aporte, projeção de término e divisão por membro
- Dashboard agregado em uma chamada
- Criptografia de campo AES-256-GCM + blind index para busca

**Frontend** (`apps/web`) — seis telas

| Rota | O que faz |
|---|---|
| `/login` | Entrar, criar conta, ou ver a demonstração com dados fictícios |
| `/` | Painel: saldo consolidado, KPIs com comparativo, fluxo de caixa (6 meses), despesas por categoria, contas/cartões, metas e análise de IA |
| `/transacoes` | Extrato consolidado com filtros, busca com debounce, paginação por cursor e **correção de categoria em linha** (que vira regra e reclassifica as irmãs) |
| `/importar` | Drag & drop de OFX/CSV, resultado detalhado (importadas · duplicadas · a revisar · ignoradas) e histórico |
| `/contas` | CRUD de contas e cartões. Número da conta cifrado; a tela só vê os 4 últimos dígitos |
| `/metas` | CRUD de metas, registro de aporte por membro e simulador de quanto guardar por mês |

- Sessão com refresh silencioso: F5 não desloga, e o access token nunca sai da memória
- Tema claro/escuro/sistema, sem flash na primeira pintura
- Paleta de gráficos validada para daltonismo (ΔE por par adjacente)

---

## Próximos passos

Em ordem de valor:

1. **Fila (BullMQ)** para importação e IA — hoje é síncrono; acima de ~500
   transações por arquivo o request fica longo demais e um timeout de proxy pode
   cortá-lo no meio da categorização.
2. **Convite do parceiro(a)** — a tabela `household_invites` e o modelo de
   papéis existem; falta o envio de e-mail e a tela de aceite.
3. **MFA (TOTP)** — a coluna `mfa_secret_enc` já existe no schema.
4. **Exportação e exclusão de conta** — requisitos de LGPD ainda pendentes.
5. **Rateio de despesa na interface** — `transaction_splits` existe no banco e
   é validado no service; falta a UI de "dividir esta conta".
6. **Testes de integração da API** — hoje os 33 testes cobrem os parsers (a
   parte pura). Os fluxos HTTP foram verificados manualmente, não em CI.
7. **Open Finance (Pluggy/Belvo)** — substitui o upload manual; o modelo já
   comporta (`institution_code`, `number_bidx`, `balance_synced_at`).
8. **App mobile (Expo)** — reaproveita `lib/api.ts` e os tipos.

---

## Convenções que não são negociáveis

1. **Dinheiro é `bigint` em centavos.** Nunca `float`, nunca `number` decimal.
   A conversão para reais acontece só na formatação.
2. **Despesa é negativa, receita é positiva.** Sempre.
3. **Toda query de domínio filtra por `householdId`.** Sem exceção.
4. **`$queryRawUnsafe` não entra no projeto.**
5. **Controller não conhece Prisma; service não conhece Express.**
