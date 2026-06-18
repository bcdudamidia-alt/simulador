using UnityEngine;

namespace HDDSim
{
    /// <summary>
    /// Entrada unificada dos comandos. Suporta gamepad/joystick e teclado via
    /// o Input clássico da Unity. Para o PAINEL FÍSICO da estação (Arduino/ESP32),
    /// substitua/estenda os métodos Read* por leitura USB-HID ou Serial — o
    /// restante do simulador não muda (mesma interface de comandos).
    ///
    /// Eixos esperados (configurar em Project Settings > Input Manager ou usar
    /// o novo Input System):
    ///   "Thrust"  : empuxo (-1 puxo .. +1 empuxo)   — analógico esquerdo Y
    ///   "Steer"   : direção (-1 .. +1)              — analógico direito X
    ///   "Flow"    : fluxo de lama (0..1)            — gatilho direito
    ///   "Rotation": rotação da coluna (0..1)        — gatilho esquerdo
    /// Botões: "Clamp" (grampo), "Mode" (fase), "EStop" (emergência).
    /// </summary>
    public class RigInput : MonoBehaviour
    {
        [Header("Comandos (somente leitura)")]
        public float Thrust;
        public float Steer;
        public float Flow;
        public float Rotation;
        public bool Clamp = true;
        public bool Estop;

        // Valores persistentes ajustados por painel/teclado (fluxo e rotação)
        float flowValue, rotValue;
        bool modeEdge, prevMode, prevClamp, prevEstop;

        public void Poll()
        {
            // ----- Eixos -----
            float kbThrust = (Input.GetKey(KeyCode.W) ? 1f : 0f) - (Input.GetKey(KeyCode.S) ? 1f : 0f);
            float kbSteer  = (Input.GetKey(KeyCode.D) ? 1f : 0f) - (Input.GetKey(KeyCode.A) ? 1f : 0f);

            Thrust = Mathf.Clamp(GetAxisSafe("Thrust") + kbThrust, -1f, 1f);
            Steer  = Mathf.Clamp(GetAxisSafe("Steer")  + kbSteer,  -1f, 1f);

            // fluxo/rotação: gatilhos OU teclado (incrementais) — valor persistente
            if (Input.GetKey(KeyCode.UpArrow))   flowValue = Mathf.Clamp01(flowValue + 0.02f);
            if (Input.GetKey(KeyCode.DownArrow)) flowValue = Mathf.Clamp01(flowValue - 0.02f);
            if (Input.GetKey(KeyCode.E))         rotValue  = Mathf.Clamp01(rotValue  + 0.02f);
            if (Input.GetKey(KeyCode.Q))         rotValue  = Mathf.Clamp01(rotValue  - 0.02f);

            float trig = Mathf.Max(0f, GetAxisSafe("Flow"));
            float trigR = Mathf.Max(0f, GetAxisSafe("Rotation"));
            Flow = Mathf.Max(flowValue, trig);
            Rotation = Mathf.Max(rotValue, trigR);

            // ----- Botões (com detecção de borda) -----
            bool clampBtn = Input.GetButton("Clamp") || Input.GetKey(KeyCode.G);
            if (clampBtn && !prevClamp) Clamp = !Clamp;
            prevClamp = clampBtn;

            bool modeBtn = Input.GetButton("Mode") || Input.GetKey(KeyCode.M);
            modeEdge = modeBtn && !prevMode;
            prevMode = modeBtn;

            bool estopBtn = Input.GetButton("EStop") || Input.GetKey(KeyCode.Space);
            if (estopBtn && !prevEstop) Estop = !Estop;
            prevEstop = estopBtn;
        }

        public bool ConsumeModeEdge()
        {
            bool e = modeEdge; modeEdge = false; return e;
        }

        // Lê um eixo sem lançar exceção caso não esteja configurado no Input Manager.
        static float GetAxisSafe(string name)
        {
            try { return Input.GetAxis(name); }
            catch { return 0f; }
        }
    }
}
