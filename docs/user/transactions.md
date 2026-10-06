# Transactions

This section covers manual entry, bulk actions, and duplicate warnings.

## Add a transaction

1. Click the add button in the Transactions view.
2. Provide date, amount, payment method, and optional category and third party.
3. Save to add it to the current year.

## Edit or delete

- Click a row to edit the transaction details.
- Use the delete action for single rows or use bulk selection for multiple rows.

## Accounting month and year

Tallix tracks both the transaction date and the accounting period. This helps when card statements are billed in a later month.

- If you set a settlement day on a payment method, the accounting month and year can be calculated automatically.
- You can also override the accounting period manually.

## Duplicate warnings

When adding a transaction, Tallix checks for potential duplicates:

- Same third party
- Amount within +/- 5 percent
- Date within +/- 1 day

Potential duplicates are highlighted with a warning background. You can dismiss the warning if the transaction is valid.

## Transfers

Transfers represent money moved between accounts and do not affect budget categories. Keep them separate from standard transactions to avoid inflating expenses or income.

Transfers have one accounting period per side. The source side uses the source payment method settlement day, and the destination side uses the destination payment method settlement day. For example, a card top-up into Revolut can debit the card in September while crediting Revolut in August.

When you edit an existing transfer, you can override the source and destination accounting periods separately. Older transfers and older backups that only have one accounting period keep using that same period for both sides until you edit them.

## Tips

- Use third party names consistently for better search and duplicate detection.
- Use bulk delete to clean up imported data quickly.
