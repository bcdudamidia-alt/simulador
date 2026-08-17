import { AppShell } from '../../components/shell/app-shell';

/**
 * Layout do grupo autenticado.
 *
 * `(app)` é um route group: não aparece na URL, então `/` continua sendo o
 * painel. Serve só para que login fique fora do shell — uma tela de entrada
 * com barra lateral de navegação é um erro clássico.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
