import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { createItem } from '../api';
import type { BudgetGroup, GroupType } from '../types';
import { logger } from '../utils/logger';

interface CategoryItem {
  id: number;
  name: string;
  groupName: string;
  groupId: number;
  groupType: GroupType;
}

interface CategoryComboboxProps {
  value: number | null;
  onChange: (itemId: number | null) => void;
  groups: BudgetGroup[];
  yearId: number;
  isRequired?: boolean;
  onItemCreated?: (item: {
    id: number;
    name: string;
    groupId: number;
    groupName: string;
    groupType: GroupType;
  }) => void;
}

export default function CategoryCombobox({
  value,
  onChange,
  groups,
  yearId,
  isRequired = false,
  onItemCreated,
}: CategoryComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Flatten all items from groups
  const allItems: CategoryItem[] = groups.flatMap((g) =>
    g.items.map((item) => ({
      id: item.id,
      name: item.name,
      groupName: g.name,
      groupId: g.id,
      groupType: g.type,
    }))
  );

  // Find selected item
  const selectedItem = allItems.find((item) => item.id === value);

  // Filter items based on search
  const filteredItems = search
    ? allItems.filter(
        (item) =>
          item.name.toLowerCase().includes(search.toLowerCase()) ||
          item.groupName.toLowerCase().includes(search.toLowerCase())
      )
    : allItems;

  // Group filtered items by type
  const incomeItems = filteredItems.filter((i) => i.groupType === 'income');
  const expenseItems = filteredItems.filter((i) => i.groupType === 'expense');
  const savingsItems = filteredItems.filter((i) => i.groupType === 'savings');

  // Check if search matches exactly any existing item
  const exactMatch = allItems.some((item) => item.name.toLowerCase() === search.toLowerCase());

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setIsCreating(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputFocus = () => {
    setIsOpen(true);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setIsCreating(false);
    setIsOpen(true);
  };

  const handleSelectItem = (itemId: number) => {
    onChange(itemId);
    setIsOpen(false);
    setSearch('');
    setIsCreating(false);
  };

  const handleStartCreate = () => {
    setIsCreating(true);
    setSelectedGroupId(null);
  };

  const handleCreateItem = async () => {
    if (!search.trim() || !selectedGroupId || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const slug = search
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
      const newItem = await createItem({
        yearId,
        groupId: selectedGroupId,
        name: search.trim(),
        slug,
      });

      const group = groups.find((g) => g.id === selectedGroupId);

      // Notify parent about the new item so it can update its state
      if (onItemCreated && group) {
        onItemCreated({
          id: newItem.id,
          name: search.trim(),
          groupId: selectedGroupId,
          groupName: group.name,
          groupType: group.type,
        });
      }

      // Select the new item
      onChange(newItem.id);
      setIsOpen(false);
      setSearch('');
      setIsCreating(false);
    } catch (error) {
      logger.error('Failed to create item', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClear = () => {
    onChange(null);
    setSearch('');
  };

  const getGroupTypeLabel = (type: GroupType) => {
    switch (type) {
      case 'income':
        return 'Revenu';
      case 'expense':
        return 'Dépense';
      case 'savings':
        return 'Épargne';
    }
  };

  return (
    <div className="category-combobox" ref={containerRef}>
      <div className={`combobox-input-wrapper ${isRequired && !value ? 'required' : ''}`}>
        <input
          ref={inputRef}
          type="text"
          value={isOpen ? search : selectedItem ? `${selectedItem.groupName} → ${selectedItem.name}` : ''}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          placeholder="Sélectionner ou créer..."
          className="combobox-input"
        />
        {value && !isOpen && (
          <button type="button" className="combobox-clear" onClick={handleClear} title="Effacer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
        <button type="button" className="combobox-toggle" onClick={() => setIsOpen(!isOpen)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points={isOpen ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
          </svg>
        </button>
      </div>

      {isOpen && (
        <div className="combobox-dropdown">
          {isCreating ? (
            <div className="combobox-create-form">
              <div className="create-form-header">
                <span>Créer "{search}"</span>
              </div>
              <div className="create-form-body">
                <label>Assigner au groupe :</label>
                <div className="group-options">
                  {groups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      className={`group-option ${selectedGroupId === group.id ? 'selected' : ''} ${group.type}`}
                      onClick={() => setSelectedGroupId(group.id)}
                    >
                      {group.name}
                      <span className="group-type">{getGroupTypeLabel(group.type)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="create-form-actions">
                <button type="button" className="btn-cancel" onClick={() => setIsCreating(false)}>
                  Annuler
                </button>
                <button
                  type="button"
                  className="btn-confirm"
                  onClick={handleCreateItem}
                  disabled={!selectedGroupId || isSubmitting}
                >
                  {isSubmitting ? 'Création...' : 'Créer'}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Create new option */}
              {search && !exactMatch && (
                <div className="combobox-create-option" onClick={handleStartCreate}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Créer "{search}"
                </div>
              )}

              {/* Empty state */}
              {!search && allItems.length === 0 && <div className="combobox-empty">Aucune catégorie disponible</div>}

              {/* No results */}
              {search && filteredItems.length === 0 && (
                <div className="combobox-no-results">Aucun résultat pour "{search}"</div>
              )}

              {/* Income items */}
              {incomeItems.length > 0 && (
                <div className="combobox-group">
                  <div className="combobox-group-label">Revenus</div>
                  {incomeItems.map((item) => (
                    <div
                      key={item.id}
                      className={`combobox-option ${item.id === value ? 'selected' : ''}`}
                      onClick={() => handleSelectItem(item.id)}
                    >
                      <span className="option-group">{item.groupName}</span>
                      <span className="option-arrow">→</span>
                      <span className="option-name">{item.name}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Expense items */}
              {expenseItems.length > 0 && (
                <div className="combobox-group">
                  <div className="combobox-group-label">Dépenses</div>
                  {expenseItems.map((item) => (
                    <div
                      key={item.id}
                      className={`combobox-option ${item.id === value ? 'selected' : ''}`}
                      onClick={() => handleSelectItem(item.id)}
                    >
                      <span className="option-group">{item.groupName}</span>
                      <span className="option-arrow">→</span>
                      <span className="option-name">{item.name}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Savings items */}
              {savingsItems.length > 0 && (
                <div className="combobox-group">
                  <div className="combobox-group-label">Épargne</div>
                  {savingsItems.map((item) => (
                    <div
                      key={item.id}
                      className={`combobox-option ${item.id === value ? 'selected' : ''}`}
                      onClick={() => handleSelectItem(item.id)}
                    >
                      <span className="option-group">{item.groupName}</span>
                      <span className="option-arrow">→</span>
                      <span className="option-name">{item.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
