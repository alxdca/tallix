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
  moveItem,
  type PaymentMethod,
  reorderGroups,
  reorderItems,
  reorderPaymentMethods,
  type SavingsType,
  togglePaymentMethodSavings,
  updateGroup,
  updateItem,
  updatePaymentMethod,
} from '../api';
import { useI18n } from '../contexts/I18nContext';
import { useSettings } from '../contexts/SettingsContext';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import type { BudgetGroup, BudgetItem } from '../types';
import { getErrorMessage } from '../utils/errorMessages';
import { logger } from '../utils/logger';
import ConfirmDialog from './ConfirmDialog';

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
  const { t } = useI18n();
  const { theme, decimalSeparator, showBudgetBelowActual, toggleTheme, setDecimalSeparator, setShowBudgetBelowActual } =
    useSettings();
  const { dialogProps, confirm } = useConfirmDialog();
  const [activeTab, setActiveTab] = useState<SettingsTab>('categories');
  const [editingGroup, setEditingGroup] = useState<number | null>(null);
  const [editingItem, setEditingItem] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draggedItem, setDraggedItem] = useState<{ id: number; name: string; groupId: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [dropTargetItem, setDropTargetItem] = useState<number | null>(null);

  // Inline add states
  const [addingGroupTo, setAddingGroupTo] = useState<'income' | 'expense' | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [addingItemTo, setAddingItemTo] = useState<number | null>(null);
  const [newItemName, setNewItemName] = useState('');

  // Payment methods state
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [newPaymentMethod, setNewPaymentMethod] = useState('');
  const [newPaymentMethodInstitution, setNewPaymentMethodInstitution] = useState('');
  const [editingPaymentMethod, setEditingPaymentMethod] = useState<number | null>(null);
  const [editPaymentMethodName, setEditPaymentMethodName] = useState('');
  const [editInstitution, setEditInstitution] = useState('');
  const [editSettlementDay, setEditSettlementDay] = useState<string>('');
  const [editLinkedPaymentMethodId, setEditLinkedPaymentMethodId] = useState<number | null>(null);
  const [paymentMethodError, setPaymentMethodError] = useState<string | null>(null);

  // Sort groups by sortOrder within their category
  const incomeGroups = [...groups.filter((g) => g.type === 'income')].sort((a, b) => a.sortOrder - b.sortOrder);
  const expenseGroups = [...groups.filter((g) => g.type === 'expense')].sort((a, b) => a.sortOrder - b.sortOrder);

  const loadPaymentMethods = useCallback(async () => {
    try {
      const methods = await fetchPaymentMethods();
      setPaymentMethods(methods);
    } catch (error) {
      logger.error('Failed to load payment methods', error);
    }
  }, []);

  useEffect(() => {
    loadPaymentMethods();
  }, [loadPaymentMethods]);

  const handleCreatePaymentMethod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPaymentMethod.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setPaymentMethodError(null);
    try {
      await createPaymentMethod({
        name: newPaymentMethod.trim(),
        sortOrder: paymentMethods.length,
        institution: newPaymentMethodInstitution.trim() || undefined,
      });
      setNewPaymentMethod('');
      setNewPaymentMethodInstitution('');
      await loadPaymentMethods();
    } catch (error) {
      logger.error('Failed to create payment method', error);
      setPaymentMethodError(getErrorMessage(error, t));
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
    setPaymentMethodError(null);
    try {
      await updatePaymentMethod(id, {
        name: editPaymentMethodName.trim(),
        institution: editInstitution.trim() || null,
        settlementDay,
        linkedPaymentMethodId: editLinkedPaymentMethodId,
      });
      setEditingPaymentMethod(null);
      setEditPaymentMethodName('');
      setEditInstitution('');
      setEditSettlementDay('');
      setEditLinkedPaymentMethodId(null);
      await loadPaymentMethods();
    } catch (error) {
      logger.error('Failed to update payment method', error);
      setPaymentMethodError(getErrorMessage(error, t));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeletePaymentMethod = async (id: number) => {
    if (isSubmitting) return;

    const confirmed = await confirm({
      title: t('settings.deletePaymentMethodTitle'),
      message: t('settings.confirmDeletePaymentMethod'),
      confirmLabel: t('common.delete'),
      variant: 'danger',
    });
    if (!confirmed) return;

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

  const handleToggleSavingsAccount = async (id: number, currentIsSavings: boolean) => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      await togglePaymentMethodSavings(id, !currentIsSavings);
      await loadPaymentMethods();
      onDataChanged();
    } catch (error) {
      logger.error('Failed to toggle savings account', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChangeSavingsType = async (id: number, savingsType: SavingsType | null) => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      await updatePaymentMethod(id, { savingsType });
      await loadPaymentMethods();
      onDataChanged();
    } catch (error) {
      logger.error('Failed to update savings type', error);
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
    setEditInstitution(method.institution || '');
    setEditSettlementDay(method.settlementDay?.toString() || '');
    setEditLinkedPaymentMethodId(method.linkedPaymentMethodId);
    setEditingGroup(null);
    setEditingItem(null);
  };

  const cancelEditPaymentMethod = () => {
    setEditingPaymentMethod(null);
    setEditPaymentMethodName('');
    setEditInstitution('');
    setEditSettlementDay('');
    setEditLinkedPaymentMethodId(null);
  };

  const handleCreateGroup = async (groupType: 'income' | 'expense') => {
    if (!newGroupName.trim() || isSubmitting) return;

    const sectionGroups = groupType === 'income' ? incomeGroups : expenseGroups;
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

    const confirmed = await confirm({
      title: t('settings.confirmDeleteItemTitle'),
      message: t('settings.confirmDeleteGroup'),
      confirmLabel: t('common.delete'),
      variant: 'danger',
    });
    if (!confirmed) return;

    setIsSubmitting(true);
    try {
      await deleteGroup(groupId);
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
      onDataChanged();
    } catch (error) {
      logger.error('Failed to update item', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteItem = async (itemId: number) => {
    if (isSubmitting) return;

    const confirmed = await confirm({
      title: t('settings.confirmDeleteItemTitle'),
      message: t('settings.confirmDeleteItem'),
      confirmLabel: t('common.delete'),
      variant: 'danger',
    });
    if (!confirmed) return;

    setIsSubmitting(true);
    try {
      await deleteItem(itemId);
      onDataChanged();
    } catch (error) {
      logger.error('Failed to delete item', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Drag and drop handlers
  const handleDragStart = (e: DragEvent, item: { id: number; name: string }, groupId: number) => {
    setDraggedItem({ ...item, groupId });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id.toString());
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDropTarget(null);
    setDropTargetItem(null);
  };

  const handleDragOver = (e: DragEvent, target: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(target);
  };

  const handleDragLeave = () => {
    setDropTarget(null);
  };

  const handleItemDragOver = (e: DragEvent, targetItemId: number, groupId: number) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetItem(targetItemId);
    setDropTarget(groupId);
  };

  const handleItemDragLeave = () => {
    setDropTargetItem(null);
  };

  const handleDrop = async (e: DragEvent, targetGroupId: number, targetItemId?: number) => {
    e.preventDefault();
    setDropTarget(null);
    setDropTargetItem(null);

    if (!draggedItem || isSubmitting) return;

    const sourceGroupId = draggedItem.groupId;

    // If dropping on the same group, handle reordering
    if (sourceGroupId === targetGroupId && targetItemId !== undefined && targetItemId !== draggedItem.id) {
      // Find the group's items
      const group = groups.find((g) => g.id === targetGroupId);
      if (!group) return;
      const groupItems = group.items;

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

  const startAddGroup = (type: 'income' | 'expense') => {
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
    groupId: number,
    isSavingsGroup: boolean = false
  ) => (
    <div
      key={item.id}
      className={`item-row ${draggedItem?.id === item.id ? 'dragging' : ''} ${dropTargetItem === item.id ? 'drop-target-item' : ''}`}
      draggable={!isSavingsGroup}
      onDragStart={(e) => !isSavingsGroup && handleDragStart(e, item, groupId)}
      onDragEnd={handleDragEnd}
      onDragOver={(e) => !isSavingsGroup && handleItemDragOver(e, item.id, groupId)}
      onDragLeave={handleItemDragLeave}
      onDrop={(e) => !isSavingsGroup && handleDrop(e, groupId, item.id)}
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
            // biome-ignore lint/a11y/noAutofocus: intentional UX - focus on edit
            autoFocus
          />
          <button className="btn-icon save" onClick={() => handleUpdateItem(item.id)} title={t('common.save')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
          <button className="btn-icon cancel" onClick={cancelEdit} title={t('common.cancel')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ) : (
        <>
          {/* Hide reorder/edit/delete for savings items - they are auto-managed */}
          {!isSavingsGroup && (
            <>
              <div className="item-reorder">
                <button
                  className="btn-icon reorder"
                  onClick={() => handleMoveItem(groupItems, itemIndex, 'up')}
                  disabled={itemIndex === 0 || isSubmitting}
                  title={t('common.moveUp')}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 15l-6-6-6 6" />
                  </svg>
                </button>
                <button
                  className="btn-icon reorder"
                  onClick={() => handleMoveItem(groupItems, itemIndex, 'down')}
                  disabled={itemIndex === groupItems.length - 1 || isSubmitting}
                  title={t('common.moveDown')}
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
            </>
          )}
          <span className="item-name">{item.name}</span>
          {!isSavingsGroup && (
            <div className="item-actions">
              <button className="btn-icon edit" onClick={() => startEditItem(item)} title={t('common.edit')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
              <button className="btn-icon delete" onClick={() => handleDeleteItem(item.id)} title={t('common.delete')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );

  const renderGroupSection = (title: string, sectionGroups: BudgetGroup[], type: 'income' | 'expense') => (
    <div className={`settings-section ${type}`}>
      <div className="section-header">
        <h3 className="section-title">
          <span className={`section-indicator ${type}`}></span>
          {title}
        </h3>
        <button className="btn-icon-add" onClick={() => startAddGroup(type)} title={t('settings.addGroup')}>
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
            placeholder={t('settings.groupPlaceholder')}
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
            title={t('common.add')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
          <button className="btn-icon cancel" onClick={cancelAddGroup} title={t('common.cancel')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      <div className="groups-list">
        {sectionGroups.length === 0 && addingGroupTo !== type && (
          <p className="empty-message">{t('settings.emptyGroups')}</p>
        )}
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
                    // biome-ignore lint/a11y/noAutofocus: intentional UX - focus on edit
                    autoFocus
                  />
                  <button
                    className="btn-icon save"
                    onClick={() => handleUpdateGroup(group.id)}
                    title={t('common.save')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                  <button className="btn-icon cancel" onClick={cancelEdit} title={t('common.cancel')}>
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
                      title={t('common.moveUp')}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 15l-6-6-6 6" />
                      </svg>
                    </button>
                    <button
                      className="btn-icon reorder"
                      onClick={() => handleMoveGroup(sectionGroups, index, 'down')}
                      disabled={index === sectionGroups.length - 1 || isSubmitting}
                      title={t('common.moveDown')}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                  </div>
                  <span className="group-name">{group.name}</span>
                  <div className="group-actions">
                    {/* Hide Add Item button for savings groups - items are auto-managed from savings accounts */}
                    {group.type !== 'savings' && (
                      <button
                        className="btn-icon add"
                        onClick={() => startAddItem(group.id)}
                        title={t('settings.addItem')}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      </button>
                    )}
                    <button className="btn-icon edit" onClick={() => startEditGroup(group)} title={t('common.edit')}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button
                      className="btn-icon delete"
                      onClick={() => handleDeleteGroup(group.id)}
                      title={t('common.delete')}
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

            <div className="items-list">
              {group.items.length === 0 && addingItemTo !== group.id && (
                <p className="empty-items drop-hint">{t('settings.dropHere')}</p>
              )}
              {group.items.map((item, itemIndex) => renderItem(item, group.items, itemIndex, group.id, group.type === 'savings'))}

              {/* Add item inline form */}
              {addingItemTo === group.id && (
                <div className="inline-add-form">
                  <input
                    type="text"
                    placeholder={t('settings.itemPlaceholder')}
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
                    title={t('common.add')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                  <button className="btn-icon cancel" onClick={cancelAddItem} title={t('common.cancel')}>
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
        {renderGroupSection(t('budget.income'), incomeGroups, 'income')}
        {renderGroupSection(t('budget.expenses'), expenseGroups, 'expense')}
      </div>
    </>
  );

  const renderAccountsTab = () => (
    <div className="payment-methods-section">
      <h3 className="section-title">
        <span className="section-indicator payment"></span>
        {t('settings.paymentMethodsTitle')}
      </h3>

      <div className="payment-methods-list">
        {paymentMethods.length === 0 ? (
          <p className="empty-message">{t('settings.emptyPaymentMethods')}</p>
        ) : (
          paymentMethods.map((method, index) => (
            <div key={method.id} className="payment-method-item">
              {editingPaymentMethod === method.id ? (
                <div className="edit-form payment-method-edit-form">
                  <div className="edit-field-group name-field">
                    <label className="edit-field-label">{t('settings.nameLabel')}</label>
                    <input
                      type="text"
                      value={editPaymentMethodName}
                      onChange={(e) => setEditPaymentMethodName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleUpdatePaymentMethod(method.id);
                        if (e.key === 'Escape') cancelEditPaymentMethod();
                      }}
                      placeholder={t('settings.nameLabel')}
                      // biome-ignore lint/a11y/noAutofocus: intentional UX - focus on edit
                      autoFocus
                    />
                  </div>
                  <div className="edit-field-group institution-field">
                    <label className="edit-field-label">{t('settings.institutionLabel')}</label>
                    <input
                      type="text"
                      value={editInstitution}
                      onChange={(e) => setEditInstitution(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleUpdatePaymentMethod(method.id);
                        if (e.key === 'Escape') cancelEditPaymentMethod();
                      }}
                      placeholder={t('settings.institutionPlaceholder')}
                    />
                  </div>
                  <div className="edit-field-group">
                    <label className="edit-field-label">{t('settings.settlementDay')}</label>
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
                      title={t('settings.settlementDayHelp')}
                    />
                  </div>
                  <div className="edit-field-group">
                    <label className="edit-field-label">{t('settings.linkedAccount')}</label>
                    <select
                      value={editLinkedPaymentMethodId || ''}
                      onChange={(e) => setEditLinkedPaymentMethodId(e.target.value ? Number(e.target.value) : null)}
                      className="linked-account-select"
                      title={t('settings.linkedAccountHelp')}
                    >
                      <option value="">{t('settings.linkedAccountNone')}</option>
                      {paymentMethods
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
                      title={t('common.save')}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                    <button className="btn-icon cancel" onClick={cancelEditPaymentMethod} title={t('common.cancel')}>
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
                      title={t('common.moveUp')}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 15l-6-6-6 6" />
                      </svg>
                    </button>
                    <button
                      className="btn-icon reorder"
                      onClick={() => handleMovePaymentMethod(index, 'down')}
                      disabled={index === paymentMethods.length - 1 || isSubmitting}
                      title={t('common.moveDown')}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                  </div>
                  <span className="payment-method-name">
                    {method.name}
                    {method.institution && (
                      <span
                        className="institution-badge"
                        title={`${t('settings.institutionLabel')}: ${method.institution}`}
                      >
                        {method.institution}
                      </span>
                    )}
                    {method.settlementDay && (
                      <span
                        className="settlement-day-badge"
                        title={t('settings.settlementBadge', { day: method.settlementDay })}
                      >
                        J{method.settlementDay}
                      </span>
                    )}
                    {method.linkedPaymentMethodId && (
                      <span
                        className="linked-account-badge"
                        title={t('settings.linkedTo', {
                          name:
                            paymentMethods.find((pm) => pm.id === method.linkedPaymentMethodId)?.name ||
                            t('settings.linkedUnknown'),
                        })}
                      >
                        → {paymentMethods.find((pm) => pm.id === method.linkedPaymentMethodId)?.name || '?'}
                      </span>
                    )}
                  </span>
                  <label className="account-toggle" title={t('settings.activateSavings')}>
                    <input
                      type="checkbox"
                      checked={method.isSavingsAccount}
                      onChange={() => handleToggleSavingsAccount(method.id, method.isSavingsAccount)}
                      disabled={isSubmitting}
                    />
                    <span className="toggle-slider"></span>
                    <span className="toggle-label">{t('settings.savingsLabel')}</span>
                  </label>
                  <select
                    className="savings-type-select"
                    value={method.savingsType || ''}
                    onChange={(e) => handleChangeSavingsType(method.id, (e.target.value || null) as SavingsType | null)}
                    disabled={isSubmitting || !method.isSavingsAccount}
                  >
                    <option value="">{t('settings.savingsTypePlaceholder')}</option>
                    <option value="epargne">{t('settings.savingsType.epargne')}</option>
                    <option value="prevoyance">{t('settings.savingsType.prevoyance')}</option>
                    <option value="investissements">{t('settings.savingsType.investissements')}</option>
                  </select>
                  <div className="payment-method-actions">
                    <button
                      className="btn-icon edit"
                      onClick={() => startEditPaymentMethod(method)}
                      title={t('common.edit')}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button
                      className="btn-icon delete"
                      onClick={() => handleDeletePaymentMethod(method.id)}
                      title={t('common.delete')}
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
            placeholder={t('settings.paymentMethodNamePlaceholder')}
            value={newPaymentMethod}
            onChange={(e) => {
              setNewPaymentMethod(e.target.value);
              setPaymentMethodError(null);
            }}
            className="form-input"
          />
          <input
            type="text"
            placeholder={t('settings.institutionOptionalPlaceholder')}
            value={newPaymentMethodInstitution}
            onChange={(e) => {
              setNewPaymentMethodInstitution(e.target.value);
              setPaymentMethodError(null);
            }}
            className="form-input institution-input"
          />
          <button type="submit" className="btn-primary" disabled={!newPaymentMethod.trim() || isSubmitting}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t('common.add')}
          </button>
        </div>
        {paymentMethodError && <div className="form-error">{paymentMethodError}</div>}
      </form>
    </div>
  );

  const renderPreferencesTab = () => (
    <div className="appearance-section">
      <h3 className="section-title">
        <span className="section-indicator appearance"></span>
        {t('settings.appearance')}
      </h3>
      <div className="appearance-options">
        <div className="setting-row">
          <span className="setting-label">{t('settings.theme')}</span>
          <div className="setting-buttons">
            <button
              type="button"
              className={`setting-btn ${theme === 'dark' ? 'active' : ''}`}
              onClick={theme === 'light' ? toggleTheme : undefined}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
              {t('settings.themeDark')}
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
              {t('settings.themeLight')}
            </button>
          </div>
        </div>
        <div className="setting-row">
          <span className="setting-label">{t('settings.decimalSeparator')}</span>
          <div className="setting-buttons">
            <button
              type="button"
              className={`setting-btn ${decimalSeparator === '.' ? 'active' : ''}`}
              onClick={() => setDecimalSeparator('.')}
            >
              {t('settings.decimalPoint')}
            </button>
            <button
              type="button"
              className={`setting-btn ${decimalSeparator === ',' ? 'active' : ''}`}
              onClick={() => setDecimalSeparator(',')}
            >
              {t('settings.decimalComma')}
            </button>
          </div>
        </div>
        <div className="setting-row">
          <span className="setting-label">{t('settings.showBudgetBelowActual')}</span>
          <label className="setting-toggle">
            <input
              type="checkbox"
              checked={showBudgetBelowActual}
              onChange={(e) => setShowBudgetBelowActual(e.target.checked)}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>
      </div>
    </div>
  );

  return (
    <div className="settings-container">
      <div className="settings-header">
        <h2>{t('settings.title')}</h2>
        <p>{t('settings.subtitle')}</p>
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
          {t('settings.categories')}
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
          {t('settings.paymentMethodsTitle')}
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
          {t('settings.preferences')}
        </button>
      </div>

      <div className="settings-content">
        {activeTab === 'categories' && renderCategoriesTab()}
        {activeTab === 'accounts' && renderAccountsTab()}
        {activeTab === 'preferences' && renderPreferencesTab()}
      </div>

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
