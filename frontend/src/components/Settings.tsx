import type React from 'react';
import { type DragEvent, useCallback, useEffect, useState } from 'react';
import {
  createGroup,
  createItem,
  createPaymentMethod,
  deleteGroup,
  deleteItem,
  deletePaymentMethod,
  fetchPaymentMethods,
  fetchUnassignedItems,
  moveItem,
  type PaymentMethod,
  reorderGroups,
  reorderItems,
  reorderPaymentMethods,
  togglePaymentMethodAccount,
  updateGroup,
  updateItem,
  updatePaymentMethod,
} from '../api';
import { useSettings } from '../contexts/SettingsContext';
import type { BudgetGroup, BudgetItem } from '../types';
import { logger } from '../utils/logger';

interface SettingsProps {
  yearId: number;
  groups: BudgetGroup[];
  onDataChanged: () => void;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

type SettingsTab = 'categories' | 'accounts' | 'preferences';

export default function Settings({ yearId, groups, onDataChanged }: SettingsProps) {
  const { theme, decimalSeparator, toggleTheme, setDecimalSeparator } = useSettings();
  const [activeTab, setActiveTab] = useState<SettingsTab>('categories');
  const [editingGroup, setEditingGroup] = useState<number | null>(null);
  const [editingItem, setEditingItem] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [unassignedItems, setUnassignedItems] = useState<BudgetItem[]>([]);
  const [draggedItem, setDraggedItem] = useState<{ id: number; name: string; groupId: number | null } | null>(null);
  const [dropTarget, setDropTarget] = useState<number | 'unassigned' | null>(null);
  const [dropTargetItem, setDropTargetItem] = useState<number | null>(null);

  // Inline add states
  const [addingGroupTo, setAddingGroupTo] = useState<'income' | 'expense' | 'savings' | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [addingItemTo, setAddingItemTo] = useState<number | null>(null);
  const [newItemName, setNewItemName] = useState('');

  // Payment methods state
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [newPaymentMethod, setNewPaymentMethod] = useState('');
  const [editingPaymentMethod, setEditingPaymentMethod] = useState<number | null>(null);
  const [editPaymentMethodName, setEditPaymentMethodName] = useState('');
  const [editSettlementDay, setEditSettlementDay] = useState<string>('');
  const [editLinkedPaymentMethodId, setEditLinkedPaymentMethodId] = useState<number | null>(null);

  // Payment methods that are accounts (for linked account selection)
  const accountPaymentMethods = paymentMethods.filter((pm) => pm.isAccount);

  // Sort groups by sortOrder within their category
  const incomeGroups = [...groups.filter((g) => g.type === 'income')].sort((a, b) => a.sortOrder - b.sortOrder);
  const expenseGroups = [...groups.filter((g) => g.type === 'expense')].sort((a, b) => a.sortOrder - b.sortOrder);
  const savingsGroups = [...groups.filter((g) => g.type === 'savings')].sort((a, b) => a.sortOrder - b.sortOrder);

  const loadUnassignedItems = useCallback(async () => {
    try {
      const items = await fetchUnassignedItems();
      setUnassignedItems(items);
    } catch (error) {
      logger.error('Failed to load unassigned items', error);
    }
  }, []);

  const loadPaymentMethods = useCallback(async () => {
    try {
      const methods = await fetchPaymentMethods();
      setPaymentMethods(methods);
    } catch (error) {
      logger.error('Failed to load payment methods', error);
    }
  }, []);

  useEffect(() => {
    loadUnassignedItems();
    loadPaymentMethods();
  }, [loadPaymentMethods, loadUnassignedItems]);

  const handleCreatePaymentMethod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPaymentMethod.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await createPaymentMethod({
        name: newPaymentMethod.trim(),
        sortOrder: paymentMethods.length,
      });
      setNewPaymentMethod('');
      await loadPaymentMethods();
    } catch (error) {
      logger.error('Failed to create payment method', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdatePaymentMethod = async (id: number) => {
    if (!editPaymentMethodName.trim() || isSubmitting) return;

    const settlementDay = editSettlementDay.trim() === '' ? null : parseInt(editSettlementDay, 10);
    if (
      editSettlementDay.trim() !== '' &&
      (Number.isNaN(settlementDay!) || settlementDay! < 1 || settlementDay! > 31)
    ) {
      return; // Invalid settlement day
    }

    setIsSubmitting(true);
    try {
      await updatePaymentMethod(id, {
        name: editPaymentMethodName.trim(),
        settlementDay,
        linkedPaymentMethodId: editLinkedPaymentMethodId,
      });
      setEditingPaymentMethod(null);
      setEditPaymentMethodName('');
      setEditSettlementDay('');
      setEditLinkedPaymentMethodId(null);
      await loadPaymentMethods();
    } catch (error) {
      logger.error('Failed to update payment method', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeletePaymentMethod = async (id: number) => {
    if (isSubmitting) return;
    if (!confirm('Supprimer ce moyen de paiement ?')) return;

    setIsSubmitting(true);
    try {
      await deletePaymentMethod(id);
      await loadPaymentMethods();
    } catch (error) {
      logger.error('Failed to delete payment method', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTogglePaymentMethodAccount = async (id: number, currentIsAccount: boolean) => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      await togglePaymentMethodAccount(id, !currentIsAccount);
      await loadPaymentMethods();
      onDataChanged();
    } catch (error) {
      logger.error('Failed to toggle payment method account', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMovePaymentMethod = async (index: number, direction: 'up' | 'down') => {
    if (isSubmitting) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= paymentMethods.length) return;

    const reordered = [...paymentMethods];
    [reordered[index], reordered[newIndex]] = [reordered[newIndex], reordered[index]];

    const updates = reordered.map((method, idx) => ({
      id: method.id,
      sortOrder: idx,
    }));

    setIsSubmitting(true);
    try {
      await reorderPaymentMethods(updates);
      await loadPaymentMethods();
    } catch (error) {
      logger.error('Failed to reorder payment methods', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const startEditPaymentMethod = (method: PaymentMethod) => {
    setEditingPaymentMethod(method.id);
    setEditPaymentMethodName(method.name);
    setEditSettlementDay(method.settlementDay?.toString() || '');
    setEditLinkedPaymentMethodId(method.linkedPaymentMethodId);
    setEditingGroup(null);
    setEditingItem(null);
  };

  const cancelEditPaymentMethod = () => {
    setEditingPaymentMethod(null);
    setEditPaymentMethodName('');
    setEditSettlementDay('');
    setEditLinkedPaymentMethodId(null);
  };

  const handleCreateGroup = async (groupType: 'income' | 'expense' | 'savings') => {
    if (!newGroupName.trim() || isSubmitting) return;

    const sectionGroups =
      groupType === 'income' ? incomeGroups : groupType === 'expense' ? expenseGroups : savingsGroups;
    const maxSortOrder = sectionGroups.length > 0 ? Math.max(...sectionGroups.map((g) => g.sortOrder)) + 1 : 0;

    setIsSubmitting(true);
    try {
      await createGroup({
        yearId,
        name: newGroupName.trim(),
        slug: slugify(newGroupName),
        type: groupType,
        sortOrder: maxSortOrder,
      });
      setNewGroupName('');
      setAddingGroupTo(null);
      onDataChanged();
    } catch (error) {
      logger.error('Failed to create group', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateItem = async (groupId: number) => {
    if (!newItemName.trim() || isSubmitting) return;

    const group = groups.find((g) => g.id === groupId);
    const sortOrder = group ? group.items.length : 0;

    setIsSubmitting(true);
    try {
      await createItem({
        yearId,
        groupId,
        name: newItemName.trim(),
        slug: slugify(newItemName),
        sortOrder,
      });
      setNewItemName('');
      setAddingItemTo(null);
      await loadUnassignedItems();
      onDataChanged();
    } catch (error) {
      logger.error('Failed to create item', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateGroup = async (groupId: number) => {
    if (!editName.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await updateGroup(groupId, {
        name: editName.trim(),
        slug: slugify(editName),
      });
      setEditingGroup(null);
      setEditName('');
      onDataChanged();
    } catch (error) {
      logger.error('Failed to update group', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteGroup = async (groupId: number) => {
    if (isSubmitting) return;
    if (!confirm('Supprimer ce groupe ? Les éléments seront déplacés vers "Non assignés".')) return;

    setIsSubmitting(true);
    try {
      await deleteGroup(groupId);
      await loadUnassignedItems();
      onDataChanged();
    } catch (error) {
      logger.error('Failed to delete group', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMoveGroup = async (sectionGroups: BudgetGroup[], index: number, direction: 'up' | 'down') => {
    if (isSubmitting) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= sectionGroups.length) return;

    const reordered = [...sectionGroups];
    [reordered[index], reordered[newIndex]] = [reordered[newIndex], reordered[index]];

    const updates = reordered.map((group, idx) => ({
      id: group.id,
      sortOrder: idx,
    }));

    setIsSubmitting(true);
    try {
      await reorderGroups(updates);
      onDataChanged();
    } catch (error) {
      logger.error('Failed to reorder groups', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateItem = async (itemId: number) => {
    if (!editName.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await updateItem(itemId, {
        name: editName.trim(),
        slug: slugify(editName),
      });
      setEditingItem(null);
      setEditName('');
      await loadUnassignedItems();
      onDataChanged();
    } catch (error) {
      logger.error('Failed to update item', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteItem = async (itemId: number) => {
    if (isSubmitting) return;
    if (!confirm('Supprimer cet élément ?')) return;

    setIsSubmitting(true);
    try {
      await deleteItem(itemId);
      await loadUnassignedItems();
      onDataChanged();
    } catch (error) {
      logger.error('Failed to delete item', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Drag and drop handlers
  const handleDragStart = (e: DragEvent, item: { id: number; name: string }, groupId: number | null) => {
    setDraggedItem({ ...item, groupId });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id.toString());
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDropTarget(null);
    setDropTargetItem(null);
  };

  const handleDragOver = (e: DragEvent, target: number | 'unassigned') => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(target);
  };

  const handleDragLeave = () => {
    setDropTarget(null);
  };

  const handleItemDragOver = (e: DragEvent, targetItemId: number, groupId: number | null) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetItem(targetItemId);
    setDropTarget(groupId ?? 'unassigned');
  };

  const handleItemDragLeave = () => {
    setDropTargetItem(null);
  };

  const handleDrop = async (e: DragEvent, targetGroupId: number | null, targetItemId?: number) => {
    e.preventDefault();
    setDropTarget(null);
    setDropTargetItem(null);

    if (!draggedItem || isSubmitting) return;

    const sourceGroupId = draggedItem.groupId;

    // If dropping on the same group, handle reordering
    if (sourceGroupId === targetGroupId && targetItemId !== undefined && targetItemId !== draggedItem.id) {
      // Find the group's items
      let groupItems: BudgetItem[];
      if (targetGroupId === null) {
        groupItems = unassignedItems;
      } else {
        const group = groups.find((g) => g.id === targetGroupId);
        if (!group) return;
        groupItems = group.items;
      }

      const draggedIndex = groupItems.findIndex((item) => item.id === draggedItem.id);
      const targetIndex = groupItems.findIndex((item) => item.id === targetItemId);

      if (draggedIndex === -1 || targetIndex === -1) return;

      // Reorder items
      const reordered = [...groupItems];
      const [removed] = reordered.splice(draggedIndex, 1);
      reordered.splice(targetIndex, 0, removed);

      const updates = reordered.map((item, idx) => ({
        id: item.id,
        sortOrder: idx,
      }));

      setIsSubmitting(true);
      try {
        await reorderItems(updates);
        if (targetGroupId === null) {
          await loadUnassignedItems();
        }
        onDataChanged();
      } catch (error) {
        logger.error('Failed to reorder items', error);
      } finally {
        setIsSubmitting(false);
        setDraggedItem(null);
      }
    } else if (sourceGroupId !== targetGroupId) {
      // Moving to a different group
      setIsSubmitting(true);
      try {
        await moveItem(draggedItem.id, targetGroupId);
        await loadUnassignedItems();
        onDataChanged();
      } catch (error) {
        logger.error('Failed to move item', error);
      } finally {
        setIsSubmitting(false);
        setDraggedItem(null);
      }
    } else {
      setDraggedItem(null);
    }
  };

  const startEditGroup = (group: BudgetGroup) => {
    setEditingGroup(group.id);
    setEditingItem(null);
    setEditName(group.name);
    setAddingGroupTo(null);
    setAddingItemTo(null);
  };

  const startEditItem = (item: { id: number; name: string }) => {
    setEditingItem(item.id);
    setEditingGroup(null);
    setEditName(item.name);
    setAddingGroupTo(null);
    setAddingItemTo(null);
  };

  const cancelEdit = () => {
    setEditingGroup(null);
    setEditingItem(null);
    setEditName('');
  };

  const startAddGroup = (type: 'income' | 'expense' | 'savings') => {
    setAddingGroupTo(type);
    setNewGroupName('');
    setAddingItemTo(null);
    cancelEdit();
  };

  const cancelAddGroup = () => {
    setAddingGroupTo(null);
    setNewGroupName('');
  };

  const startAddItem = (groupId: number) => {
    setAddingItemTo(groupId);
    setNewItemName('');
    setAddingGroupTo(null);
    cancelEdit();
  };

  const cancelAddItem = () => {
    setAddingItemTo(null);
    setNewItemName('');
  };

  const handleMoveItem = async (groupItems: BudgetItem[], index: number, direction: 'up' | 'down') => {
    if (isSubmitting) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= groupItems.length) return;

    const reordered = [...groupItems];
    [reordered[index], reordered[newIndex]] = [reordered[newIndex], reordered[index]];

    const updates = reordered.map((item, idx) => ({
      id: item.id,
      sortOrder: idx,
    }));

    setIsSubmitting(true);
    try {
      await reorderItems(updates);
      onDataChanged();
    } catch (error) {
      logger.error('Failed to reorder items', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderItem = (
    item: { id: number; name: string; slug: string },
    groupItems: BudgetItem[],
    itemIndex: number,
    groupId: number | null
  ) => (
    <div
      key={item.id}
      className={`item-row ${draggedItem?.id === item.id ? 'dragging' : ''} ${dropTargetItem === item.id ? 'drop-target-item' : ''}`}
      draggable
      onDragStart={(e) => handleDragStart(e, item, groupId)}
      onDragEnd={handleDragEnd}
      onDragOver={(e) => handleItemDragOver(e, item.id, groupId)}
      onDragLeave={handleItemDragLeave}
      onDrop={(e) => handleDrop(e, groupId, item.id)}
    >
      {editingItem === item.id ? (
        <div className="edit-form">
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleUpdateItem(item.id);
              if (e.key === 'Escape') cancelEdit();
            }}
          />
          <button className="btn-icon save" onClick={() => handleUpdateItem(item.id)} title="Sauvegarder">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
          <button className="btn-icon cancel" onClick={cancelEdit} title="Annuler">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ) : (
        <>
          <div className="item-reorder">
            <button
              className="btn-icon reorder"
              onClick={() => handleMoveItem(groupItems, itemIndex, 'up')}
              disabled={itemIndex === 0 || isSubmitting}
              title="Monter"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 15l-6-6-6 6" />
              </svg>
            </button>
            <button
              className="btn-icon reorder"
              onClick={() => handleMoveItem(groupItems, itemIndex, 'down')}
              disabled={itemIndex === groupItems.length - 1 || isSubmitting}
              title="Descendre"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </div>
          <div className="item-drag-handle">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="6" r="2" />
              <circle cx="15" cy="6" r="2" />
              <circle cx="9" cy="12" r="2" />
              <circle cx="15" cy="12" r="2" />
              <circle cx="9" cy="18" r="2" />
              <circle cx="15" cy="18" r="2" />
            </svg>
          </div>
          <span className="item-name">{item.name}</span>
          <div className="item-actions">
            <button className="btn-icon edit" onClick={() => startEditItem(item)} title="Modifier">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
            <button className="btn-icon delete" onClick={() => handleDeleteItem(item.id)} title="Supprimer">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  );

  const renderGroupSection = (title: string, sectionGroups: BudgetGroup[], type: 'income' | 'expense' | 'savings') => (
    <div className={`settings-section ${type}`}>
      <div className="section-header">
        <h3 className="section-title">
          <span className={`section-indicator ${type}`}></span>
          {title}
        </h3>
        <button className="btn-icon-add" onClick={() => startAddGroup(type)} title="Ajouter un groupe">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* Add group inline form */}
      {addingGroupTo === type && (
        <div className="inline-add-form group-add-form">
          <input
            type="text"
            placeholder="Nom du groupe..."
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newGroupName.trim()) handleCreateGroup(type);
              if (e.key === 'Escape') cancelAddGroup();
            }}
          />
          <button
            className="btn-icon save"
            onClick={() => handleCreateGroup(type)}
            disabled={!newGroupName.trim() || isSubmitting}
            title="Ajouter"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
          <button className="btn-icon cancel" onClick={cancelAddGroup} title="Annuler">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      <div className="groups-list">
        {sectionGroups.length === 0 && addingGroupTo !== type && <p className="empty-message">Aucun groupe créé</p>}
        {sectionGroups.map((group, index) => (
          <div
            key={group.id}
            className={`group-card ${dropTarget === group.id ? 'drop-target' : ''}`}
            onDragOver={(e) => handleDragOver(e, group.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, group.id)}
          >
            <div className="group-header">
              {editingGroup === group.id ? (
                <div className="edit-form">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleUpdateGroup(group.id);
                      if (e.key === 'Escape') cancelEdit();
                    }}
                  />
                  <button className="btn-icon save" onClick={() => handleUpdateGroup(group.id)} title="Sauvegarder">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                  <button className="btn-icon cancel" onClick={cancelEdit} title="Annuler">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ) : (
                <>
                  <div className="group-reorder">
                    <button
                      className="btn-icon reorder"
                      onClick={() => handleMoveGroup(sectionGroups, index, 'up')}
                      disabled={index === 0 || isSubmitting}
                      title="Monter"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 15l-6-6-6 6" />
                      </svg>
                    </button>
                    <button
                      className="btn-icon reorder"
                      onClick={() => handleMoveGroup(sectionGroups, index, 'down')}
                      disabled={index === sectionGroups.length - 1 || isSubmitting}
                      title="Descendre"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                  </div>
                  <span className="group-name">{group.name}</span>
                  <div className="group-actions">
                    <button className="btn-icon add" onClick={() => startAddItem(group.id)} title="Ajouter un élément">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </button>
                    <button className="btn-icon edit" onClick={() => startEditGroup(group)} title="Modifier">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button className="btn-icon delete" onClick={() => handleDeleteGroup(group.id)} title="Supprimer">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="items-list">
              {group.items.length === 0 && addingItemTo !== group.id && (
                <p className="empty-items drop-hint">Glissez des éléments ici</p>
              )}
              {group.items.map((item, itemIndex) => renderItem(item, group.items, itemIndex, group.id))}

              {/* Add item inline form */}
              {addingItemTo === group.id && (
                <div className="inline-add-form">
                  <input
                    type="text"
                    placeholder="Nom de l'élément..."
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newItemName.trim()) handleCreateItem(group.id);
                      if (e.key === 'Escape') cancelAddItem();
                    }}
                  />
                  <button
                    className="btn-icon save"
                    onClick={() => handleCreateItem(group.id)}
                    disabled={!newItemName.trim() || isSubmitting}
                    title="Ajouter"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                  <button className="btn-icon cancel" onClick={cancelAddItem} title="Annuler">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderCategoriesTab = () => (
    <>
      {/* Groups and Items List */}
      <div className="settings-grid">
        {renderGroupSection('Revenus', incomeGroups, 'income')}
        {renderGroupSection('Dépenses', expenseGroups, 'expense')}
        {renderGroupSection('Épargne', savingsGroups, 'savings')}
      </div>

      {/* Unassigned Items */}
      {unassignedItems.length > 0 && (
        <div
          className={`unassigned-section ${dropTarget === 'unassigned' ? 'drop-target' : ''}`}
          onDragOver={(e) => handleDragOver(e, 'unassigned')}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, null)}
        >
          <h3 className="section-title">
            <span className="section-indicator unassigned"></span>
            Éléments non assignés
            <span className="item-count">{unassignedItems.length}</span>
          </h3>
          <div className="unassigned-items">
            {unassignedItems.map((item, itemIndex) => renderItem(item, unassignedItems, itemIndex, null))}
          </div>
        </div>
      )}
    </>
  );

  const renderAccountsTab = () => (
    <div className="payment-methods-section">
      <h3 className="section-title">
        <span className="section-indicator payment"></span>
        Moyens de paiement
      </h3>

      <div className="payment-methods-list">
        {paymentMethods.length === 0 ? (
          <p className="empty-message">Aucun moyen de paiement créé</p>
        ) : (
          paymentMethods.map((method, index) => (
            <div key={method.id} className="payment-method-item">
              {editingPaymentMethod === method.id ? (
                <div className="edit-form payment-method-edit-form">
                  <div className="edit-field-group name-field">
                    <label className="edit-field-label">Nom</label>
                    <input
                      type="text"
                      value={editPaymentMethodName}
                      onChange={(e) => setEditPaymentMethodName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleUpdatePaymentMethod(method.id);
                        if (e.key === 'Escape') cancelEditPaymentMethod();
                      }}
                      placeholder="Nom"
                    />
                  </div>
                  <div className="edit-field-group">
                    <label className="edit-field-label">Clôture</label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={editSettlementDay}
                      onChange={(e) => setEditSettlementDay(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleUpdatePaymentMethod(method.id);
                        if (e.key === 'Escape') cancelEditPaymentMethod();
                      }}
                      placeholder="—"
                      className="settlement-day-input"
                      title="Jour de clôture du cycle de facturation (1-31). Ex: 18 = les transactions du 18 au 17 sont comptabilisées le mois suivant."
                    />
                  </div>
                  <div className="edit-field-group">
                    <label className="edit-field-label">Compte lié</label>
                    <select
                      value={editLinkedPaymentMethodId || ''}
                      onChange={(e) => setEditLinkedPaymentMethodId(e.target.value ? Number(e.target.value) : null)}
                      className="linked-account-select"
                      title="Compte dont le solde sera affecté par les transactions avec ce mode de paiement"
                    >
                      <option value="">Aucun</option>
                      {accountPaymentMethods
                        .filter((pm) => pm.id !== method.id)
                        .map((pm) => (
                          <option key={pm.id} value={pm.id}>
                            {pm.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="edit-actions">
                    <button
                      className="btn-icon save"
                      onClick={() => handleUpdatePaymentMethod(method.id)}
                      title="Sauvegarder"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                    <button className="btn-icon cancel" onClick={cancelEditPaymentMethod} title="Annuler">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="payment-method-reorder">
                    <button
                      className="btn-icon reorder"
                      onClick={() => handleMovePaymentMethod(index, 'up')}
                      disabled={index === 0 || isSubmitting}
                      title="Monter"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 15l-6-6-6 6" />
                      </svg>
                    </button>
                    <button
                      className="btn-icon reorder"
                      onClick={() => handleMovePaymentMethod(index, 'down')}
                      disabled={index === paymentMethods.length - 1 || isSubmitting}
                      title="Descendre"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                  </div>
                  <span className="payment-method-name">
                    {method.name}
                    {method.settlementDay && (
                      <span className="settlement-day-badge" title={`Clôture le ${method.settlementDay} du mois`}>
                        J{method.settlementDay}
                      </span>
                    )}
                    {method.linkedPaymentMethodId && (
                      <span
                        className="linked-account-badge"
                        title={`Lié à : ${paymentMethods.find((pm) => pm.id === method.linkedPaymentMethodId)?.name || 'Inconnu'}`}
                      >
                        → {paymentMethods.find((pm) => pm.id === method.linkedPaymentMethodId)?.name || '?'}
                      </span>
                    )}
                  </span>
                  <label className="account-toggle" title="Activer comme compte">
                    <input
                      type="checkbox"
                      checked={method.isAccount}
                      onChange={() => handleTogglePaymentMethodAccount(method.id, method.isAccount)}
                      disabled={isSubmitting}
                    />
                    <span className="toggle-slider"></span>
                    <span className="toggle-label">Compte</span>
                  </label>
                  <div className="payment-method-actions">
                    <button className="btn-icon edit" onClick={() => startEditPaymentMethod(method)} title="Modifier">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button
                      className="btn-icon delete"
                      onClick={() => handleDeletePaymentMethod(method.id)}
                      title="Supprimer"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleCreatePaymentMethod} className="create-form payment-method-form">
        <div className="form-row">
          <input
            type="text"
            placeholder="Ajouter un moyen de paiement..."
            value={newPaymentMethod}
            onChange={(e) => setNewPaymentMethod(e.target.value)}
            className="form-input"
          />
          <button type="submit" className="btn-primary" disabled={!newPaymentMethod.trim() || isSubmitting}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Ajouter
          </button>
        </div>
      </form>
    </div>
  );

  const renderPreferencesTab = () => (
    <div className="appearance-section">
      <h3 className="section-title">
        <span className="section-indicator appearance"></span>
        Apparence
      </h3>
      <div className="appearance-options">
        <div className="setting-row">
          <span className="setting-label">Thème</span>
          <div className="setting-buttons">
            <button
              type="button"
              className={`setting-btn ${theme === 'dark' ? 'active' : ''}`}
              onClick={theme === 'light' ? toggleTheme : undefined}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
              Sombre
            </button>
            <button
              type="button"
              className={`setting-btn ${theme === 'light' ? 'active' : ''}`}
              onClick={theme === 'dark' ? toggleTheme : undefined}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
              Clair
            </button>
          </div>
        </div>
        <div className="setting-row">
          <span className="setting-label">Séparateur décimal</span>
          <div className="setting-buttons">
            <button
              type="button"
              className={`setting-btn ${decimalSeparator === '.' ? 'active' : ''}`}
              onClick={() => setDecimalSeparator('.')}
            >
              Point (1'234.56)
            </button>
            <button
              type="button"
              className={`setting-btn ${decimalSeparator === ',' ? 'active' : ''}`}
              onClick={() => setDecimalSeparator(',')}
            >
              Virgule (1'234,56)
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="settings-container">
      <div className="settings-header">
        <h2>Paramètres</h2>
        <p>Gérez vos catégories, comptes et préférences</p>
      </div>

      <div className="settings-tabs">
        <button
          type="button"
          className={`settings-tab ${activeTab === 'categories' ? 'active' : ''}`}
          onClick={() => setActiveTab('categories')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          Catégories
        </button>
        <button
          type="button"
          className={`settings-tab ${activeTab === 'accounts' ? 'active' : ''}`}
          onClick={() => setActiveTab('accounts')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
            <line x1="1" y1="10" x2="23" y2="10" />
          </svg>
          Comptes
        </button>
        <button
          type="button"
          className={`settings-tab ${activeTab === 'preferences' ? 'active' : ''}`}
          onClick={() => setActiveTab('preferences')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Préférences
        </button>
      </div>

      <div className="settings-content">
        {activeTab === 'categories' && renderCategoriesTab()}
        {activeTab === 'accounts' && renderAccountsTab()}
        {activeTab === 'preferences' && renderPreferencesTab()}
      </div>
    </div>
  );
}
