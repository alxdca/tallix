export type ReorderEntryType = 'transaction' | 'transfer';

export interface ReorderableEntry {
  id: string;
  type: ReorderEntryType;
  date: string;
  sortPriority: number | null;
}

export interface ReorderPriorityUpdate {
  type: ReorderEntryType;
  id: number;
  sortPriority: number | null;
}

function parseEntryId(entryId: string): number {
  return parseInt(entryId.substring(2), 10);
}

function normalizeSortPriority(sortPriority: number | null): number | null {
  return sortPriority === null || sortPriority === 0 ? null : Math.trunc(sortPriority);
}

function haveSameOrder(entries: ReorderableEntry[], reorderedEntries: ReorderableEntry[]): boolean {
  return entries.every((entry, index) => entry.id === reorderedEntries[index]?.id);
}

function getSameDateEntries(manualEntries: ReorderableEntry[], date: string): ReorderableEntry[] {
  return manualEntries.filter((entry) => entry.date === date);
}

function moveSelectedEntries(
  entries: ReorderableEntry[],
  selectedIds: Set<string>,
  direction: 'up' | 'down' | 'top' | 'bottom'
): ReorderableEntry[] {
  const reordered = [...entries];

  if (direction === 'top') {
    return [
      ...reordered.filter((entry) => selectedIds.has(entry.id)),
      ...reordered.filter((entry) => !selectedIds.has(entry.id)),
    ];
  }

  if (direction === 'bottom') {
    return [
      ...reordered.filter((entry) => !selectedIds.has(entry.id)),
      ...reordered.filter((entry) => selectedIds.has(entry.id)),
    ];
  }

  if (direction === 'up') {
    for (let index = 1; index < reordered.length; index += 1) {
      if (selectedIds.has(reordered[index].id) && !selectedIds.has(reordered[index - 1].id)) {
        [reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]];
      }
    }
    return reordered;
  }

  for (let index = reordered.length - 2; index >= 0; index -= 1) {
    if (selectedIds.has(reordered[index].id) && !selectedIds.has(reordered[index + 1].id)) {
      [reordered[index], reordered[index + 1]] = [reordered[index + 1], reordered[index]];
    }
  }

  return reordered;
}

function buildNormalizedPriorityUpdates(
  originalEntries: ReorderableEntry[],
  reorderedEntries: ReorderableEntry[]
): ReorderPriorityUpdate[] {
  const nextPriorityById = new Map(
    reorderedEntries.map((entry, index) => [entry.id, reorderedEntries.length - index] as const)
  );

  return originalEntries.flatMap((entry) => {
    const nextSortPriority = nextPriorityById.get(entry.id);
    if (nextSortPriority === undefined || normalizeSortPriority(entry.sortPriority) === nextSortPriority) {
      return [];
    }

    return [
      {
        type: entry.type,
        id: parseEntryId(entry.id),
        sortPriority: nextSortPriority,
      } satisfies ReorderPriorityUpdate,
    ];
  });
}

export function getSelectedReorderEntries(
  manualEntries: ReorderableEntry[],
  selectedIds: Set<string>
): ReorderableEntry[] {
  return manualEntries.filter((entry) => selectedIds.has(entry.id));
}

export function canReorderSelectedEntries(
  manualEntries: ReorderableEntry[],
  selectedIds: Set<string>,
  canReorderRows: boolean
): boolean {
  if (!canReorderRows || selectedIds.size === 0) {
    return false;
  }

  const selectedEntries = getSelectedReorderEntries(manualEntries, selectedIds);
  if (selectedEntries.length !== selectedIds.size) {
    return false;
  }

  return new Set(selectedEntries.map((entry) => entry.date)).size === 1;
}

export function buildSelectionReorderUpdates(
  manualEntries: ReorderableEntry[],
  selectedIds: Set<string>,
  direction: 'up' | 'down' | 'top' | 'bottom'
): ReorderPriorityUpdate[] {
  const selectedEntries = getSelectedReorderEntries(manualEntries, selectedIds);
  if (selectedEntries.length === 0) {
    return [];
  }

  const selectedDates = new Set(selectedEntries.map((entry) => entry.date));
  if (selectedDates.size !== 1) {
    return [];
  }

  const [targetDate] = [...selectedDates];
  const sameDateEntries = getSameDateEntries(manualEntries, targetDate);
  const reorderedEntries = moveSelectedEntries(sameDateEntries, selectedIds, direction);

  if (haveSameOrder(sameDateEntries, reorderedEntries)) {
    return [];
  }

  return buildNormalizedPriorityUpdates(sameDateEntries, reorderedEntries);
}

export function buildSingleReorderUpdates(
  manualEntries: ReorderableEntry[],
  entry: ReorderableEntry,
  direction: 'up' | 'down'
): ReorderPriorityUpdate[] {
  return buildSelectionReorderUpdates(manualEntries, new Set([entry.id]), direction);
}
