import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchThirdParties } from '../api';
import { useI18n } from '../contexts/I18nContext';
import { logger } from '../utils/logger';

interface ThirdPartyAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onCommit?: (value: string, source: 'blur' | 'select') => void;
  placeholder?: string;
  className?: string;
}

const SUGGESTION_DEBOUNCE_MS = 120;
const SUGGESTION_CACHE_TTL_MS = 30_000;

const suggestionCache = new Map<string, { expiresAt: number; results: string[] }>();
let warmSuggestionsExpiresAt = 0;
let warmSuggestionsPromise: Promise<void> | null = null;

function getCacheKey(search: string): string {
  return search.trim().toLocaleLowerCase();
}

function filterExactMatches(results: string[], search: string): string[] {
  const normalizedSearch = search.toLocaleLowerCase();
  return results.filter((tp) => tp.toLocaleLowerCase() !== normalizedSearch);
}

function warmSuggestionSource(): void {
  if (warmSuggestionsExpiresAt > Date.now() || warmSuggestionsPromise) {
    return;
  }

  warmSuggestionsPromise = fetchThirdParties()
    .then(() => {
      warmSuggestionsExpiresAt = Date.now() + SUGGESTION_CACHE_TTL_MS;
    })
    .catch((error) => {
      logger.error('Failed to warm third party suggestions', error);
    })
    .finally(() => {
      warmSuggestionsPromise = null;
    });
}

export default function ThirdPartyAutocomplete({
  value,
  onChange,
  onCommit,
  placeholder,
  className = '',
}: ThirdPartyAutocompleteProps) {
  const { t } = useI18n();
  const resolvedPlaceholder = placeholder ?? t('transactions.thirdParty');
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRequestRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch suggestions with debounce
  const fetchSuggestions = useCallback(async (search: string) => {
    const query = search.trim();

    const requestId = activeRequestRef.current + 1;
    activeRequestRef.current = requestId;
    abortControllerRef.current?.abort();

    if (!query) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    const cacheKey = getCacheKey(query);
    const cached = suggestionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      setSuggestions(filterExactMatches(cached.results, query));
      setHighlightedIndex(-1);
      setIsLoading(false);
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsLoading(true);
    try {
      const results = await fetchThirdParties(query, { signal: abortController.signal });
      if (requestId !== activeRequestRef.current) return;

      suggestionCache.set(cacheKey, {
        expiresAt: Date.now() + SUGGESTION_CACHE_TTL_MS,
        results,
      });
      setSuggestions(filterExactMatches(results, query));
      setHighlightedIndex(-1);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      logger.error('Failed to fetch third parties', error);
      setSuggestions([]);
    } finally {
      if (requestId === activeRequestRef.current) {
        setIsLoading(false);
      }
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
    }
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    activeRequestRef.current += 1;
    abortControllerRef.current?.abort();
    setIsLoading(false);

    if (isOpen && value.trim()) {
      debounceRef.current = setTimeout(() => {
        fetchSuggestions(value);
      }, SUGGESTION_DEBOUNCE_MS);
    } else {
      setSuggestions([]);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [value, isOpen, fetchSuggestions]);

  useEffect(() => {
    warmSuggestionSource();

    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    setIsOpen(true);
  };

  const handleInputFocus = () => {
    setIsOpen(true);
  };

  const handleSelectSuggestion = (suggestion: string) => {
    onChange(suggestion);
    onCommit?.(suggestion, 'select');
    setIsOpen(false);
    setSuggestions([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || suggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
          handleSelectSuggestion(suggestions[highlightedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        break;
    }
  };

  return (
    <div className="third-party-autocomplete" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleInputChange}
        onFocus={handleInputFocus}
        onBlur={() => onCommit?.(value, 'blur')}
        onKeyDown={handleKeyDown}
        placeholder={resolvedPlaceholder}
        className={`autocomplete-input ${className}`}
        autoComplete="off"
      />

      {isOpen && (suggestions.length > 0 || isLoading) && (
        <div className="autocomplete-dropdown">
          {isLoading ? (
            <div className="autocomplete-loading">
              <span>{t('common.searching')}</span>
            </div>
          ) : (
            suggestions.map((suggestion, index) => (
              <div
                key={suggestion}
                className={`autocomplete-option ${index === highlightedIndex ? 'highlighted' : ''}`}
                onClick={() => handleSelectSuggestion(suggestion)}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                {suggestion}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
