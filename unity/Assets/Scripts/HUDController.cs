using UnityEngine;
using UnityEngine.UI;
using TMPro;

namespace HDDSim
{
    /// <summary>
    /// Atualiza os instrumentos e textos da interface (HUD) a partir do estado
    /// da simulação. Ligue os campos no Inspector. Use mostradores radiais
    /// (Image com fillAmount) para reproduzir os manômetros da XZ200.
    /// </summary>
    public class HUDController : MonoBehaviour
    {
        public DrillSimulation sim;

        [Header("Mostradores (Image radial, fillAmount 0..1)")]
        public Image gaugePressao;
        public Image gaugeTorque;
        public Image gaugeRotacao;
        public Image gaugeVazao;
        public Image gaugeForca;

        [Header("Textos")]
        public TMP_Text txtPressao, txtTorque, txtRotacao, txtVazao, txtForca;
        public TMP_Text txtModo, txtTempo, txtIncl, txtAzim, txtProf, txtDist, txtBarra, txtRods, txtScore;

        void Update()
        {
            if (sim == null) return;

            SetGauge(gaugePressao, txtPressao, sim.PressaoLama, DrillSimulation.MaxPressaoLama, "0");
            SetGauge(gaugeTorque, txtTorque, sim.Torque, DrillSimulation.MaxTorque, "0");
            SetGauge(gaugeRotacao, txtRotacao, sim.Rotacao, DrillSimulation.MaxRotacao, "0");
            SetGauge(gaugeVazao, txtVazao, sim.Vazao, DrillSimulation.MaxVazao, "0");
            SetGauge(gaugeForca, txtForca, sim.Forca, DrillSimulation.MaxForca, "0");

            if (txtModo) txtModo.text = sim.Modos[sim.ModoIdx];
            if (txtTempo) txtTempo.text = FormatTime(sim.Tempo);
            if (txtIncl) txtIncl.text = sim.Inclinacao.ToString("0.0") + " %";
            if (txtAzim) txtAzim.text = sim.Azimute.ToString("0.0") + "°";
            if (txtProf) txtProf.text = sim.Profundidade.ToString("0.0") + " m";
            if (txtDist) txtDist.text = sim.Distancia.ToString("0.0") + " m";
            if (txtBarra) txtBarra.text = sim.Barra.ToString("0.00") + " m";
            if (txtRods) txtRods.text = sim.Rods + " (" + (sim.Rods * DrillSimulation.RodLen).ToString("0.0") + " m)";
            if (txtScore) txtScore.text = sim.Score.ToString();
        }

        static void SetGauge(Image gauge, TMP_Text txt, float value, float max, string fmt)
        {
            if (gauge) gauge.fillAmount = Mathf.Clamp01(value / max);
            if (txt) txt.text = value.ToString(fmt);
        }

        static string FormatTime(float s)
        {
            int h = (int)(s / 3600), m = (int)((s % 3600) / 60), sec = (int)(s % 60);
            return $"{h:00}:{m:00}:{sec:00}";
        }
    }
}
