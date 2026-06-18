using System;
using System.Collections.Generic;
using UnityEngine;

namespace HDDSim
{
    /// <summary>
    /// Modo Aula — procedimento guiado passo a passo (seção 8 do guia da XZ200).
    /// Cada passo é validado em tempo real contra o estado da simulação e só
    /// avança quando concluído. Conecte os eventos a uma UI para exibir o passo.
    /// </summary>
    public class LessonManager : MonoBehaviour
    {
        public DrillSimulation sim;

        public class Step
        {
            public string title;
            public string instr;
            public Func<DrillSimulation, bool> check;
        }

        public readonly List<Step> Steps = new List<Step>();
        public int Index { get; private set; }
        public bool Active { get; private set; }
        public bool Finished { get; private set; }

        // Eventos para a UI (assine no Inspector ou via código)
        public event Action<Step, int, int> OnStepChanged;     // passo, índice, total
        public event Action<Step> OnStepCompleted;
        public event Action<int> OnFinished;                   // score

        float holdTimer;
        bool advancing;

        void Awake()
        {
            Steps.Add(new Step { title = "Verificação inicial (neutro)",
                instr = "Confirme todos os comandos em neutro: sem empuxo, rotação ou fluxo.",
                check = s => Mathf.Abs(s.input.Thrust) < 0.05f && s.Rotacao < 5f && s.Vazao < 10f });
            Steps.Add(new Step { title = "Acionar a bomba de lama",
                instr = "Aumente o fluxo de lama acima de 100 L/min antes de perfurar.",
                check = s => s.Vazao > 100f });
            Steps.Add(new Step { title = "Iniciar a rotação da coluna",
                instr = "Inicie a rotação acima de 30 rpm, sem forçar.",
                check = s => s.Rotacao > 30f });
            Steps.Add(new Step { title = "Furo piloto — primeiros 3 m",
                instr = "Aplique empuxo suave e avance até completar a primeira haste (3 m).",
                check = s => s.Barra >= 2.98f });
            Steps.Add(new Step { title = "Adicionar nova haste",
                instr = "Pare rotação e avanço e adicione uma nova haste.",
                check = s => s.Rods >= 2 });
            Steps.Add(new Step { title = "Continuar o furo até 6 m",
                instr = "Retome a perfuração mantendo o fluxo de lama, até 6 m.",
                check = s => s.Barra >= 6f });
            Steps.Add(new Step { title = "Correção de trajetória",
                instr = "Use a direção e leve o azimute para além de 5°.",
                check = s => Mathf.Abs(s.Azimute) > 5f });
            Steps.Add(new Step { title = "Mudar para ALARGAMENTO",
                instr = "Troque a fase para ALARGAMENTO.",
                check = s => s.Modos[s.ModoIdx] == "ALARGAMENTO" });
            Steps.Add(new Step { title = "Parada de emergência",
                instr = "Treine a resposta: acione a PARADA de emergência.",
                check = s => s.Estop });
            Steps.Add(new Step { title = "Parada normal",
                instr = "Desarme a emergência e reduza rotação e fluxo a zero.",
                check = s => !s.Estop && s.Rotacao < 5f && s.Vazao < 10f });
        }

        public void StartLesson()
        {
            Active = true; Finished = false; Index = 0; holdTimer = 0f; advancing = false;
            OnStepChanged?.Invoke(Steps[Index], Index, Steps.Count);
        }

        public void StopLesson() => Active = false;

        void Update()
        {
            if (!Active || advancing || sim == null) return;

            if (Steps[Index].check(sim))
            {
                holdTimer += Time.deltaTime;
                if (holdTimer >= 0.4f) { holdTimer = 0f; Complete(); }
            }
            else holdTimer = 0f;
        }

        void Complete()
        {
            OnStepCompleted?.Invoke(Steps[Index]);
            advancing = true;
            Invoke(nameof(Advance), 1.4f);
        }

        void Advance()
        {
            advancing = false;
            Index++;
            if (Index >= Steps.Count)
            {
                Active = false; Finished = true;
                OnFinished?.Invoke(sim.Score);
            }
            else OnStepChanged?.Invoke(Steps[Index], Index, Steps.Count);
        }
    }
}
