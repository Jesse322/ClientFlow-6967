export interface AirtableRecord<T = Record<string, any>> {
  id: string;
  createdTime?: string;
  fields: T;
}

export interface Client {
  "Client Name": string;
  "Renewal Date"?: string;
  "Active"?: boolean;
  "Revenue"?: number;
  "Funding Strategy"?: string;
  "Company Size"?: string;
  "Medical Carrier/TPA"?: string[];
  "Ancillary Carrier"?: string[];
  "Location"?: string;
  "Intake Notes"?: string;
  "Producer"?: string[];
  "Service Lead"?: string[];
  "Analyst"?: string[];
  "Assigned Team Members"?: string[];
  "Deliverables"?: string[];
  "Open Items Log"?: string[];
  "Total Deliverables"?: number;
  "RxDC Reporting Complete?"?: string;
  "Date Added"?: string;
  "OMNI Solutions"?: string[];
  "OMNI Solution (from OMNI Solutions)"?: string[];
  "Theme Color"?: string | null;
  "Header Photo URL"?: string | null;
  "Header Photo Source"?: "unsplash" | "upload" | null;
  "Header Photo Credit"?: { name: string; link: string } | null;
  // PEO fields
  "PEO Name"?: string;
  // Self Funded sub-fields
  "SF Arrangement"?: string;
  "PBM"?: string;
  "Stop Loss"?: string;
  "TPA Name"?: string;
  "Segment"?: string;
  // Onboarding
  "Is Onboarding"?: boolean;
  "BOR Date"?: string;
  "Onboarding Data"?: Record<string, any>;
  // Office
  "Office"?: string;
}

export interface Deliverable {
  "Deliverable Name": string;
  "Client"?: string[];
  "Assigned Team Members"?: string[];
  "Type"?: string;
  "Deadline"?: string;
  "Completion Date"?: string;
  "Status"?: "Not Started" | "In Progress" | "Completed" | "Overdue";
  "Notes"?: string;
  "Days Until Deadline"?: number;
  "Renewal Timeline Phase"?: string;
  "Responsibility"?: string[];
  "Template Source"?: string;
}

export interface OpenItem {
  "Open Item Name": string;
  "Client"?: string[];
  "Notes"?: string;
  "Status"?: "Not Started" | "In Progress" | "Closed" | "Stuck";
  "Begin Date"?: string;
  "Due Date"?: string;
  "Completion Date"?: string;
  "Producer"?: string[];
  "Assigned To"?: string[];
  "Open Item Type"?: string;
  "Priority"?: "Low" | "Medium" | "High" | "Urgent";
  "Priority (AI Suggested)"?: string;
  "Full Name (from Assigned To)"?: string[];
  "Reviewed by AI (Summary of Notes)"?: { state: string; value: string | null };
  "Created At"?: string;
  "Recurring"?: boolean;
  "Recurrence Rate"?: string;
}

export const OMNI_CATEGORIES = [
  "OMNI - Medical",
  "OMNI - HR Support",
  "OMNI - Population Health",
  "OMNI - Compliance",
  "OMNI - Pharmacy",
  "OMNI - Care Intervention",
  "OMNI - Ancillary",
] as const;

export type OmniCategory = typeof OMNI_CATEGORIES[number];

export interface OmniSolution {
  "OMNI - Medical"?: string;
  "OMNI - HR Support"?: string;
  "OMNI - Population Health"?: string;
  "OMNI - Compliance"?: string;
  "OMNI - Pharmacy"?: string;
  "OMNI - Care Intervention"?: string;
  "OMNI - Ancillary"?: string;
  "Clients"?: string[];
}

export interface TeamMember {
  "Full Name": string;
  "Email"?: string;
  "_email"?: string | null;
  "Email Address"?: { state: string; value: string | null } | string;
  "Role"?: string;
  "Active Status"?: boolean;
  "Phone Number"?: string;
  "Avatar Seed"?: string | null;
}
