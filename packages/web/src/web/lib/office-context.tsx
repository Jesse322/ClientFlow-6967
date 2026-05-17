import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from "react";
import type { AirtableRecord, Client } from "./types";

export const OFFICES = [
  "Irvine",
  "Los Angeles",
  "Ontario",
  "Fresno",
  "Sacramento",
  "San Diego",
  "San Francisco",
  "San Jose",
  "Woodland Hills",
  "Roseville",
  "Bakersfield",
] as const;

export type Office = typeof OFFICES[number];

interface OfficeContextValue {
  selectedOffice: Office;
  setSelectedOffice: (o: Office) => void;
  accessibleOffices: Office[];
}

const OfficeContext = createContext<OfficeContextValue>({
  selectedOffice: "Irvine",
  setSelectedOffice: () => {},
  accessibleOffices: [...OFFICES],
});

const STORAGE_KEY = "selected-office";

interface Props {
  children: ReactNode;
  clients?: AirtableRecord<Client>[] | null;
  isAdmin?: boolean;
  sessionLoading?: boolean;
  airtableId?: string | null;
}

export function OfficeProvider({ children, clients, isAdmin, sessionLoading, airtableId }: Props) {
  const [selectedOffice, setSelectedOfficeState] = useState<Office>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && OFFICES.includes(stored as Office)) return stored as Office;
    } catch {}
    return "Irvine";
  });

  // Compute which offices this user can access.
  // Don't restrict until we know the user's role (sessionLoading = false).
  const accessibleOffices = useMemo<Office[]>(() => {
    // Always show all while session is resolving — prevents premature restriction
    if (sessionLoading) return [...OFFICES];
    if (isAdmin) return [...OFFICES];
    if (!airtableId || !clients?.length) return [...OFFICES];
    const accessible = new Set<Office>();
    for (const c of clients) {
      const f = c.fields;
      const teamIds = [
        ...(f["Producer"] || []),
        ...(f["Service Lead"] || []),
        ...(f["Analyst"] || []),
        ...(f["Assigned Team Members"] || []),
      ];
      if (teamIds.includes(airtableId)) {
        const office = f["Office"] as Office | undefined;
        if (office && OFFICES.includes(office)) accessible.add(office);
      }
    }
    // If no offices found (e.g. unassigned or data not ready), show all
    return accessible.size > 0 ? [...accessible] : [...OFFICES];
  }, [sessionLoading, isAdmin, airtableId, clients]);

  // If current selection is not accessible, reset to first accessible
  useEffect(() => {
    if (!accessibleOffices.includes(selectedOffice)) {
      setSelectedOfficeState(accessibleOffices[0] ?? "Irvine");
    }
  }, [accessibleOffices, selectedOffice]);

  const setSelectedOffice = (o: Office) => {
    setSelectedOfficeState(o);
    try { localStorage.setItem(STORAGE_KEY, o); } catch {}
  };

  return (
    <OfficeContext.Provider value={{ selectedOffice, setSelectedOffice, accessibleOffices }}>
      {children}
    </OfficeContext.Provider>
  );
}

export function useOffice() {
  return useContext(OfficeContext);
}
