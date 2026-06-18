using System;
using System.Collections.Generic;
using UnityEngine;

namespace HDDSim
{
    public enum FaultId { PressaoLama, CabecotePreso, PoucoRetorno, PerdaSonda, ContatoRede }

    /// <summary>Definição de uma falha operacional (seção 9 do guia da XZ200).</summary>
    public class FaultDef
    {
        public string nome;
        public string causa;
        public string acao;
        public bool critical;
        public Func<DrillSimulation, bool> Resolve;
    }

    public static class FaultDatabase
    {
        public static readonly FaultId[] All =
        {
            FaultId.PressaoLama, FaultId.CabecotePreso, FaultId.PoucoRetorno,
            FaultId.PerdaSonda, FaultId.ContatoRede
        };

        static readonly Dictionary<FaultId, FaultDef> db = new Dictionary<FaultId, FaultDef>
        {
            { FaultId.PressaoLama, new FaultDef {
                nome = "PRESSÃO DE LAMA ALTA",
                causa = "Bico entupido, solo fechando o furo ou fluido insuficiente.",
                acao = "Reduza o avanço e aumente o fluxo de lama.",
                Resolve = s => s.PressaoLama < 55f && s.input.Thrust < 0.4f } },

            { FaultId.CabecotePreso, new FaultDef {
                nome = "CABEÇOTE PRESO",
                causa = "Solo duro, falta de fluido ou torque excessivo.",
                acao = "Não force o torque. Reduza o empuxo e retraia com cuidado.",
                Resolve = s => s.input.Thrust <= 0.05f } },

            { FaultId.PoucoRetorno, new FaultDef {
                nome = "POUCO RETORNO DE LAMA",
                causa = "Perda de circulação / solo absorvendo o fluido.",
                acao = "Reduza o avanço e ajuste a mistura de lama.",
                Resolve = s => s.input.Thrust < 0.3f && s.Vazao > 120f } },

            { FaultId.PerdaSonda, new FaultDef {
                nome = "PERDA DE SINAL DA SONDA",
                causa = "Interferência, bateria da sonda ou profundidade.",
                acao = "Pare o avanço até recuperar a localização confiável.",
                Resolve = s => Mathf.Abs(s.input.Thrust) < 0.05f } },

            { FaultId.ContatoRede, new FaultDef {
                nome = "CONTATO COM REDE SUBTERRÂNEA",
                causa = "A ferramenta atingiu rede de energia/gás/água.",
                acao = "ACIONE A PARADA DE EMERGÊNCIA e isole a área imediatamente.",
                critical = true,
                Resolve = s => s.Estop } },
        };

        public static FaultDef Get(FaultId id) => db[id];
    }
}
