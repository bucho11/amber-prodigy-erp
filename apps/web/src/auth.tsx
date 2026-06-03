import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { AuthUser } from "@prodigy/contracts";
import { api, ApiError } from "./api";

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  needsSetup: boolean;
  tenantName: string;
}

interface AuthContextValue extends AuthState {
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  setupOwner: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (key: string) => boolean;
}

const Ctx = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true, needsSetup: false, tenantName: "" });

  const refresh = useCallback(async () => {
    try {
      const ctx = await api<{ tenant: { name: string }; needsSetup: boolean }>("/auth/context");
      let user: AuthUser | null = null;
      try {
        user = (await api<{ user: AuthUser }>("/auth/me")).user;
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 401)) throw e;
      }
      setState({ user, loading: false, needsSetup: ctx.needsSetup, tenantName: ctx.tenant.name });
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const { user } = await api<{ user: AuthUser }>("/auth/login", "POST", { email, password });
    setState((s) => ({ ...s, user, needsSetup: false }));
  }, []);

  const setupOwner = useCallback(async (email: string, password: string, displayName: string) => {
    const { user } = await api<{ user: AuthUser }>("/auth/setup-owner", "POST", { email, password, displayName });
    setState((s) => ({ ...s, user, needsSetup: false }));
  }, []);

  const logout = useCallback(async () => {
    await api("/auth/logout", "POST");
    setState((s) => ({ ...s, user: null }));
  }, []);

  const hasPermission = useCallback(
    (key: string) => {
      const u = state.user;
      if (!u) return false;
      return u.role?.isOwner === true || u.permissions.includes(key);
    },
    [state.user]
  );

  return (
    <Ctx.Provider value={{ ...state, refresh, login, setupOwner, logout, hasPermission }}>{children}</Ctx.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
