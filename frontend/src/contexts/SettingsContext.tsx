import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';
export type DecimalSeparator = '.' | ',';

interface SettingsContextType {
  theme: Theme;
  decimalSeparator: DecimalSeparator;
  setTheme: (theme: Theme) => void;
  setDecimalSeparator: (separator: DecimalSeparator) => void;
  toggleTheme: () => void;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

const STORAGE_KEYS = {
  theme: 'theme',
  decimalSeparator: 'decimalSeparator',
} as const;

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.theme);
    return (saved as Theme) || 'dark';
  });

  const [decimalSeparator, setDecimalSeparatorState] = useState<DecimalSeparator>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.decimalSeparator);
    return (saved as DecimalSeparator) || '.';
  });

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEYS.theme, theme);
  }, [theme]);

  // Save decimal separator
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.decimalSeparator, decimalSeparator);
  }, [decimalSeparator]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
  }, []);

  const setDecimalSeparator = useCallback((separator: DecimalSeparator) => {
    setDecimalSeparatorState(separator);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return (
    <SettingsContext.Provider
      value={{
        theme,
        decimalSeparator,
        setTheme,
        setDecimalSeparator,
        toggleTheme,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
