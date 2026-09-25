// Helper to format name with institution
export const formatWithInstitution = (name: string, institution: string | null): string => {
  return institution ? `${name} (${institution})` : name;
};

export function normalizeThirdParty(value?: string | null): string {
  return value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
}

// Parse account ID string
export const parseAccountString = (str: string): { id: number } | null => {
  if (!str) return null;
  const id = parseInt(str, 10);
  if (Number.isNaN(id)) return null;
  return { id };
};
