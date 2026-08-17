# Prompt — Consultor financeiro do casal

Prompt secundário que o sistema usa para analisar o mês fechado e gerar dicas
personalizadas. Implementado em
[`apps/api/src/modules/ai/prompts.ts`](../../apps/api/src/modules/ai/prompts.ts)
(`INSIGHTS_SYSTEM_PROMPT`); este documento explica **por que** ele é assim.

---

## O princípio: o modelo não faz conta

A tentação óbvia é mandar o extrato do mês e pedir "analise". Não fazemos isso.

Antes de qualquer chamada, `insights.service.ts` agrega em SQL: total por
categoria, média dos 3 meses anteriores, variação percentual, série mensal,
recorrentes, parcelas futuras já lançadas e a situação de cada meta. O modelo
recebe **números prontos** e faz só o que faz bem: priorizar, explicar e
traduzir em ação.

O motivo é direto: LLM erra aritmética de vez em quando, e um número errado em
app financeiro não é um bug pequeno — é a última vez que aquele casal confia no
produto.

## As quatro restrições que definem o resultado

### 1. Duas pessoas leem juntas

Este é o requisito que separa um app de casal de um app pessoal com dois logins.

> "A Ana gastou R$ 800 a mais que o Bruno neste mês."

Isso é um dado verdadeiro que só produz briga. O prompt proíbe comparação
avaliativa entre parceiros. Quando a diferença importa para uma decisão, ela
aparece como fato ligado à escolha:

> "As despesas pessoais somaram R$ 2.100 de um lado e R$ 1.300 do outro. Se a
> prioridade é acelerar a entrada do apê, vale combinar um teto igual."

Pelo mesmo motivo: nada de julgar consumo. Terapia, jantar caro, um curso, um
jogo — não é papel do app dizer se valeu. O papel é mostrar o impacto no plano
que **eles** definiram.

### 2. Só o que mudou vira insight

Mês normal não precisa de análise. O corte é variação acima de 25% **ou** de
R$ 300 contra a média dos 3 meses anteriores — o que for maior. Sem esse filtro,
o modelo produz "vocês gastaram com mercado este mês", que é ruído com aparência
de relatório.

E gasto pontual é rotulado como pontual: IPVA, seguro anual, presente de
casamento. Projetar IPVA para o mês seguinte produz uma projeção errada e um
alerta que o casal aprende a ignorar.

### 3. Todo real economizado vira tempo

É o diferencial do produto e o que de fato muda comportamento. Comparem:

| ❌ | ✅ |
|---|---|
| "Vocês poderiam gastar menos com delivery." | "Delivery foi R$ 780 contra média de R$ 410. Cortar R$ 300/mês antecipa a entrada do apartamento em ~2 meses." |

A primeira é uma opinião. A segunda é uma escolha com preço em meses de espera.

### 4. Três recomendações, no máximo

Lista de dez itens não é executada por ninguém. Três, ordenadas por impacto
financeiro, com a economia estimada e a dificuldade.

E o relatório sempre reconhece o acerto quando existe — se a taxa de poupança
subiu, isso é dito com o número. Relatório que só cobra é relatório que ninguém
abre no terceiro mês.

## Limites explícitos

- **Nada de recomendação de investimento específica.** Ativo, corretora, cripto
  ou produto financeiro estão fora — isso é atividade regulada. Reserva de
  emergência, prazo e proporção entre guardar e gastar são planejamento, e
  seguem permitidos.
- **Nada de dado inventado.** Se não está no JSON, não existe. Dado insuficiente
  → o modelo diz que é insuficiente, em vez de preencher com genérico.
- **Nada de diagnóstico de vida.** Saúde, vício, crise conjugal: gasto não é
  prontuário.

## Formato

Saída em JSON validado por zod (`insightsPayloadSchema`). Se o schema não bate,
a resposta é descartada e o usuário vê "tente novamente" — nunca um JSON
malformado renderizado como se fosse análise.

