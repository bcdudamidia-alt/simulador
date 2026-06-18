using System.Collections.Generic;

namespace HDDSim
{
    public enum SoilType { Mole, Medio, Rochoso, Urbano }

    /// <summary>Perfil de solo: afeta avanço, resistência, demanda de lama e risco de redes.</summary>
    public struct SoilProfile
    {
        public string nome;
        public float avanco;   // multiplicador de velocidade de avanço
        public float resist;   // multiplicador de torque/pressão
        public float lama;     // fração de vazão ideal
        public bool redes;     // presença de redes subterrâneas (risco)

        static readonly Dictionary<SoilType, SoilProfile> table = new Dictionary<SoilType, SoilProfile>
        {
            { SoilType.Mole,    new SoilProfile { nome = "SOLO MOLE",    avanco = 1.2f, resist = 0.5f, lama = 0.4f, redes = false } },
            { SoilType.Medio,   new SoilProfile { nome = "SOLO MÉDIO",   avanco = 0.8f, resist = 1.0f, lama = 0.6f, redes = false } },
            { SoilType.Rochoso, new SoilProfile { nome = "SOLO ROCHOSO", avanco = 0.4f, resist = 1.9f, lama = 0.8f, redes = false } },
            { SoilType.Urbano,  new SoilProfile { nome = "ZONA URBANA",  avanco = 0.7f, resist = 1.1f, lama = 0.7f, redes = true  } },
        };

        public static SoilProfile Get(SoilType t) => table[t];
    }
}
