/**
 * Catálogo de categorias semeado em todo household novo.
 *
 * Os `slug` são a interface entre o banco e o prompt de IA: o modelo só pode
 * responder com um destes valores. Por isso eles são estáveis — renomear um
 * slug quebra o histórico e as regras aprendidas; renomear o `name` não quebra
 * nada. Adicione categorias novas ao fim; não recicle slug antigo.
 */

export interface SystemCategory {
  slug: string;
  name: string;
  kind: 'expense' | 'income' | 'transfer' | 'investment';
  color: string;
  icon: string;
}

export const SYSTEM_CATEGORIES: SystemCategory[] = [
  // ── Moradia ──
  { slug: 'moradia.aluguel', name: 'Aluguel', kind: 'expense', color: '#F97316', icon: 'home' },
  { slug: 'moradia.condominio', name: 'Condomínio', kind: 'expense', color: '#F97316', icon: 'building' },
  { slug: 'moradia.energia', name: 'Energia elétrica', kind: 'expense', color: '#FBBF24', icon: 'zap' },
  { slug: 'moradia.agua', name: 'Água', kind: 'expense', color: '#38BDF8', icon: 'droplet' },
  { slug: 'moradia.internet-telefone', name: 'Internet e telefone', kind: 'expense', color: '#818CF8', icon: 'wifi' },
  { slug: 'moradia.manutencao', name: 'Manutenção e reforma', kind: 'expense', color: '#A16207', icon: 'wrench' },
  { slug: 'moradia.iptu', name: 'IPTU e taxas', kind: 'expense', color: '#B45309', icon: 'file-text' },

  // ── Alimentação ──
  { slug: 'alimentacao.mercado', name: 'Supermercado', kind: 'expense', color: '#22C55E', icon: 'shopping-cart' },
  { slug: 'alimentacao.restaurante', name: 'Restaurante', kind: 'expense', color: '#16A34A', icon: 'utensils' },
  { slug: 'alimentacao.delivery', name: 'Delivery', kind: 'expense', color: '#15803D', icon: 'bike' },
  { slug: 'alimentacao.padaria-cafe', name: 'Padaria e café', kind: 'expense', color: '#65A30D', icon: 'coffee' },

  // ── Transporte ──
  { slug: 'transporte.combustivel', name: 'Combustível', kind: 'expense', color: '#0EA5E9', icon: 'fuel' },
  { slug: 'transporte.app', name: 'Uber e 99', kind: 'expense', color: '#0284C7', icon: 'car' },
  { slug: 'transporte.publico', name: 'Transporte público', kind: 'expense', color: '#0369A1', icon: 'bus' },
  { slug: 'transporte.estacionamento-pedagio', name: 'Estacionamento e pedágio', kind: 'expense', color: '#075985', icon: 'parking' },
  { slug: 'transporte.manutencao-veiculo', name: 'Manutenção do veículo', kind: 'expense', color: '#1E40AF', icon: 'settings' },
  { slug: 'transporte.ipva-seguro', name: 'IPVA e seguro', kind: 'expense', color: '#1E3A8A', icon: 'shield' },

  // ── Saúde ──
  { slug: 'saude.plano', name: 'Plano de saúde', kind: 'expense', color: '#EF4444', icon: 'heart-pulse' },
  { slug: 'saude.farmacia', name: 'Farmácia', kind: 'expense', color: '#DC2626', icon: 'pill' },
  { slug: 'saude.consultas-exames', name: 'Consultas e exames', kind: 'expense', color: '#B91C1C', icon: 'stethoscope' },
  { slug: 'saude.academia', name: 'Academia e esportes', kind: 'expense', color: '#F43F5E', icon: 'dumbbell' },

  // ── Pessoal ──
  { slug: 'pessoal.vestuario', name: 'Roupas e calçados', kind: 'expense', color: '#EC4899', icon: 'shirt' },
  { slug: 'pessoal.beleza', name: 'Beleza e cuidados', kind: 'expense', color: '#DB2777', icon: 'scissors' },
  { slug: 'pessoal.educacao', name: 'Educação e cursos', kind: 'expense', color: '#8B5CF6', icon: 'graduation-cap' },
  { slug: 'pessoal.presentes', name: 'Presentes e doações', kind: 'expense', color: '#A855F7', icon: 'gift' },
  { slug: 'pessoal.pets', name: 'Pets', kind: 'expense', color: '#D97706', icon: 'paw-print' },

  // ── Lazer ──
  { slug: 'lazer.streaming', name: 'Streaming e assinaturas', kind: 'expense', color: '#7C3AED', icon: 'tv' },
  { slug: 'lazer.viagem', name: 'Viagens', kind: 'expense', color: '#06B6D4', icon: 'plane' },
  { slug: 'lazer.entretenimento', name: 'Cinema, shows e bares', kind: 'expense', color: '#6366F1', icon: 'party-popper' },
  { slug: 'lazer.compras', name: 'Compras e eletrônicos', kind: 'expense', color: '#F472B6', icon: 'shopping-bag' },

  // ── Financeiro ──
  { slug: 'financeiro.tarifas', name: 'Tarifas bancárias', kind: 'expense', color: '#64748B', icon: 'landmark' },
  { slug: 'financeiro.juros', name: 'Juros e multas', kind: 'expense', color: '#475569', icon: 'trending-down' },
  { slug: 'financeiro.impostos', name: 'Impostos', kind: 'expense', color: '#334155', icon: 'receipt' },
  { slug: 'financeiro.seguros', name: 'Seguros', kind: 'expense', color: '#1E293B', icon: 'shield-check' },
  { slug: 'financeiro.emprestimo', name: 'Empréstimo e financiamento', kind: 'expense', color: '#0F172A', icon: 'banknote' },

  // ── Receitas ──
  { slug: 'receita.salario', name: 'Salário', kind: 'income', color: '#10B981', icon: 'wallet' },
  { slug: 'receita.freelance', name: 'Freelance e PJ', kind: 'income', color: '#059669', icon: 'briefcase' },
  { slug: 'receita.rendimentos', name: 'Rendimentos', kind: 'income', color: '#047857', icon: 'trending-up' },
  { slug: 'receita.reembolso', name: 'Reembolso', kind: 'income', color: '#34D399', icon: 'undo' },
  { slug: 'receita.outras', name: 'Outras receitas', kind: 'income', color: '#6EE7B7', icon: 'plus-circle' },

  // ── Transferências (não entram em despesa nem em receita) ──
  { slug: 'transferencia.entre-contas', name: 'Entre contas próprias', kind: 'transfer', color: '#94A3B8', icon: 'arrow-left-right' },
  { slug: 'transferencia.pagamento-fatura', name: 'Pagamento de fatura', kind: 'transfer', color: '#94A3B8', icon: 'credit-card' },
  { slug: 'transferencia.pix', name: 'PIX entre pessoas', kind: 'transfer', color: '#A3A3A3', icon: 'send' },

  // ── Investimentos ──
  { slug: 'investimento.aplicacao', name: 'Aplicação', kind: 'investment', color: '#0D9488', icon: 'piggy-bank' },
  { slug: 'investimento.resgate', name: 'Resgate', kind: 'investment', color: '#14B8A6', icon: 'hand-coins' },
  { slug: 'investimento.aporte-meta', name: 'Aporte em meta', kind: 'investment', color: '#2DD4BF', icon: 'target' },

  // ── Fallback ──
  // Existe para que o modelo tenha para onde ir quando não sabe. Sem isso, ele
  // escolhe a categoria "mais parecida" e polui o relatório com palpite ruim.
  { slug: 'outros.nao-identificado', name: 'Não identificado', kind: 'expense', color: '#94A3B8', icon: 'help-circle' },
];
