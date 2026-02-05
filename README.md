# Tallix

A personal budgeting application for tracking income, expenses, savings, and account balances.

## Features

- **Budget Management** - Organize finances by year with income, expense, and savings categories
- **Budget Planning** - Plan your annual budget with both monthly recurring amounts and yearly variable budgets
  - Monthly budgets for fixed recurring expenses (rent, subscriptions, etc.)
  - Yearly budgets for irregular/variable spending (vacations, restaurants, leisure)
  - Track remaining budget with color-coded indicators (green > 50%, orange 20-50%, red < 20%)
- **Funds Summary** - View projected and actual funds available at the start and end of each month
  - Based on payment account balances (excludes savings)
  - Accounts for both monthly and yearly budgets in projections
- **Transaction Tracking** - Record transactions with categories, payment methods, and third-party details
- **Account Balances** - Track balances across savings accounts and payment methods
- **Transfers** - Record money transfers between accounts
- **Category Organization** - Drag-and-drop reorder groups/items and move items between groups
- **Payment Method Management** - Add institutions, reorder methods, and manage account/savings flags
- **Savings Accounts** - Mark payment methods as savings and categorize by type (e.g., epargne, prevoyance, investissements)
- **User Preferences** - Theme toggle, decimal separator, and budget display options
- **Spreadsheet Import** - Paste data from Excel/Sheets with configurable column mapping
- **PDF Import** - Import transactions from bank statement PDFs with optional category suggestions
- **AI-Powered Import (optional)** - DeepSeek LLM integration for intelligent transaction processing:
  - **PDF Smart Import** - Extracts transactions from raw PDF text with automatic issuer detection (identifies bank/card from document header/footer and applies to all transactions)
  - **Batch Classification** - Classifies multiple transactions in parallel (categories, descriptions, third parties, and payment methods per transaction)
  - **Language & Context Aware** - Uses user's language and country for accurate merchant and category detection
  - **Parallel Processing** - Processes up to 6 batches concurrently for fast classification of large imports
- **Multi-user Authentication** - Email/password auth, per-user profile (name, language, country), settings, and payment methods (JWT-protected APIs)
- **Settlement Days** - Configure payment method billing cycles to auto-calculate accounting month/year
- **Linked Accounts** - Link payment methods to their funding accounts so balances roll up correctly

## AI-Powered Transaction Processing

The application includes optional AI-powered features using DeepSeek's LLM for intelligent transaction processing. Two workflows are available depending on your import source:

### PDF Smart Import

Optimized for bank statement PDFs where all transactions share the same payment method:

1. **Document Analysis** - Extracts raw text from PDF
2. **Issuer Detection** - Identifies the bank/card issuer from document headers/footers (e.g., "Cembra", "UBS")
3. **Payment Method Matching** - Matches issuer to your payment methods by name and institution
4. **Transaction Extraction** - Extracts date, amount, merchant, and description for all transactions
5. **Category Classification** - Suggests categories based on merchant type and your existing budget structure

**Result**: All transactions automatically get the detected payment method applied. One detection covers the entire document.

### Batch Classification

For spreadsheet imports or reclassifying existing transactions where each transaction may have a different payment method:

- **Processes 25 transactions per batch** with up to 6 batches running in parallel
- **Classifies per transaction**:
  - Category (based on merchant and your budget structure)
  - Payment method (matched from `rawPaymentMethod` column data)
  - Description (cleaned and formatted in your language)
  - Third party (merchant name extraction)
- **Uses context**:
  - Known third parties for consistency
  - User's language for description formatting
  - User's country for merchant identification

**Result**: Each transaction gets individually matched payment method, perfect for mixed spreadsheet data.

### Configuration

