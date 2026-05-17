import { createContext, useContext, useEffect, useState, ReactNode } from "react";

interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  airtableId: string | null;
}

interface SessionContextType {
  user: SessionUser | null;
  loading: boolean;
  isAdmin: boolean;
  refetch: () => void;
}

const SessionContext = createContext<SessionContextType>({
  user: null,
  loading: true,
  isAdmin: false,
  refetch: () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSession = async () => {
    try {
      const res = await fetch("/api/me");
      const data = await res.json();
      setUser(data.user || null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSession(); }, []);

  const isAdmin = user?.role === "admin";

  return (
    <SessionContext.Provider value={{ user, loading, isAdmin, refetch: fetchSession }}>
      {children}
    </SessionContext.Provider>
  );
}

export const useSession = () => useContext(SessionContext);
