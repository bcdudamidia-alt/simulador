# Prompt — Categorização de transações

Implementado em
[`apps/api/src/modules/ai/prompts.ts`](../../apps/api/src/modules/ai/prompts.ts)
(`CATEGORIZATION_SYSTEM_PROMPT`). Este documento explica as decisões.

---

## O LLM é o último recurso, não o primeiro

```
transação sem categoria
   │
   ├─ [1] regra do household        →  grátis, determinística
   ├─ [2] histórico do merchant     →  grátis, aprende sozinho
   └─ [3] LLM em lote de 40         →  pago
```

O extrato de um casal é dominado por recorrência: aluguel, mercado, streaming,
posto, plano de saúde. Depois de um ou dois meses, [1] e [2] resolvem a maior
parte e o LLM passa a ver quase só transação nova de verdade.

E o ciclo se fecha: quando o usuário corrige um palpite,
`learnFromCorrection()` cria a regra e atualiza o merchant. Sem isso, o mesmo
estabelecimento voltaria ao modelo todo mês e o usuário corrigiria a mesma coisa
para sempre.

## O que o prompt precisa saber sobre extrato brasileiro

Sem contexto de domínio, o modelo trata `PAG*PADARIA BELA VISTA 08/12 SAO PAULO BR`
como texto genérico. O prompt lista explicitamente:

- **Prefixos de adquirente** sem valor semântico: `PAG*`, `MP*`, `MERCPAGO*`,
  `PICPAY*`, `CIELO*`, `REDE*`, `STONE*`, `GETNET*`, `SUMUP*`, `PP*`.
- **Marcas brasileiras**: iFood/Rappi, 99/Uber, Drogasil/Raia/Pacheco,
  Assaí/Atacadão/Carrefour, Enel/CPFL/Light/Cemig, Sabesp/Copasa, Vivo/Claro/TIM.
- **PIX**: a descrição costuma trazer nome de pessoa física. PIX para pessoa sem
  outro sinal é `transferencia.pix` — nunca uma categoria de consumo inventada.
- **Movimentação interna**: `APLICACAO`, `RESGATE`, `CDB`, `TESOURO`,
  `TRANSF ENTRE CONTAS`, `PAGAMENTO DE FATURA`.

## As três regras que evitam relatório errado

### Pagamento de fatura é transferência, não despesa

O erro mais caro do domínio. As compras da fatura **já** foram contabilizadas
uma a uma; classificar o pagamento como despesa conta o mesmo dinheiro duas
vezes e infla o mês inteiro. Por isso existe o `kind = 'transfer'` no modelo e
por isso o prompt trata essa regra como explícita.

### O sinal restringe a categoria

Valor positivo só aceita `income` / `transfer` / `investment`. Valor negativo só
aceita `expense` / `transfer` / `investment`. Isso elimina a classe de erro
"salário classificado como despesa" antes de ela existir.

### Confiança é honesta, e abaixo de 0,40 é `outros.nao-identificado`

| Faixa | Significado |
|---|---|
| 0,95–1,00 | marca inequívoca ("IFOOD", "UBER TRIP") |
| 0,75–0,94 | forte indício, uma leitura alternativa plausível |
| 0,40–0,74 | palpite fundamentado |
| < 0,40 | não classifica — vai para "Não identificado" |

Abaixo de 0,70 a transação recebe `needs_review = true` e aparece marcada na
interface.

Esta é a decisão de produto mais importante do módulo: **uma transação sem
categoria é melhor do que uma transação na categoria errada.** O usuário confia
no relatório justamente porque não confere linha a linha; um palpite ruim
disfarçado de acerto corrompe o relatório em silêncio, e ele descobre meses
depois — quando já não confia em mais nada.

## Formato de saída

Array JSON, um objeto por transação, mesma ordem da entrada:

```json
[{ "id": "uuid", "slug": "alimentacao.delivery", "confidence": 0.96, "merchant": "iFood" }]
```

`merchant` é o nome limpo — sem adquirente, sem cidade, sem data, sem parcela —
e alimenta a tabela `merchants`, que é o que faz o nível [2] funcionar no mês
seguinte.

Slug inválido devolvido pelo modelo é **descartado** (a transação fica sem
categoria e vai para revisão), nunca escrito no banco. O prompt proíbe inventar
slug; confiar nisso sem validar seria ingênuo.

## Parâmetros da chamada

| Parâmetro | Valor | Por quê |
|---|---|---|
| `temperature` | `0` | Classificação tem de ser reproduzível: o mesmo extrato, duas vezes, dá o mesmo resultado. |
| lote | 40 transações | Equilíbrio entre custo por transação e risco de o modelo perder o alinhamento id ↔ resultado em listas longas. |
| `cache_control` | system + catálogo | Idênticos entre lotes; o cache derruba o custo de entrada em ~90% a partir do 2º lote. |
| prefill `[` | sim | A resposta começa dentro do array; elimina texto de cortesia antes do JSON. |
| validação | zod | Resposta fora do schema é descartada; o lote inteiro cai para revisão manual em vez de escrever lixo. |

## Falha isolada

Um lote que falha (rede, rate limit, JSON inválido) **não** derruba a
importação: as transações daquele lote ficam sem categoria e marcadas para
revisão. Perder categorização é aceitável; perder transação importada, não.
