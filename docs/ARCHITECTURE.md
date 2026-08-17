# Pareo — Arquitetura

> Controle financeiro pessoal e de casal: multi-contas, cartões, importação OFX/CSV,
> categorização por IA e metas compartilhadas.

---

## 1. Visão geral

```
┌────────────────────────────────────────────────────────────────────────┐
│                              NAVEGADOR                                 │
│  Next.js 15 (App Router) · React 19 · Tailwind 4 · Recharts            │
│  Server Components para leitura · Client Components para interação     │
└───────────────────────────────┬────────────────────────────────────────┘
                                │ HTTPS · JWT (access em memória)
                                │        refresh em cookie httpOnly
┌───────────────────────────────▼────────────────────────────────────────┐
│                      API — Node 22 · Express · TypeScript              │
│                                                                        │
│  ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌─────────┐ ┌─────────────┐ │
│  │   auth   │ │ accounts │ │ imports    │ │  goals  │ │  dashboard  │ │
│  │  JWT +   │ │  cards   │ │ OFX/CSV    │ │ aportes │ │  agregações │ │
│  │  bcrypt  │ │          │ │ parser     │ │         │ │             │ │
│  └──────────┘ └──────────┘ └─────┬──────┘ └─────────┘ └─────────────┘ │
│                                  │                                     │
│                     ┌────────────▼─────────────┐                       │
│                     │  pipeline de categorização│                      │
│                     │  1. regras do household   │                      │
│                     │  2. histórico do merchant │                      │
│                     │  3. LLM (batch, cacheado) │                      │
│                     └────────────┬─────────────┘                       │
└──────────────────────────────────┼─────────────────────────────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
┌───────▼────────┐      ┌──────────▼─────────┐     ┌──────────▼─────────┐
│  PostgreSQL 16 │      │  Claude API        │     │  Object storage    │
│  Prisma        │      │  categorização +   │     │  arquivos OFX/CSV  │
│  RLS por       │      │  insights mensais  │     │  originais (opc.)  │
│  household     │      │                    │     │                    │
└────────────────┘      └────────────────────┘     └────────────────────┘
```

### Por que essa stack

| Decisão | Motivo |
|---|---|
| **Monorepo (npm workspaces)** | Tipos compartilhados entre API e web sem publicar pacote. Um `npm install`, um deploy pipeline. |
| **API separada do Next.js** (em vez de Route Handlers) | O parser de OFX, o pipeline de IA e os jobs de reprocessamento são CPU/IO-bound e precisam escalar independentemente do SSR. Também permite trocar o frontend (app mobile) sem reescrever regra de negócio. |
| **Express + TypeScript** | Ecossistema maduro de middlewares de segurança (helmet, rate-limit). Time-to-market alto para MVP. |
| **Prisma** | Migrations versionadas, queries parametrizadas por padrão (defesa contra SQL Injection sem esforço) e tipos gerados que chegam ao frontend. |
| **PostgreSQL** | Transações ACID (imprescindível para dinheiro), `numeric` exato, `tsvector` para busca em descrições, RLS para isolamento por household. |
| **Claude API** | Categorização em lote com saída estruturada (JSON schema) e geração dos insights mensais. |

### Regras de ouro do domínio

1. **Dinheiro nunca é `float`.** No banco: `NUMERIC(14,2)`. Na API: inteiro em centavos (`bigint`/`number`) ou `Decimal` do Prisma. No frontend: formatação só na borda de renderização.
2. **Sinal do valor:** despesa é negativa, receita é positiva. Sempre. Faturas de cartão importadas vêm com sinal invertido em muitos bancos — o parser normaliza.
3. **Idempotência de importação:** o mesmo arquivo importado duas vezes não duplica transação (hash do arquivo + `FITID` por conta + hash de fallback).
4. **Todo dado é escopado por `household_id`.** Nenhuma query de domínio roda sem esse filtro — garantido por middleware, repositório e (em produção) Row Level Security.

---

## 2. Estrutura de pastas

