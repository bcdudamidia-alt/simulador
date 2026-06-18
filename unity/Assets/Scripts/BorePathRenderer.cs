using UnityEngine;

namespace HDDSim
{
    /// <summary>
    /// Desenha a trajetória 3D do furo em tempo real usando um LineRenderer.
    /// Para visual fotorrealista (tubo/haste), substitua por um mesh tubular
    /// gerado ao longo da curva, ou instancie segmentos de haste.
    /// </summary>
    [RequireComponent(typeof(LineRenderer))]
    public class BorePathRenderer : MonoBehaviour
    {
        public DrillSimulation sim;
        public Transform drillHead;     // broca (opcional)
        public float worldScale = 1f;   // metros -> unidades de mundo

        LineRenderer line;
        int lastCount;

        void Awake()
        {
            line = GetComponent<LineRenderer>();
            line.useWorldSpace = true;
            line.numCornerVertices = 4;
        }

        void Update()
        {
            if (sim == null) return;

            if (sim.Path.Count != lastCount)
            {
                line.positionCount = sim.Path.Count;
                for (int i = 0; i < sim.Path.Count; i++)
                    line.SetPosition(i, sim.Path[i] * worldScale);
                lastCount = sim.Path.Count;
            }

            if (drillHead != null)
            {
                drillHead.position = new Vector3(sim.Distancia, -sim.Profundidade, sim.Lateral) * worldScale;
                var mat = drillHead.GetComponent<Renderer>();
                if (mat != null)
                    mat.material.color = sim.ActiveFaults.ContainsKey(FaultId.CabecotePreso)
                        ? Color.red : new Color(1f, 0.69f, 0.12f);
            }
        }
    }
}
