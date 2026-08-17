'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, setAccessToken } from './api';

/**
 * Sessão do usuário.
 *
 * O access token NÃO fica aqui no estado do React nem em localStorage — ele
 * vive numa variável de módulo em `api.ts`. Este contexto guarda só a
 * identidade (nome, e-mail, household), que é informação de UI e não
 * credencial.
 *
 * No boot, tentamos um refresh silencioso: se o cookie httpOnly ainda for
 * válido, o usuário volta logado sem digitar nada. É isso que faz um F5 não
 * deslogar, mesmo com o token em memória.
 *
 * `demo` é um quarto estado, não um usuário falso: as telas que dependem de
 * dados reais sabem que estão em demonstração e desabilitam as ações de
 * escrita, em vez de fingir que salvaram.
 */

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export interface SessionHousehold {
  id: string;
  name: string;
  role: string;
}

type Status = 'loading' | 'authenticated' | 'unauthenticated' | 'demo';

interface SessionValue {
  status: Status;
  user: SessionUser | null;
  household: SessionHousehold | null;
  /** `viewer` só lê: a UI esconde os botões de escrita, e a API bloqueia de novo. */
  canWrite: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  enterDemo: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [household, setHousehold] = useState<SessionHousehold | null>(null);

  useEffect(() => {
    let cancelled = false;

    void api
      .refresh()
      .then((result) => {
        if (cancelled) return;
        setUser(result.user);
        setHousehold(result.household);
        setStatus('authenticated');
      })
      .catch(() => {
        if (!cancelled) setStatus('unauthenticated');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
    setUser(result.user);
    setHousehold(result.household);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    // O logout roda mesmo se a chamada falhar: deixar o usuário preso em uma
    // sessão que ele pediu para encerrar é pior do que um token órfão no banco
    // (que expira sozinho em 30 dias).
    await api.logout().catch(() => undefined);
    setAccessToken(null);
    setUser(null);
    setHousehold(null);
    setStatus('unauthenticated');
  }, []);

  const enterDemo = useCallback(() => {
    setUser({ id: 'demo', name: 'Visitante', email: 'demo@pareo.app' });
    setHousehold({ id: 'demo', name: 'Casa da Ana e do Bruno', role: 'viewer' });
    setStatus('demo');
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user,
      household,
      canWrite: status === 'authenticated' && household?.role !== 'viewer',
      login,
      logout,
      enterDemo,
    }),
    [status, user, household, login, logout, enterDemo],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession precisa estar dentro de <SessionProvider>.');
  return context;
}
