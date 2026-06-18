using System.Collections.Generic;
using UnityEngine;

namespace HDDSim
{
    /// <summary>
    /// Núcleo da simulação da perfuratriz XCMG XZ200 (HDD).
    /// Porte da lógica validada no protótipo web. Mantém o estado da máquina,
    /// física simplificada, gestão de hastes, perfis de solo e sistema de falhas.
    /// Os comandos chegam por <see cref="RigInput"/>; a leitura é consumida pelo
    /// HUD, pela trajetória 3D e pelo modo aula.
    /// </summary>
    public class DrillSimulation : MonoBehaviour
    {
        // ---- Limites de referência (guia XZ200) ----
        public const float MaxForca = 225f;       // kN
        public const float MaxRotacao = 150f;     // rpm
        public const float MaxVazao = 250f;       // L/min
        public const float MaxPressaoLama = 80f;  // bar
        public const float MaxTorque = 6350f;     // N·m
        public const float RodLen = 3f;           // m

        [Header("Entrada")]
        public RigInput input;

        // ---- Instrumentos (leitura) ----
        public float PressaoLama { get; private set; }
        public float Torque { get; private set; }
        public float Rotacao { get; private set; }
        public float Vazao { get; private set; }
        public float Forca { get; private set; }

        // ---- Navegação ----
        public float Barra { get; private set; }
        public float Distancia { get; private set; }
        public float Profundidade { get; private set; }
        public float Inclinacao { get; private set; }
        public float Azimute { get; private set; }
        public float Lateral { get; private set; }
        public readonly List<Vector3> Path = new List<Vector3> { Vector3.zero };

        // ---- Operação ----
        public readonly string[] Modos = { "FURO PILOTO", "ALARGAMENTO", "RETROARRASTO" };
        public int ModoIdx { get; private set; }
        public bool Grampo { get; private set; } = true;
        public bool Estop { get; private set; }
        public SoilType Soil = SoilType.Mole;
        public int Rods { get; private set; } = 1;
        public bool NeedRod { get; private set; }

        // ---- Falhas ----
        public readonly Dictionary<FaultId, float> ActiveFaults = new Dictionary<FaultId, float>();
        public float Tempo { get; private set; }
        public float Penalidades { get; private set; }
        public float Overpressure { get; private set; }

        public int Score => Mathf.Max(0, Mathf.RoundToInt(100 - Penalidades));

        void Update()
        {
            float dt = Time.deltaTime;
            input.Poll();

            Estop = input.Estop;
            Grampo = input.Clamp;
            if (input.ConsumeModeEdge())
                ModoIdx = (ModoIdx + 1) % Modos.Length;

            if (Estop) { DecayAll(dt); ResolveFaults(); Tempo += dt; return; }
            Tempo += dt;

            SoilProfile solo = SoilProfile.Get(Soil);

            Rotacao = Approach(Rotacao, input.Rotation * MaxRotacao, dt * 160f);
            Vazao = Approach(Vazao, input.Flow * MaxVazao, dt * 280f);

            float thrust = input.Thrust;
            Forca = Approach(Forca, Mathf.Abs(thrust) * MaxForca, dt * 240f);

            float torqueAlvo = (Rotacao / MaxRotacao) * 2200f
                             + (Forca / MaxForca) * 3800f * solo.resist;
            Torque = Approach(Torque, Mathf.Clamp(torqueAlvo, 0f, MaxTorque + 200f), dt * 8000f);

            float vazaoFrac = Vazao / MaxVazao;
            float vazaoIdeal = Rotacao > 5f ? solo.lama : 0.15f;
            float faltaLama = Mathf.Max(0f, vazaoIdeal - vazaoFrac);
            float pAlvo = 8f + (Forca / MaxForca) * 40f * solo.resist + faltaLama * 70f;
            PressaoLama = Approach(PressaoLama, Mathf.Clamp(pAlvo, 0f, 95f), dt * 60f);

            NeedRod = Barra >= Rods * RodLen - 0.02f;
            bool bloqueado = ActiveFaults.ContainsKey(FaultId.CabecotePreso);
            float avanco = 0f;
            if (Grampo && !NeedRod && !bloqueado && thrust > 0.05f && Rotacao > 5f)
                avanco = thrust * 0.45f * solo.avanco * dt;
            else if (Grampo && thrust < -0.05f)
                avanco = thrust * 0.4f * dt;

            if (Mathf.Abs(avanco) > 1e-6f)
            {
                float rad = Azimute * Mathf.Deg2Rad;
                Azimute = Mathf.Clamp(Azimute + input.Steer * 8f * dt, -45f, 45f);
                float inclTarget = -2f - Azimute * 0.05f;
                Inclinacao = Approach(Inclinacao, inclTarget, dt * 2f);
                Barra = Mathf.Max(0f, Barra + avanco);
                Distancia = Mathf.Max(0f, Distancia + avanco * Mathf.Cos(rad));
                Lateral += avanco * Mathf.Sin(rad);
                Profundidade = Mathf.Clamp(Profundidade - (Inclinacao / 100f) * avanco * 10f, 0f, 30f);
                Path.Add(new Vector3(Distancia, -Profundidade, Lateral));
                if (Path.Count > 6000) Path.RemoveAt(0);
            }

            EvaluateFaults(dt, solo);
        }

        public void AddRod()
        {
            if (Rotacao > 10f || Mathf.Abs(input.Thrust) > 0.1f)
            {
                Penalidades += 3f;
                return;
            }
            Rods++;
            NeedRod = false;
        }

        public void CycleSoil(SoilType s) => Soil = s;

        public void TriggerRandomFault()
        {
            var ids = new List<FaultId>(FaultDatabase.All);
            if (!SoilProfile.Get(Soil).redes) ids.Remove(FaultId.ContatoRede);
            ActivateFault(ids[Random.Range(0, ids.Count)]);
        }

        void ActivateFault(FaultId id)
        {
            if (!ActiveFaults.ContainsKey(id)) ActiveFaults[id] = Tempo;
        }

        void EvaluateFaults(float dt, SoilProfile solo)
        {
            if (PressaoLama > 72f) ActivateFault(FaultId.PressaoLama);
            if (Torque > MaxTorque * 0.92f && Vazao < 80f) ActivateFault(FaultId.CabecotePreso);
            if (Forca > MaxForca * 0.8f && Vazao < 60f && input.Thrust > 0.3f) ActivateFault(FaultId.PoucoRetorno);
            if (solo.redes && input.Thrust > 0.1f && Random.value < 0.0008f) ActivateFault(FaultId.ContatoRede);

            foreach (var id in ActiveFaults.Keys)
                Penalidades += dt * (FaultDatabase.Get(id).critical ? 12f : 3f);

            if (PressaoLama > 75f) Overpressure += dt;
            ResolveFaults();
        }

        void ResolveFaults()
        {
            var resolved = new List<FaultId>();
            foreach (var id in ActiveFaults.Keys)
                if (FaultDatabase.Get(id).Resolve(this)) resolved.Add(id);
            foreach (var id in resolved) ActiveFaults.Remove(id);
        }

        void DecayAll(float dt)
        {
            Rotacao = Approach(Rotacao, 0f, dt * 120f);
            Vazao = Approach(Vazao, 0f, dt * 280f);
            Forca = Approach(Forca, 0f, dt * 200f);
            Torque = Approach(Torque, 0f, dt * 8000f);
            PressaoLama = Approach(PressaoLama, 0f, dt * 80f);
        }

        static float Approach(float v, float t, float step)
            => v < t ? Mathf.Min(t, v + step) : Mathf.Max(t, v - step);
    }
}