```
simulador/
├── package.json                    # workspaces: apps/*
├── docker-compose.yml              # postgres 16 local
├── docs/
│   ├── ARCHITECTURE.md             # este arquivo
│   ├── DATA_MODEL.md               # modelo relacional detalhado
│   ├── SECURITY.md                 # ameaças e controles
│   └── prompts/
│       ├── categorizacao.md        # prompt de classificação de transações
│       └── insights-mensais.md     # prompt do consultor financeiro do casal
│
├── apps/api/                       # ───────── BACKEND ─────────
│   ├── prisma/
│   │   ├── schema.prisma           # fonte da verdade do schema
│   │   └── seed.ts                 # casal demo com 3 meses de histórico
│   ├── sql/
│   │   ├── 001_init.sql            # DDL equivalente (referência / DBA)
│   │   └── 002_rls.sql             # Row Level Security
│   └── src/
│       ├── server.ts               # bootstrap HTTP + graceful shutdown
│       ├── app.ts                  # montagem do Express (helmet, cors, rotas)
│       ├── config/env.ts           # validação de env com zod (falha rápido)
│       ├── db/prisma.ts            # singleton do client
│       ├── lib/
│       │   ├── crypto.ts           # AES-256-GCM + blind index (HMAC)
│       │   ├── password.ts         # bcrypt cost 12
│       │   ├── jwt.ts              # access 15min / refresh 30d rotativo
│       │   ├── money.ts            # centavos ↔ decimal, sem float
│       │   ├── http-error.ts       # erros tipados
│       │   └── logger.ts           # pino com redaction de campos sensíveis
│       ├── routes.ts               # composição do router + rotas simples
│       ├── middlewares/
│       │   ├── authenticate.ts     # valida JWT · withHousehold · requireWriteAccess
│       │   ├── validate.ts         # valida body/query/params com zod
│       │   ├── rate-limit.ts       # limites por rota (login mais estrito)
│       │   └── error-handler.ts    # tradutor de erro → resposta JSON
│       └── modules/
│           ├── auth/               # auth.service.ts · auth.routes.ts
│           ├── categories/         # system-categories.ts (catálogo padrão)
│           ├── imports/            # import.service · ofx-parser · csv-parser
│           │                       # normalize · imports.routes · testes
│           ├── goals/              # goals.service.ts (progresso + simulação)
│           ├── dashboard/          # dashboard.service.ts (agregações)
│           └── ai/                 # categorizer · insights · prompts
│
└── apps/web/                       # ───────── FRONTEND ─────────
    └── src/
        ├── app/
        │   ├── layout.tsx          # tema claro/escuro, script anti-flash
        │   ├── globals.css         # tokens de cor e paleta de gráficos
        │   ├── page.tsx            # DASHBOARD
        │   ├── login/              # ← a fazer
        │   ├── transacoes/         # ← a fazer
        │   ├── contas/             # ← a fazer
        │   ├── metas/              # ← a fazer
        │   └── importar/           # ← a fazer
        ├── components/
        │   ├── dashboard/          # kpi-row · cash-flow-chart
        │   │                       # category-breakdown · goals-panel
        │   │                       # accounts-panel · recent-transactions
        │   │                       # insights-panel
        │   ├── ui/card.tsx         # Card · CardHeader · Legend · Badge
        │   └── theme-toggle.tsx
        └── lib/
            ├── api.ts              # fetch tipado com refresh automático
            ├── demo-data.ts        # fixture do modo demonstração
            ├── format.ts           # BRL, datas, percentuais (pt-BR)
            └── types.ts            # DTOs compartilhados com a API
```

**Convenção de módulo no backend** — cada pasta em `modules/` tem no máximo 4 arquivos:

```
modules/goals/
├── goals.routes.ts      # define rotas + middlewares + schema zod
├── goals.controller.ts  # HTTP in → HTTP out. Zero regra de negócio.
├── goals.service.ts     # regra de negócio. Não conhece Express.
└── goals.schema.ts      # zod: validação de entrada e tipos derivados
```

O controller nunca importa Prisma; o service nunca importa `Request`/`Response`. Isso mantém
a regra de negócio testável sem HTTP e permite expor a mesma lógica via job/CLI depois.

---

## 3. Fluxos principais

### 3.1 Importação de extrato (OFX/CSV)

```
POST /api/v1/imports  (multipart: file, accountId | creditCardId)
   │
   ├─ 1. Valida: extensão, MIME, tamanho ≤ 10 MB, magic bytes
   ├─ 2. sha256(arquivo) → já existe import com esse hash neste household?
   │        sim → 200 { status: "duplicate", importBatchId }  (idempotente)
   ├─ 3. Detecta formato (OFX SGML, OFX XML, CSV) e encoding (cp1252 vs utf-8)
   ├─ 4. Parse → Transaction[] normalizadas (data, valor em centavos, fitid, memo)
   ├─ 5. Dedupe em 2 camadas:
   │        a) UNIQUE (account_id, fitid)              ← quando o banco manda FITID
   │        b) dedupe_hash = sha256(conta|data|valor|descrição normalizada)
   ├─ 6. INSERT em transação atômica, status = 'needs_review'
   ├─ 7. Enfileira categorização (síncrona no MVP, fila no v2)
   └─ 8. 201 { imported, duplicates, needsReview, importBatchId }
```

