interface CategoryUsage {
  id: number;
  itemId: number | null;
  date: string;
}

export function getRecentlyUsedCategories<T extends { id: number }>(
  categories: readonly T[],
  transactions: readonly CategoryUsage[],
  limit = 5
): T[] {
  if (limit <= 0) {
    return [];
  }

  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const seenCategoryIds = new Set<number>();
  const recentCategories: T[] = [];

  const latestTransactions = [...transactions].sort((a, b) => b.id - a.id);

  for (const transaction of latestTransactions) {
    if (transaction.itemId === null || seenCategoryIds.has(transaction.itemId)) {
      continue;
    }

    const category = categoriesById.get(transaction.itemId);
    if (!category) {
      continue;
    }

    seenCategoryIds.add(transaction.itemId);
    recentCategories.push(category);
    if (recentCategories.length === limit) {
      break;
    }
  }

  return recentCategories;
}