```json
{
  "resumo": "…",
  "saude_financeira": { "nota": 7.4, "justificativa": "…", "taxa_poupanca_pct": 32.8, "tendencia": "melhorando" },
  "destaques":    [ { "tipo": "alerta", "titulo": "…", "descricao": "…", "categoria": "alimentacao.delivery", "impacto_reais": 370 } ],
  "recomendacoes":[ { "acao": "…", "economia_mensal_estimada": 300, "impacto_nas_metas": "…", "dificuldade": "media" } ],
  "metas":        [ { "meta_id": "uuid", "situacao": "atrasada", "comentario": "…" } ],
  "projecao_proximo_mes": { "despesa_estimada": 13986, "base": "…", "compromissos_ja_assumidos": 3124 }
}
```

## Parâmetros da chamada

| Parâmetro | Valor | Por quê |
|---|---|---|
| `temperature` | `0.4` | O texto precisa soar humano e variar entre os meses. Os números já vêm prontos, então isso não afeta exatidão. |
| `max_tokens` | `3000` | Cabe a saída completa com folga; corta alucinação longa. |
| prefill `{` | sim | Força a resposta a começar dentro do JSON, eliminando o "Claro! Aqui está:" que quebraria o parse. |
| `cache_control` | no system prompt | O system prompt é idêntico em toda chamada; o cache derruba o custo de entrada. |
| cache em `ai_insights` | por `(household, mês)` | Reabrir a tela não gera nova cobrança. Regenerar exige `?force=true`. |

---

## Exemplo de saída (mês real do seed)

```json
{
  "resumo": "Agosto fechou com R$ 6.045 guardados — o segundo melhor mês do ano. O que puxou para baixo foi delivery, que quase dobrou contra a média.",
  "saude_financeira": {
    "nota": 7.8,
    "justificativa": "Taxa de poupança de 32,8%, acima dos 28,4% da média trimestral.",
    "taxa_poupanca_pct": 32.8,
    "tendencia": "melhorando"
  },
  "destaques": [
    {
      "tipo": "alerta",
      "titulo": "Delivery quase dobrou",
      "descricao": "R$ 780,50 contra uma média de R$ 412 nos três meses anteriores — R$ 368 acima, em 18 pedidos.",
      "categoria": "alimentacao.delivery",
      "impacto_reais": 368
    },
    {
      "tipo": "conquista",
      "titulo": "Casamento entrou na reta final",
      "descricao": "Com R$ 37.800 de R$ 45.000, a meta está adiantada: no ritmo atual vocês fecham em fevereiro, dois meses antes do prazo.",
      "categoria": null,
      "impacto_reais": 1250
    },
    {
      "tipo": "observacao",
      "titulo": "R$ 3.840 ainda sem categoria",
      "descricao": "31% das saídas do mês estão em 'Não identificado'. Revisar essas 7 transações deixa a análise do próximo mês mais precisa.",
      "categoria": "outros.nao-identificado",
      "impacto_reais": 3840
    }
  ],
  "recomendacoes": [
    {
      "acao": "Definam um teto de R$ 400/mês para delivery e acompanhem pelo painel",
      "economia_mensal_estimada": 380,
      "impacto_nas_metas": "Antecipa a entrada do apartamento em cerca de 2 meses.",
      "dificuldade": "media"
    },
    {
      "acao": "Direcionem o excedente do casamento para a viagem ao Japão a partir de março",
      "economia_mensal_estimada": 0,
      "impacto_nas_metas": "A viagem hoje está parada; R$ 1.250/mês a tira do vermelho e a coloca no prazo.",
      "dificuldade": "facil"
    },
    {
      "acao": "Revisem as 7 transações marcadas como 'a revisar'",
      "economia_mensal_estimada": 0,
      "impacto_nas_metas": "Sem impacto direto, mas melhora a precisão das próximas projeções.",
      "dificuldade": "facil"
    }
  ],
  "metas": [
    { "meta_id": "g1", "situacao": "no_ritmo", "comentario": "Precisa de R$ 3.354/mês; a média dos últimos 3 meses foi R$ 2.980." },
    { "meta_id": "g2", "situacao": "adiantada", "comentario": "Faltam R$ 7.200 e sobram 8 meses — R$ 900/mês bastam." },
    { "meta_id": "g3", "situacao": "parada", "comentario": "Sem aportes há 4 meses; seriam necessários R$ 1.985/mês para chegar em outubro de 2027." }
  ],
  "projecao_proximo_mes": {
    "despesa_estimada": 13986,
    "base": "Média dos 3 meses anteriores, mais R$ 3.124 em parcelas já lançadas.",
    "compromissos_ja_assumidos": 3124
  }
}
```