### 3.2 Pipeline de categorização (barato → caro)

```
transação sem categoria
   │
   ├─ [1] regra explícita do household?     ex.: "IFOOD*" → Alimentação/Delivery
   │        hit → categoria, confidence 1.00, source 'rule'          ← grátis
   │
   ├─ [2] merchant já visto neste household? (≥3 ocorrências, mesma categoria)
   │        hit → categoria, confidence 0.90, source 'history'       ← grátis
   │
   └─ [3] LLM em lote de até 40 transações, saída JSON validada por zod
            → categoria, confidence, source 'ai'                     ← pago
            confidence < 0.7  → marca needs_review (usuário confirma)
            usuário corrige   → cria/atualiza regra em [1]  (o sistema aprende)
```

Cada nível resolve a maioria dos casos do nível seguinte com o tempo: em regime, >90% das
transações recorrentes nunca chegam ao LLM.

### 3.3 Metas do casal

Uma meta pertence ao household e tem contribuições nomeadas por membro. A simulação
("quanto guardar por mês") é determinística no backend:

```
faltam        = alvo − acumulado
mesesRestantes= max(1, meses_entre(hoje, prazo))
aporteMensal  = faltam / mesesRestantes
noRitmo       = aporte_médio_últimos_3_meses ≥ aporteMensal
projeçãoTérmino = hoje + ceil(faltam / aporte_médio_últimos_3_meses) meses
```

---

## 4. Segurança (resumo — detalhes em `docs/SECURITY.md`)

| Ameaça | Controle |
|---|---|
| Vazamento de senha | bcrypt cost 12, senha nunca logada, `password_hash` fora de todo `select` padrão |
| Roubo de token | Access JWT 15 min em memória (nunca `localStorage`); refresh 30 dias em cookie `httpOnly`+`Secure`+`SameSite=Strict`, **rotativo com detecção de reuso** (reuso → revoga toda a família de tokens) |
| SQL Injection | Prisma parametriza 100% das queries; `$queryRaw` só com template tag (nunca concatenação) |
| XSS | React escapa por padrão; proibido `dangerouslySetInnerHTML`; CSP restritiva via helmet; cookie de refresh é `httpOnly` (JS não lê) |
| CSRF | Refresh cookie `SameSite=Strict` + rota de refresh exige header `X-Requested-With` |
| Dados sensíveis em repouso | AES-256-GCM em nível de campo (número de conta, últimos dígitos e titular do cartão, credenciais de instituição). Chave em KMS/secret manager, nunca no repositório |
| Busca sobre campo cifrado | Blind index: `HMAC-SHA256(chave_index, valor_normalizado)` — permite igualdade sem decifrar |
| Vazamento entre casais | `household_id` obrigatório em toda query + Postgres RLS (`002_rls.sql`) como rede de segurança |
| Força bruta no login | Rate limit 5 tentativas / 15 min por IP+email, resposta genérica e tempo constante |
| Upload malicioso | Whitelist de extensão + MIME + magic bytes, limite de 10 MB, parser sem `eval`, XML com entidades externas desabilitadas (defesa contra XXE em OFX 2.x) |
| Enumeração de usuário | `/register` e `/login` respondem igual para email existente e inexistente |

---

## 5. Roadmap sugerido

| Fase | Entrega |
|---|---|
| **MVP (agora)** | Auth + household, contas/cartões manuais, import OFX/CSV, categorização IA, dashboard, metas |
| **v1.1** | Fila (BullMQ) para importação e IA · orçamento por categoria · recorrências detectadas |
| **v1.2** | Open Finance (Pluggy/Belvo) substituindo o upload manual · conciliação de fatura × pagamento |
| **v1.3** | App mobile (Expo, reaproveitando `lib/api.ts` e tipos) · notificações de vencimento |
| **v2** | Projeção de fluxo de caixa 12 meses · simulador de cenários ("e se financiarmos 80%?") |
