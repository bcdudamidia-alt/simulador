# Pareo — Segurança

Modelo de ameaças e controles. Cada linha aponta para onde o controle vive no
código, porque documento de segurança que não referencia implementação envelhece
em uma sprint.

---

## 1. O que estamos protegendo

| Ativo | Por que importa |
|---|---|
| Extrato consolidado do casal | Reconstrói rotina, endereço, saúde, relacionamentos. É o ativo mais sensível do produto — mais do que a senha. |
| Credenciais | Reuso de senha dá acesso a e-mail e banco da vítima. |
| Número de conta e dados do cartão | Dado pessoal sob a LGPD; habilita fraude. |
| Metas e projetos | Revela patrimônio e planos (casamento, mudança, separação). |

**Cenário que orienta o desenho:** um relacionamento que termina mal. O
ex-parceiro conhece a senha antiga, o dispositivo e a rotina. É por isso que
remoção do household tem efeito **imediato** (`withHousehold` reconfirma a
associação a cada request, e não a cada 15 min) e que a revogação de refresh
derruba a família inteira de tokens.

---

## 2. Autenticação e sessão

| Controle | Implementação |
|---|---|
| bcrypt cost 12 | `lib/password.ts` |
| Tempo constante no login (contra enumeração) | `fakeVerify()` — hash descartável quando o e-mail não existe |
| Senha: mínimo 12 caracteres, sem regra de composição | `auth.routes.ts`. Exigir símbolo produz `Senha@123`; comprimento livre dá mais entropia real (NIST SP 800-63B) |
| Access token 15 min, HS256, **em memória** no cliente | `lib/jwt.ts` + `web/src/lib/api.ts` |
| Refresh 30 dias, opaco, cookie `httpOnly` + `Secure` + `SameSite=Strict` | `auth.routes.ts` |
| Refresh **rotativo com detecção de reuso** | `auth.service.ts` — token revogado que reaparece revoga a família inteira |
| Hash do refresh no banco | O token em claro só existe no cookie |
| Rate limit 5 tentativas / 15 min por **IP + e-mail** | `middlewares/rate-limit.ts` |
| Papel `viewer` somente leitura | `requireWriteAccess` |

**Por que access token em memória e não em `localStorage`:** um XSS em
`localStorage` rouba uma sessão que sobrevive ao fechamento da aba. Em memória,
o reload já a perde — e o refresh, sendo `httpOnly`, é invisível para
JavaScript, inclusive o nosso.

**Por que rotação com detecção de reuso:** um refresh usado duas vezes só tem
duas explicações — cópia roubada ou race de rede. Como não dá para distinguir,
tratamos como roubo: o legítimo faz login de novo, o atacante fica sem nada.

---

## 3. Isolamento entre casais

Três camadas, porque a primeira falha um dia:

1. **Middleware** — `withHousehold` confirma no banco que o usuário ainda é
   membro. O papel do banco vence o do token.
2. **Query** — todo `where` de domínio carrega `householdId`. Nenhum service
   recebe id de recurso sem também filtrar pelo household.
3. **RLS** — `sql/002_rls.sql`. `SET LOCAL app.current_household` por transação
   (`db/prisma.ts → withHouseholdScope`). `LOCAL` é obrigatório: com pool de
   conexões, um `SET` normal vazaria o household de um casal para a request de
   outro.

**IDOR** é fechado por construção: `resolveOrigin()` na importação, a checagem
de categoria no `PATCH /transactions/:id/category` e o `findFirst({ id, householdId })`
em cada service impedem que um id de outro household seja aceito só porque
existe.

---

## 4. Dados em repouso

| Campo | Tratamento |
|---|---|
| `accounts.number_enc` | AES-256-GCM (`lib/crypto.ts`) |
| `accounts.number_bidx` | Blind index HMAC-SHA256 — busca por igualdade sem decifrar |
| `credit_cards.last4_enc`, `holder_name_enc` | AES-256-GCM |
| `users.mfa_secret_enc` | AES-256-GCM |
| PAN completo, CVV, validade | **Nunca armazenados**, em nenhuma forma |

O blob cifrado é `versão(1B) ‖ IV(12B) ‖ tag(16B) ‖ ciphertext`. O byte de versão
permite rotação de chave sem migração big-bang. GCM é autenticado: adulterar a
linha no banco faz o decrypt lançar, em vez de devolver lixo silenciosamente.

Chaves separadas para cifra e para blind index — vazar o índice não deve ajudar
a decifrar.

**Em produção:** `ENCRYPTION_KEY` vem de KMS/Secret Manager, nunca de arquivo no
servidor. O caminho de evolução é envelope encryption (DEK por household cifrada
por uma KEK do KMS); `KEY_VERSION` já está no formato para isso.

---

## 5. Injeção

