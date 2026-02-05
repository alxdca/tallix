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
- **Spreadsheet Import** - Paste data from Excel/Sheets with configurable column mapping
- **PDF Import** - Import transactions from bank statement PDFs with optional category suggestions
- **LLM Classification (optional)** - DeepSeek-powered PDF extraction + classification and batch classification for imported transactions, with language and country context
- **Multi-user Authentication** - Email/password auth, per-user profile (name, language, country), settings, and payment methods (JWT-protected APIs)
- **Settlement Days** - Configure payment method billing cycles for accurate monthly accounting
- **Linked Accounts** - Link payment methods to their funding accounts

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Backend**: Express.js, TypeScript, Pino (logging)
- **Database**: PostgreSQL 16, Drizzle ORM
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
│   ├── src/
│   │   ├── db/           # Database schema and connection
│   │   ├── middleware/   # Express middleware (error handling)
│   │   ├── routes/       # API route handlers
│   │   ├── services/     # Business logic
│   │   └── types/        # Shared TypeScript types
│   └── drizzle.config.ts
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

## Available Scripts

### Root

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start both frontend and backend in development mode |
| `pnpm build` | Build both packages for production |
| `pnpm backend` | Start backend only |
| `pnpm frontend` | Start frontend only |

### Backend

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start with hot reload |
| `pnpm build` | Compile TypeScript |
| `pnpm db:push` | Push schema changes to database |
| `pnpm db:generate` | Generate migration files |
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
- `GET /api/budget/summary` - Get budget summary (includes yearly budgets in totals)
- `GET /api/budget/years` - List all years
- `POST /api/budget/years` - Create new year
- `PUT /api/budget/years/:id` - Update year
- `POST /api/budget/groups` - Create category group
- `PUT /api/budget/groups/:id` - Update group
- `DELETE /api/budget/groups/:id` - Delete group
- `POST /api/budget/items` - Create budget item
- `PUT /api/budget/items/:id` - Update item (name, slug, sortOrder, yearlyBudget)
- `DELETE /api/budget/items/:id` - Delete item
- `PUT /api/budget/monthly-value/:itemId/:month` - Update monthly budget value

### Transactions
- `GET /api/transactions/third-parties` - List distinct third parties (autocomplete)
- `GET /api/transactions` - List transactions (current year)
- `GET /api/transactions/year/:year` - List transactions for year
- `POST /api/transactions` - Create transaction
- `PUT /api/transactions/:id` - Update transaction
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

### Payment Methods
- `GET /api/payment-methods` - List payment methods
- `POST /api/payment-methods` - Create payment method
- `PUT /api/payment-methods/:id` - Update payment method
- `DELETE /api/payment-methods/:id` - Delete payment method

### Settings
- `GET /api/settings` - Get all settings for current user
- `GET /api/settings/:key` - Get a setting value
- `PUT /api/settings/:key` - Upsert a setting value
- `DELETE /api/settings/:key` - Delete a setting

### Import
- `POST /api/import/pdf` - Parse PDF bank statement
- `POST /api/import/pdf-llm` - Extract + classify from PDF with LLM
- `GET /api/import/llm-status` - Check if LLM classification is available
- `POST /api/import/classify` - Classify transactions with LLM
- `POST /api/import/bulk` - Bulk create transactions

## License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE).

You are free to use, modify, and share this software for **noncommercial purposes** only. Commercial use requires explicit permission from the author.
