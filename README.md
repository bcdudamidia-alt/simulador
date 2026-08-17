# Pareo

Controle financeiro pessoal e de casal: multi-contas, cartões, importação de
extratos OFX/CSV, categorização por IA e metas compartilhadas de longo prazo.

> **Estado:** fundação do MVP. Arquitetura, modelo de dados, backend de
> importação/categorização/metas/dashboard e o dashboard em React estão
> escritos. O que ainda falta está listado em [Próximos passos](#próximos-passos)
> e em [`docs/SECURITY.md §10`](docs/SECURITY.md).

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

O frontend roda sem o backend: sem sessão, o dashboard entra em **modo
demonstração** com dados fictícios rotulados como tal.

### Testes

```bash
npm test --workspace @pareo/api
```

33 testes cobrindo o parser de OFX (SGML e XML), normalização de descrição,
parsing de valor em pt-BR/en e deduplicação.

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

**Frontend** (`apps/web`)

- Dashboard: saldo consolidado, KPIs com comparativo, fluxo de caixa (6 meses),
  despesas por categoria, contas e cartões, metas, últimos lançamentos, análise
  de IA
- Tema claro/escuro/sistema, sem flash na primeira pintura
- Paleta de gráficos validada para daltonismo (ΔE por par adjacente)

---

## Próximos passos

Em ordem de valor:

1. **Telas restantes** — login, importação (drag & drop), extrato com filtros,
   CRUD de contas/cartões/metas. O backend já serve todas.
2. **Fila (BullMQ)** para importação e IA — hoje é síncrono; acima de ~500
   transações por arquivo o request fica longo demais.
3. **MFA (TOTP)** — a coluna já existe no schema.
4. **Exportação e exclusão de conta** — requisitos de LGPD ainda pendentes.
5. **Open Finance (Pluggy/Belvo)** — substitui o upload manual; o modelo de
   dados já comporta (`institution_code`, `balance_synced_at`).
6. **App mobile (Expo)** — reaproveita `lib/api.ts` e os tipos.

---

## Convenções que não são negociáveis

1. **Dinheiro é `bigint` em centavos.** Nunca `float`, nunca `number` decimal.
   A conversão para reais acontece só na formatação.
2. **Despesa é negativa, receita é positiva.** Sempre.
3. **Toda query de domínio filtra por `householdId`.** Sem exceção.
4. **`$queryRawUnsafe` não entra no projeto.**
5. **Controller não conhece Prisma; service não conhece Express.**