| Vetor | Controle |
|---|---|
| SQL Injection | Prisma parametriza 100% das queries. `$queryRaw` só com template tag — as interpolações viram `$1`. **`$queryRawUnsafe` não é usado em lugar nenhum**, e não deve passar em code review. |
| XSS | React escapa por padrão. `dangerouslySetInnerHTML` aparece **uma vez** no projeto: o script anti-flash de tema em `layout.tsx`, com string literal constante — a CSP de produção deve liberá-lo por **hash**, nunca com `unsafe-inline`. |
| XXE (via OFX 2.x) | O parser é próprio e não resolve entidade nenhuma; `<!DOCTYPE` / `<!ENTITY` fazem o arquivo ser rejeitado (`ofx-parser.ts`, teste correspondente em `ofx-parser.test.ts`). |
| Mass assignment | `validate()` **substitui** `req.body` pelo objeto validado — campo extra não chega ao service. |
| ReDoS | Regra de categorização com `match_type: regex` é limitada a 200 caracteres; padrão inválido é ignorado. |
| Prototype pollution | Sem `Object.assign` em objeto vindo do cliente; zod produz objeto novo. |

---

## 6. Upload de arquivo

| Controle | Valor |
|---|---|
| Armazenamento | **Memória**, nunca disco. Extrato em `/tmp` é uma cópia em claro que sobrevive ao request. |
| Tamanho | 10 MB (um OFX de um ano tem ~2 MB) |
| Arquivos por request | 1 |
| Extensão | allowlist: `.ofx` `.qfx` `.csv` `.txt` |
| MIME | allowlist |
| Magic bytes | Verificados — **vencem a extensão**, que é escolhida por quem faz upload |
| Rate limit | 30 importações/hora por household |
| Parse | Sem `eval`, sem `Function`, sem resolução de entidade |

---

## 7. Cabeçalhos e transporte

`helmet` em `app.ts`: CSP `default-src 'none'` (a API só serve JSON),
`frame-ancestors 'none'`, HSTS 1 ano com `includeSubDomains` e `preload` em
produção, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`.

CORS com origem em **allowlist explícita** e `credentials: true`. O par
(`credentials` + origem curinga) é proibido pelo navegador exatamente por isso —
nunca troque por `origin: true`.

`trust proxy: 1`: sem isso, atrás de load balancer `req.ip` seria sempre o IP do
proxy e o rate limit por IP viraria um limite global compartilhado.

---

## 8. Vazamento por log e por erro

- **Redaction no logger** (`lib/logger.ts`): `authorization`, `cookie`,
  `set-cookie`, `password`, `token`, `numberEnc`, `last4Enc`. É configuração do
  logger, não disciplina de quem escreve a linha de log.
- **Erro genérico**: só `HttpError` tem mensagem exibível. Qualquer outro erro
  vira 500 com um `errorId` para correlação; stack, SQL e nome de coluna ficam
  no log. Em produção, `debug` não é enviado.
- **Login não distingue** e-mail inexistente de senha errada, nem no texto nem
  no tempo de resposta.

---

## 9. LGPD

| Requisito | Situação |
|---|---|
| Minimização | Não coletamos CPF, endereço nem PAN. Só o necessário para conciliar extrato. |
| Finalidade | Dado financeiro serve apenas ao produto. **Extrato não é usado para treinar modelo.** |
| Titularidade | O dado é do household; sair dele não apaga o histórico do casal (é dado compartilhado), mas o ex-membro perde o acesso imediatamente. |
| Portabilidade | Exportação CSV/OFX — **pendente**, v1.1 |
| Eliminação | Exclusão de conta com purga em 30 dias — **pendente**, v1.1 |
| Trilha de auditoria | `audit_logs` para login, convite, exportação e exclusão |
| Sub-processador | A chamada de IA envia descrição, valor e categoria — **nunca** número de conta, nome do titular ou identificador de cartão. Documentar na política de privacidade. |

---

## 10. Pendências conhecidas antes de produção

Nenhuma delas está escondida — todas são trabalho consciente para depois do MVP:

1. **MFA (TOTP)** — a coluna `mfa_secret_enc` já existe; o fluxo, não.
2. **Rate limit distribuído** — o store em memória só serve para instância
   única. Com N réplicas, o limite efetivo vira N × o configurado. Trocar por
   `rate-limit-redis`.
3. **CSP do frontend** — hoje só os cabeçalhos básicos em `next.config.mjs`.
   Precisa do hash do script de tema e das origens reais; subir em
   `report-only` antes de `enforce`.
4. **Verificação de e-mail** — a coluna existe, o envio não.
5. **Rotação de chave de criptografia** — o formato suporta; o job de re-cifra
   não existe.
6. **Fila para importação e IA** — hoje síncrono. Acima de ~500 transações por
   arquivo, o request fica longo demais e um timeout de proxy pode cortá-lo no
   meio da categorização.
7. **Pentest e revisão externa** antes de tocar em dado real de usuário.
