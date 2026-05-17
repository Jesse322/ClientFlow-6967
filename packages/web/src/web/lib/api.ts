import type { AirtableRecord, Client, Deliverable, OpenItem, TeamMember, OmniSolution } from "./types";

const BASE = "/api";

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }
  return res.json();
}

// Clients
export const getClients = () => apiFetch<AirtableRecord<Client>[]>("/clients");
export const getClient = (id: string) => apiFetch<AirtableRecord<Client>>(`/clients/${id}`);
export const createClient = (fields: Partial<Client>) =>
  apiFetch<AirtableRecord<Client>>("/clients", { method: "POST", body: JSON.stringify({ fields }) });
export const updateClient = (id: string, fields: Partial<Client>) =>
  apiFetch<AirtableRecord<Client>>(`/clients/${id}`, { method: "PATCH", body: JSON.stringify({ fields }) });
export const deleteClient = (id: string) =>
  apiFetch(`/clients/${id}`, { method: "DELETE" });

// Deliverables
export const getDeliverables = () => apiFetch<AirtableRecord<Deliverable>[]>("/deliverables");
export const createDeliverable = (fields: Partial<Deliverable>) =>
  apiFetch<AirtableRecord<Deliverable>>("/deliverables", { method: "POST", body: JSON.stringify({ fields }) });
export const updateDeliverable = (id: string, fields: Partial<Deliverable>) =>
  apiFetch<AirtableRecord<Deliverable>>(`/deliverables/${id}`, { method: "PATCH", body: JSON.stringify({ fields }) });
export const deleteDeliverable = (id: string) =>
  apiFetch(`/deliverables/${id}`, { method: "DELETE" });

// Open Items
export const getOpenItems = () => apiFetch<AirtableRecord<OpenItem>[]>("/open-items");
export const createOpenItem = (fields: Partial<OpenItem>) =>
  apiFetch<AirtableRecord<OpenItem>>("/open-items", { method: "POST", body: JSON.stringify({ fields }) });
export const updateOpenItem = (id: string, fields: Partial<OpenItem>) =>
  apiFetch<AirtableRecord<OpenItem>>(`/open-items/${id}`, { method: "PATCH", body: JSON.stringify({ fields }) });
export const deleteOpenItem = (id: string) =>
  apiFetch(`/open-items/${id}`, { method: "DELETE" });

// OMNI
export const getOmniSolutions = () => apiFetch<AirtableRecord<OmniSolution>[]>("/omni");
export const updateClientOmni = (clientId: string, omniIds: string[]) =>
  apiFetch(`/clients/${clientId}/omni`, { method: "PATCH", body: JSON.stringify({ omniIds }) });

// Team Members
export const getTeamMembers = () => apiFetch<AirtableRecord<TeamMember>[]>("/team-members");
export const createTeamMember = (fields: Partial<TeamMember>) =>
  apiFetch<AirtableRecord<TeamMember>>("/team-members", { method: "POST", body: JSON.stringify({ fields }) });
export const updateTeamMember = (id: string, fields: Partial<TeamMember>) =>
  apiFetch<AirtableRecord<TeamMember>>(`/team-members/${id}`, { method: "PATCH", body: JSON.stringify({ fields }) });
export const deleteTeamMember = (id: string) =>
  apiFetch(`/team-members/${id}`, { method: "DELETE" });

// Gamification
export type GamificationMe = {
  totalPoints: number;
  rank: number;
  badges: string[];
  recentActivity: { action: string; total_points: number; bonus_points: number; awarded_at: string }[];
};
export type LeaderboardEntry = {
  rank: number;
  airtableId: string;
  name: string;
  avatarUrl?: string;
  totalPoints: number;
  badges: string[];
};
export const getGamificationMe = () => apiFetch<GamificationMe>("/gamification/me");
export const getLeaderboard = () => apiFetch<LeaderboardEntry[]>("/gamification/leaderboard");
export const clearAllPoints = () => apiFetch("/gamification/all", { method: "DELETE" });
export const clearUserPoints = (airtableId: string) => apiFetch(`/gamification/user/${airtableId}`, { method: "DELETE" });

// ─── CLIENT CUSTOMIZATION ────────────────────────────────────────────────────
export const searchUnsplash = (q: string, page = 1) =>
  apiFetch<{ results: UnsplashPhoto[]; total: number; total_pages: number }>(`/unsplash/search?q=${encodeURIComponent(q)}&page=${page}`);

export const triggerUnsplashDownload = (download_location: string) =>
  apiFetch("/unsplash/download", { method: "POST", body: JSON.stringify({ download_location }) });

export const uploadClientHeaderPhoto = async (clientId: string, file: File): Promise<{ key: string; url: string }> => {
  const form = new FormData();
  form.append("photo", file);
  // Must NOT set Content-Type — browser sets it with the correct multipart boundary
  const res = await fetch(`${BASE}/clients/${clientId}/header-photo`, {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }
  return res.json();
};

export const deleteClientHeaderPhoto = (clientId: string) =>
  apiFetch(`/clients/${clientId}/header-photo`, { method: "DELETE" });

export type UnsplashPhoto = {
  id: string;
  urls: { regular: string; small: string; thumb: string };
  description: string;
  color: string | null;
  download_location: string;
  user: { name: string; link: string };
};

// AI: suggest task reassignments
export interface ReassignmentSuggestion {
  taskName: string;
  taskType: "deliverable" | "open_item";
  taskId: string;
  fromMemberId: string;
  fromMemberName: string;
  toMemberId: string;
  toMemberName: string;
  reason: string;
  priority: "high" | "medium" | "low";
  sameClient: boolean;
}
export interface ReassignmentResponse {
  suggestions: ReassignmentSuggestion[];
  summary: string;
}
export const suggestReassignments = () =>
  apiFetch<ReassignmentResponse>("/ai/suggest-reassignments", { method: "POST" });

// ─── Onboarding ───────────────────────────────────────────────────────────────

export const saveOnboardingData = (id: string, data: Record<string, any>) =>
  apiFetch<{ ok: boolean }>(`/clients/${id}/onboarding`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  });

export const completeOnboarding = (id: string) =>
  apiFetch<any>(`/clients/${id}/complete-onboarding`, { method: "POST" });
