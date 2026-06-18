# Proposta Técnica — Simulador HDD em Unity
### Estação de treinamento para operadores de Perfuração Horizontal Direcional (XCMG XZ200)

> Documento para apresentação a parceiros de desenvolvimento e ao ICAP.
> Acompanha o **protótipo web** já desenvolvido (MVP / especificação interativa)
> e o **guia operacional da XZ200** usado como referência técnica.

---

## 1. Visão geral

O objetivo é uma **estação de treinamento** com controles físicos semelhantes
aos da perfuratriz real, conectados a um software 3D fotorrealista que reproduz
em tempo real todas as funções da máquina, a operação de perfuração e os
procedimentos de segurança.

O projeto tem **duas camadas**:

| Camada | Conteúdo | Onde é feito |
|---|---|---|
| **Software (simulação + 3D)** | Física, instrumentos, falhas, navegação, cenários, modo aula, renderização fotorrealista | Unity (engine) |
| **Hardware (painel físico)** | Joysticks, chaves, botões e manômetros réplica da XZ200 | Marcenaria + eletrônica (microcontrolador) |

O **protótipo web** já entregue prova e valida toda a camada de software
(lógica e fluxo). A migração para Unity eleva o **realismo gráfico** ao nível
da imagem de referência e permite os controles físicos dedicados.

---

## 2. Por que Unity (e não Unreal)

Ambas as engines entregam fotorrealismo. Para **este** projeto, recomendamos
**Unity** pelos seguintes motivos:

- **Integração com hardware** mais simples: o `Input System` da Unity lê
  joysticks/gamepads nativamente, e a leitura de painéis customizados
  (Arduino/ESP32) via **USB-HID ou Serial** é direta com plugins C# maduros.
- **Produtividade em C#**: ciclo de desenvolvimento mais rápido que o C++ do
  Unreal; mais fácil de manter e evoluir por equipes menores.
- **Asset Store**: vasto catálogo de máquinas de construção, terrenos e
  vegetação fotorrealista (HDRP), reduzindo custo de modelagem.
- **HDRP (High Definition Render Pipeline)**: qualidade visual mais que
  suficiente para o realismo da referência (iluminação física, sombras,
  materiais PBR).
- **Hardware da estação**: roda bem em um PC dedicado de custo moderado.

> Unreal seria indicado apenas se o cliente exigir cinematografia de altíssimo
> nível; o custo e o tamanho de equipe são maiores.

---

## 3. Arquitetura do software (Unity)

```
┌─────────────────────────────────────────────────────────────┐
│                      ESTAÇÃO DE TREINAMENTO                   │
│                                                              │
│  Painel físico (réplica XZ200)        Monitor(es) 3D         │
│  joysticks / chaves / botões  ──┐        ▲                   │
│                                 │        │                   │
│         USB-HID / Serial        ▼        │ render fotorrealista
│                          ┌──────────────────────┐            │
│                          │   RigInput (C#)       │            │
│                          └──────────┬───────────┘            │
│                                     ▼                        │
│                          ┌──────────────────────┐            │
│                          │  DrillSimulation (C#) │  núcleo   │
│                          │  física • hastes •    │            │
│                          │  solos • falhas •     │            │
│                          │  navegação            │            │
│                          └───┬───────────┬───────┘            │
│              ┌───────────────┘           └─────────────┐     │
│              ▼                ▼                         ▼     │
│      HUDController     BorePathRenderer          LessonManager│
│      (instrumentos)    (trajetória 3D)           (modo aula)  │
└─────────────────────────────────────────────────────────────┘
```

Os scripts C# de partida estão em [`unity/Assets/Scripts/`](unity/Assets/Scripts/)
— já portam a lógica validada no protótipo web (specs da XZ200, solos, hastes,
fases, falhas e modo aula).

### Componentes
- **DrillSimulation.cs** — núcleo: estado da máquina, física simplificada,
  gestão de hastes, perfis de solo, sistema de falhas e navegação.
- **RigInput.cs** — entrada unificada (gamepad/teclado/painel físico HID).
- **HUDController.cs** — atualiza instrumentos e textos da interface.
- **BorePathRenderer.cs** — desenha a trajetória 3D do furo em tempo real.
- **LessonManager.cs** — procedimento guiado passo a passo (seção 8 do guia).

