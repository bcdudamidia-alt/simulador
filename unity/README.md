# Simulador HDD — Scaffold Unity

Scripts C# de partida para a versão **Unity** do simulador (estação de
treinamento fotorrealista). Portam a lógica já validada no protótipo web.

> Este é um **ponto de partida de engenharia**, não um projeto Unity completo.
> A montagem da cena 3D, modelos, materiais e UI é feita no editor da Unity por
> um desenvolvedor. A parte aqui é o "cérebro" do simulador, pronto para uso.

## Como usar

1. Crie um projeto **Unity 2022 LTS** (HDRP para fotorrealismo).
2. Copie a pasta `Assets/Scripts/` para o seu projeto.
3. Instale os pacotes: **TextMeshPro** (HUD) e, opcionalmente, o novo
   **Input System**.
4. Monte a cena e ligue os componentes:

```
GameObject "SimManager"
 ├─ RigInput            (entrada de comandos)
 ├─ DrillSimulation     (núcleo — referencie o RigInput)
 ├─ HUDController        (referencie a simulação + elementos de UI)
 ├─ BorePathRenderer    (LineRenderer + broca)
 └─ LessonManager       (modo aula — assine os eventos na UI)
```

## Scripts

| Arquivo | Função |
|---|---|
| `DrillSimulation.cs` | Núcleo: física, hastes, solos, falhas, navegação |
| `SoilProfiles.cs` | Perfis de solo (mole/médio/rochoso/urbano) |
| `FaultSystem.cs` | Catálogo de falhas (seção 9 do guia) |
| `RigInput.cs` | Entrada unificada (gamepad/teclado → painel físico) |
| `HUDController.cs` | Atualiza mostradores e textos |
| `BorePathRenderer.cs` | Trajetória 3D do furo + broca |
| `LessonManager.cs` | Modo aula passo a passo |

## Configuração de eixos (Input Manager)

Crie os eixos `Thrust`, `Steer`, `Flow`, `Rotation` e os botões `Clamp`,
`Mode`, `EStop`. Para o **painel físico** (Arduino/ESP32), o microcontrolador
aparece como joystick (USB-HID) e os eixos/botões são mapeados aqui, ou então
estenda `RigInput` para ler via Serial.

## Próximos passos no editor

- Modelo 3D da perfuratriz (HDRP, materiais PBR).
- Terreno com Unity Terrain + cenários (urbano, rio, rochoso, rural).
- Manômetros radiais (Image fillAmount) reproduzindo o painel da XZ200.
- Jato de lama, animação da garra/morsa e do carro de avanço.
- Integração final com o painel físico.

Consulte a proposta técnica completa em
[`../PROPOSTA_SIMULADOR_UNITY.md`](../PROPOSTA_SIMULADOR_UNITY.md).
