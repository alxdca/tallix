# Imports (Spreadsheet, PDF, AI)

Tallix supports multiple import workflows depending on your data source.

## Spreadsheet import

Use the spreadsheet import when you have a CSV or data copied from Excel/Google Sheets.

- Paste data into the import dialog.
- Map columns to fields (date, amount, description, payment method, etc).
- Validate rows and fix any missing fields.
- Import into the selected year.

## PDF import

Use PDF import for bank statement PDFs.

- Upload the PDF.
- The system extracts transactions and attempts to detect the issuer.
- If the issuer is detected, it is applied as the payment method for the entire document.

## AI-powered import (optional)

If AI import is enabled, Tallix can suggest categories and clean descriptions:

- Batch classification for spreadsheet imports.
- Per-document issuer detection for PDF statements.
- Language and country aware formatting.

## Tips

- Verify dates and amounts after import.
- Use the bulk select tools to fix or delete incorrect rows quickly.