Set `DEEPSEEK_API_KEY` in `backend/.env` to enable AI features. Optional settings:
- `DEEPSEEK_API_URL` - Custom API endpoint (default: https://api.deepseek.com/v1)
- `LOG_LEVEL` - Set to `debug` for detailed LLM request/response logging

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Backend**: Express.js, TypeScript, Pino (logging)
- **Database**: PostgreSQL 16, Drizzle ORM
- **AI**: DeepSeek LLM (optional, for smart import)
- **Package Manager**: pnpm (workspaces)

## Prerequisites

- Node.js 20+
- pnpm 9+
- Docker (for PostgreSQL)

## Getting Started

### 1. Clone and install dependencies

```bash
git clone <repository-url>
cd tallix
pnpm install
```

### 2. Start the database

```bash
docker-compose up -d
```

### 3. Configure environment

Create `backend/.env`:

```env
NODE_ENV=development
DATABASE_URL=postgresql://tallix:tallix_secret@localhost:5432/tallix
JWT_SECRET=dev-secret-change-in-production
CORS_ORIGIN=http://localhost:5173
DEEPSEEK_API_KEY=your_key_here
# Optional overrides
DEEPSEEK_API_URL=https://api.deepseek.com/v1
LOG_LEVEL=info
DEBUG_LOG_BODY=false
```

### 4. Run database migrations

```bash
cd backend
pnpm db:push
```

### 5. Start development servers

```bash
# From root directory - starts both frontend and backend
pnpm dev

# Or separately:
pnpm backend   # Backend only (port 3000)
pnpm frontend  # Frontend only (port 5173)
```

## Project Structure

```
tallix/
├── backend/
│   ├── drizzle/          # Database migrations
│   ├── scripts/          # Guard scripts (RLS enforcement)
│   ├── src/
│   │   ├── db/           # Database schema and connection
│   │   ├── middleware/   # Express middleware (error handling)
│   │   ├── routes/       # API route handlers
│   │   ├── services/     # Business logic
│   │   └── types/        # Shared TypeScript types
│   ├── tests/            # Test files
│   └── drizzle.config.ts
├── docs/                 # 📚 Documentation
│   └── rls/             # Row-Level Security documentation
├── frontend/
│   ├── public/           # Static assets
│   └── src/
│       ├── components/   # React components
│       ├── styles/       # CSS
│       ├── api.ts        # API client
│       └── types.ts      # TypeScript types
├── docker-compose.yml
└── pnpm-workspace.yaml
```

## Documentation

Comprehensive documentation is available in the [`docs/`](docs/) directory:

### 🔒 Security & RLS (Row-Level Security)

The application implements a multi-tenant security architecture with Row-Level Security:

- **[RLS Enforcement Guide](docs/rls/RLS_ENFORCEMENT_GUIDE.md)** - Developer guide for working with RLS
- **[RLS Implementation](docs/rls/RLS_IMPLEMENTATION.md)** - Architecture and technical details

**Key Security Features**:
- 4-layer defense: Static analysis → Runtime guard → Application logic → RLS policies
- Automated guardrails prevent unauthorized `rawDb` usage
- PostgreSQL Row-Level Security isolates tenant data at the database level
- Comprehensive test coverage for cross-tenant isolation

### Running Security Checks

```bash
cd backend

# Check RLS service imports
pnpm check:rls

# Check rawDb allowlist
pnpm rls:guard

# Run RLS enforcement tests
pnpm test:rls

# Run all tests
pnpm test
```

## Available Scripts

### Root

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start both frontend and backend in development mode |
| `pnpm build` | Build both packages for production |
| `pnpm backend` | Start backend only |
| `pnpm frontend` | Start frontend only |
| `pnpm lint` | Run Biome lint |
| `pnpm lint:fix` | Run Biome lint with auto-fix |
| `pnpm format` | Run Biome formatter |
| `pnpm check` | Run Biome checks |
| `pnpm check:fix` | Run Biome checks with auto-fix |

### Backend

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start with hot reload |
| `pnpm build` | Compile TypeScript |
| `pnpm db:push` | Push schema changes to database |
| `pnpm db:generate` | Generate migration files |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:studio` | Open Drizzle Studio |

### Frontend

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Vite dev server |
| `pnpm build` | Build for production |
| `pnpm preview` | Preview production build |

## API Endpoints

All endpoints below (except `/api/auth/*`) require a `Bearer` token.

### Auth
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login and receive JWT
- `GET /api/auth/me` - Get current user from JWT
- `PATCH /api/auth/me` - Update user profile (name, language, country)
- `POST /api/auth/change-password` - Change password

### Budget
- `GET /api/budget` - Get current year budget (includes yearly budgets per item)
- `GET /api/budget/year/:year` - Get budget for specific year
- `GET /api/budget/months` - List month names
- `GET /api/budget/summary` - Get budget summary (includes yearly budgets in totals)
- `GET /api/budget/years` - List all years
- `POST /api/budget/years` - Create new year
- `PUT /api/budget/years/:id` - Update year
- `POST /api/budget/groups` - Create category group
- `PUT /api/budget/groups/reorder` - Reorder groups
- `PUT /api/budget/groups/:id` - Update group
- `DELETE /api/budget/groups/:id` - Delete group
- `POST /api/budget/items` - Create budget item
- `PUT /api/budget/items/move` - Move item to a different group
- `PUT /api/budget/items/reorder` - Reorder items within a group
- `PUT /api/budget/items/:id` - Update item (name, slug, sortOrder, yearlyBudget)
- `DELETE /api/budget/items/:id` - Delete item
- `PUT /api/budget/items/:itemId/months/:month` - Update monthly budget/actual values

### Transactions
- `GET /api/transactions/third-parties` - List distinct third parties (autocomplete)
- `GET /api/transactions` - List transactions (current year)
- `GET /api/transactions/year/:year` - List transactions for year
- `POST /api/transactions` - Create transaction
- `PUT /api/transactions/:id` - Update transaction (supports `recalculateAccounting`)
- `DELETE /api/transactions/:id` - Delete transaction
- `DELETE /api/transactions/bulk` - Bulk delete

### Transfers
- `GET /api/transfers/:year` - List transfers for year
- `GET /api/transfers/:year/accounts` - Get available accounts
- `POST /api/transfers/:year` - Create transfer
- `PUT /api/transfers/:id` - Update transfer
- `DELETE /api/transfers/:id` - Delete transfer

### Accounts
- `GET /api/accounts/:year` - Get accounts with balances
- `PUT /api/accounts/:year/balance` - Set initial balance
- `PUT /api/accounts/payment-method/:id/toggle` - Toggle payment method as account
- `PUT /api/accounts/payment-method/:id/savings` - Toggle payment method as savings account

### Payment Methods
- `GET /api/payment-methods` - List payment methods
- `POST /api/payment-methods` - Create payment method
- `PUT /api/payment-methods/reorder` - Reorder payment methods
- `PUT /api/payment-methods/:id` - Update payment method
- `DELETE /api/payment-methods/:id` - Delete payment method

### Settings
- `GET /api/settings` - Get all settings for current user
- `GET /api/settings/:key` - Get a setting value
- `PUT /api/settings/:key` - Upsert a setting value
- `DELETE /api/settings/:key` - Delete a setting

### Import
- `POST /api/import/pdf` - Parse PDF bank statement (basic text extraction)
- `POST /api/import/pdf-llm` - Smart PDF import with AI extraction + classification
  - Detects payment method from document issuer
  - Extracts and classifies all transactions
  - Returns transactions with categories, payment methods, and cleaned descriptions
- `GET /api/import/llm-status` - Check if AI classification is available
- `POST /api/import/classify` - Batch classify transactions with AI
  - Processes transactions in parallel batches
  - Returns categories, descriptions, third parties, payment methods, and confidence scores
  - Matches payment methods individually per transaction (from rawPaymentMethod field or patterns)
- `POST /api/import/bulk` - Bulk create transactions from import preview

## License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE).

You are free to use, modify, and share this software for **noncommercial purposes** only. Commercial use requires explicit permission from the author.
