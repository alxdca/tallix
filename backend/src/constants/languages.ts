// Supported languages configuration
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', llmName: 'English' },
  { code: 'fr', label: 'Français', llmName: 'French' },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

export const VALID_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((l) => l.code);

export function getLanguageLLMName(code: string): string {
  const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code);
  return lang?.llmName || 'English';
}
