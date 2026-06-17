# Simulador de Perfuração Horizontal Direcional (HDD)

Protótipo de simulador de treinamento para perfuratriz direcional horizontal
(estilo XCMG XZ200), inspirado nos simuladores usados em autoescola — mas para
operação da máquina de perfuração.

O objetivo é treinar a **coordenação dos comandos** (empuxo, rotação, fluxo de
fluido e direção) em um ambiente virtual seguro, com painel de instrumentos,
visualização do furo direcional e relatório de desempenho.

## Como rodar

Não precisa instalar nada. Basta abrir o `index.html` num navegador moderno
(Chrome, Edge ou Firefox).

Para garantir o funcionamento da Gamepad API, o recomendado é servir por um
servidor local simples:

```bash
# Python 3
python3 -m http.server 8000
# depois acesse http://localhost:8000
```

## Conectando o controle

O simulador usa a **Gamepad API** do navegador. Conecte um joystick/gamepad
USB comum (ex.: controle de Xbox, PlayStation ou joystick genérico), **pressione
qualquer botão** para o navegador detectá-lo, e o indicador "CONTROLE" no topo
mudará para `CONECTADO`.

### Mapeamento padrão

| Comando            | Controle físico            | Teclado          |
|--------------------|----------------------------|------------------|
| Empuxo / Puxo      | Analógico esquerdo (Y)     | `W` / `S`        |
| Direção / Azimute  | Analógico direito (X)      | `A` / `D`        |
| Fluxo de fluido    | Gatilho R2 / RT            | `↑` / `↓`        |
| Rotação da coluna  | Gatilho L2 / LT            | `Q` / `E`        |
| Grampo (abrir/fechar) | Botão A / ✕             | `G`              |
| Trocar modo        | Botão B / ◯                | `M`              |
| Parada de emergência | START                    | `Espaço`         |

Sem controle conectado, o simulador funciona pelo teclado automaticamente.

## O que está implementado

- Painel de instrumentos ao vivo: pressão, torque, velocidade (rpm), fluido, força
- Painel de navegação com perfil do furo (inclinação, azimute, profundidade, distância)
- Modos de operação: Perfuração, Alargamento, Puxo de tubo
- Alertas de segurança (pressão alta, falta de fluido, torque excessivo, e-stop)
- Relatório de desempenho com pontuação e estrelas

## Estrutura

```
index.html        # layout do cockpit / painéis
styles.css        # estilo do painel
js/gamepad.js     # leitura do controle (Gamepad API) + teclado
js/gauges.js      # mostradores circulares em canvas
js/sim.js         # loop e modelo físico da perfuração
```

## Próximos passos possíveis

- Visão 3D da perfuração (Three.js)
- Cenários (zona urbana, travessia de rio, solo rochoso, área rural)
- Suporte a painel físico customizado (Arduino/ESP32) via WebHID/WebSerial
- Registro de sessões e exportação de relatório de treinamento
