/**
 * Migration script to link existing savings budget items to their corresponding savings accounts
 * This script should be run once to fix historical data where savingsAccountId was null
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { budgetItems, budgetGroups, paymentMethods, budgets } from '../db/schema.js';
import { eq, and, isNull, or, sql } from 'drizzle-orm';
import * as schema from '../db/schema.js';

// Use superuser connection for migration
const connectionString = process.env.DATABASE_URL || 
  `postgresql://${process.env.POSTGRES_USER || 'tallix'}:${process.env.POSTGRES_PASSWORD || 'tallix_secret'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'tallix'}`;

const client = postgres(connectionString);
const db = drizzle(client, { schema });

async function linkSavingsItemsForTenant(userId: string, budgetId: number) {
  console.log(`\n=== Processing Budget ID ${budgetId} for User ${userId} ===\n`);

  return await db.transaction(async (tx) => {
    // Set RLS context
    await tx.execute(sql.raw(`SET LOCAL app.user_id = '${userId}'`));
    await tx.execute(sql.raw(`SET LOCAL app.budget_id = ${budgetId}`));

    // Get all savings groups
    const savingsGroups = await tx.query.budgetGroups.findMany({
      where: eq(budgetGroups.type, 'savings'),
    });

    if (savingsGroups.length === 0) {
      console.log('No savings groups found for this budget');
      return { updated: 0, remaining: 0 };
    }

    console.log(`Found ${savingsGroups.length} savings group(s)`);
    const savingsGroupIds = savingsGroups.map(g => g.id);

    // Get all savings items with null savingsAccountId
    const itemsToFix = await tx.query.budgetItems.findMany({
      where: and(
        or(...savingsGroupIds.map(id => eq(budgetItems.groupId, id))),
        isNull(budgetItems.savingsAccountId)
      ),
      with: {
        group: true,
      },
    });

    console.log(`\nFound ${itemsToFix.length} savings items with null savingsAccountId:\n`);

    if (itemsToFix.length === 0) {
      console.log('✅ All savings items already have a savingsAccountId');
      return { updated: 0, remaining: 0 };
    }

    // Get all savings accounts
    const savingsAccounts = await tx.query.paymentMethods.findMany({
      where: eq(paymentMethods.isSavingsAccount, true),
    });

    console.log(`Found ${savingsAccounts.length} savings accounts\n`);

    // Display items that need fixing
    for (const item of itemsToFix) {
      console.log(`- Item ID ${item.id}: "${item.name}" (Group: ${item.group?.name})`);
    }

    // Try to match items to accounts by name similarity
    const updates: Array<{ itemId: number; accountId: number; itemName: string; accountName: string }> = [];

    for (const item of itemsToFix) {
      // Try to find matching account by name
      const matchedAccount = savingsAccounts.find(account => {
        const itemNameLower = item.name.toLowerCase();
        const accountNameLower = account.name.toLowerCase();
        const institutionLower = account.institution?.toLowerCase() || '';
        
        // Check if item name contains account name or institution
        return itemNameLower.includes(accountNameLower) || 
               itemNameLower.includes(institutionLower) ||
               (account.institution && itemNameLower.includes(account.institution.toLowerCase()));
      });

      if (matchedAccount) {
        updates.push({
          itemId: item.id,
          accountId: matchedAccount.id,
          itemName: item.name,
          accountName: `${matchedAccount.name}${matchedAccount.institution ? ` (${matchedAccount.institution})` : ''}`,
        });
      } else {
        console.log(`\n⚠️  Could not auto-match item: "${item.name}"`);
        console.log('   Available accounts:');
        for (const account of savingsAccounts) {
          console.log(`     - ID ${account.id}: ${account.name}${account.institution ? ` (${account.institution})` : ''}`);
        }
      }
    }

    console.log(`\n\n=== Proposed Updates (${updates.length} matches) ===\n`);
    for (const update of updates) {
      console.log(`Item "${update.itemName}" -> Account "${update.accountName}"`);
    }

    // Apply updates
    console.log('\n\n=== Applying Updates ===\n');
    for (const update of updates) {
      await tx
        .update(budgetItems)
        .set({ savingsAccountId: update.accountId })
        .where(eq(budgetItems.id, update.itemId));
      
      console.log(`✅ Updated item ${update.itemId}: ${update.itemName}`);
    }

    // Check for remaining unmatched items
    const remainingItems = itemsToFix.filter(
      item => !updates.find(u => u.itemId === item.id)
    );

    if (remainingItems.length > 0) {
      console.log(`\n\n⚠️  ${remainingItems.length} items could not be automatically matched:`);
      for (const item of remainingItems) {
        console.log(`   - Item ID ${item.id}: "${item.name}"`);
      }
      console.log('\nThese items will remain with null savingsAccountId and will be filtered out.');
      console.log('You may need to manually update them or delete them if they are no longer needed.');
    } else {
      console.log('\n\n✅ All savings items have been successfully linked!');
    }

    return { updated: updates.length, remaining: remainingItems.length };
  });
}

async function linkSavingsItems() {
  console.log('=== Linking Savings Items to Savings Accounts ===\n');

  // Get all budgets (need superuser to see all)
  const allBudgets = await db.select().from(budgets);
  
  console.log(`Found ${allBudgets.length} budget(s) to process\n`);

  let totalUpdated = 0;
  let totalRemaining = 0;

  for (const budget of allBudgets) {
    const result = await linkSavingsItemsForTenant(budget.userId, budget.id);
    totalUpdated += result.updated;
    totalRemaining += result.remaining;
  }

  console.log(`\n\n=== Summary ===`);
  console.log(`Total items linked: ${totalUpdated}`);
  console.log(`Total items remaining unlinked: ${totalRemaining}`);
}

linkSavingsItems()
  .then(async () => {
    console.log('\n✨ Migration complete');
    await client.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\n❌ Migration failed:', err);
    await client.end();
    process.exit(1);
  });
