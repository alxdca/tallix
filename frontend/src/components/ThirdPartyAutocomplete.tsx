import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchThirdParties } from '../api';
import { logger } from '../utils/logger';

interface ThirdPartyAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export default function ThirdPartyAutocomplete({
  value,
  onChange,
  placeholder = 'Tiers',
  className = '',
}: ThirdPartyAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch suggestions with debounce
  const fetchSuggestions = useCallback(async (search: string) => {
    if (!search.trim()) {
      setSuggestions([]);
      return;
    }

    setIsLoading(true);
    try {
      const results = await fetchThirdParties(search);
      // Filter out exact matches and current value
      const filtered = results.filter((tp) => tp.toLowerCase() !== search.toLowerCase());
      setSuggestions(filtered);
      setHighlightedIndex(-1);
    } catch (error) {
      logger.error('Failed to fetch third parties', error);
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (isOpen && value.trim()) {
      debounceRef.current = setTimeout(() => {
        fetchSuggestions(value);
      }, 200);
    } else {
      setSuggestions([]);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [value, isOpen, fetchSuggestions]);

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
    if (value.trim()) {
      fetchSuggestions(value);
    }
  };

  const handleSelectSuggestion = (suggestion: string) => {
    onChange(suggestion);
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
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={`autocomplete-input ${className}`}
        autoComplete="off"
      />

      {isOpen && (suggestions.length > 0 || isLoading) && (
        <div className="autocomplete-dropdown">
          {isLoading ? (
            <div className="autocomplete-loading">
              <span>Recherche...</span>
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
