import { useState, useEffect, useCallback, useRef } from "react";
import { getClients, getDeliverables, getOpenItems, getTeamMembers } from "@/lib/api";
import type { AirtableRecord, Client, Deliverable, OpenItem, TeamMember } from "@/lib/types";

// Generic fetch hook
function useFetch<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Stable ref so useCallback dep array never changes
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current();
      setData(result);
    } catch (e: any) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []); // stable — never re-creates

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, reload: load };
}

export function useClients() {
  return useFetch<AirtableRecord<Client>[]>(getClients);
}

export function useDeliverables() {
  return useFetch<AirtableRecord<Deliverable>[]>(getDeliverables);
}

export function useOpenItems() {
  return useFetch<AirtableRecord<OpenItem>[]>(getOpenItems);
}

export function useTeamMembers() {
  return useFetch<AirtableRecord<TeamMember>[]>(getTeamMembers);
}

// Combined hook for dashboard
export function useDashboardData() {
  const clients = useClients();
  const deliverables = useDeliverables();
  const openItems = useOpenItems();
  const teamMembers = useTeamMembers();

  const reload = useCallback(() => {
    clients.reload();
    deliverables.reload();
    openItems.reload();
    teamMembers.reload();
  }, [clients.reload, deliverables.reload, openItems.reload, teamMembers.reload]);

  return {
    clients,
    deliverables,
    openItems,
    teamMembers,
    loading: clients.loading || deliverables.loading || openItems.loading,
    reload,
  };
}