---

## 4. Especificações técnicas (calibração XZ200)

Valores de referência do guia operacional, já usados no protótipo:

| Parâmetro | Valor |
|---|---|
| Força de empurra/puxa | ~225 kN |
| Velocidade de empurra/puxa | 0–26 m/min |
| Rotação do cabeçote | 0–150 rpm |
| Torque máximo | ~6.350 N·m |
| Vazão da bomba de lama | até 250 L/min |
| Pressão máxima da lama | até 80 bar |
| Haste padrão | 60 mm × 3 m |
| Ângulo de entrada | ~10° a 22° |

---

## 5. Funcionalidades (do briefing do ICAP)

| Funcionalidade | Protótipo web | Plano Unity |
|---|---|---|
| Rotação da haste | ✅ | ✅ + animação 3D |
| Empuxo e puxamento | ✅ | ✅ + animação do carro |
| Controle de fluxo de fluido | ✅ | ✅ + jato de lama |
| Abertura/fechamento de grampos | ✅ | ✅ + animação da garra |
| Alimentação de hastes | ✅ (básico) | ✅ sequência completa com morsas |
| Leitura de manômetros e indicadores | ✅ | ✅ HUD + painel físico |
| Comandos de emergência | ✅ | ✅ |
| Simulação de falhas operacionais | ✅ | ✅ ampliado |
| Procedimentos de segurança | ✅ (modo aula) | ✅ com avaliação |
| Navegação e trajetória | ✅ (2D + 3D simples) | ✅ 3D fotorrealista |
| Diferentes solos e cenários | ✅ | ✅ ambientes completos |

---

## 6. Integração com o painel físico

1. **Painel réplica** com os joysticks, chaves seletoras e botões da XZ200
   (rotação/pressão, balanceamento, alta/baixa, escoras, ângulo do quadro,
   emergência, etc.).
2. **Microcontrolador** (Arduino Mega / ESP32) lê cada entrada (analógica e
   digital) e envia ao PC por **USB-HID** (aparece como joystick) ou **Serial**.
3. Em Unity, **RigInput.cs** mapeia cada eixo/botão para a função correspondente
   — exatamente como o mapeamento já definido no protótipo web.

> Vantagem: como o protótipo já desacopla a entrada, o mapeamento de comandos
> é reaproveitado. Trocar "gamepad" por "painel físico" é configuração, não
> reescrita.

---

## 7. Fases sugeridas do projeto

1. **Fase 0 — Validação (concluída):** protótipo web (lógica + UX + MVP de 3D).
2. **Fase 1 — Núcleo Unity:** portar simulação (scripts já iniciados), HUD e
   navegação 3D com modelo da máquina e terreno.
3. **Fase 2 — Fotorrealismo:** HDRP, materiais PBR, iluminação, cenários
   (zona urbana, travessia de rio, solo rochoso, área rural).
4. **Fase 3 — Hardware:** painel físico + integração HID/Serial.
5. **Fase 4 — Treinamento:** modo aula avançado, avaliação, relatórios e
   registro de sessões para o ICAP.

---

## 8. O que já está pronto para acelerar

- **Protótipo web funcional** (esta mesma repo) — referência viva de UX e lógica.
- **Scripts C# de partida** em `unity/Assets/Scripts/` — núcleo da simulação,
  entrada, HUD, trajetória e modo aula.
- **Calibração XZ200** e **catálogo de falhas/procedimentos** já estruturados
  a partir do guia operacional.

---

## 9. Recursos / assets recomendados (Unity)

- **Engine:** Unity 2022 LTS ou superior, com **HDRP**.
- **Máquina:** modelo 3D de perfuratriz HDD (modelagem própria a partir de fotos
  da XZ200, ou base da Asset Store ajustada).
- **Terreno e vegetação:** Unity Terrain + pacotes PBR de solo/grama.
- **Hardware:** Arduino Mega/ESP32, joysticks industriais, chaves e botões.

---

*Documento de apoio. A operação real deve sempre seguir o manual oficial da
XCMG, normas aplicáveis e profissional habilitado.*
