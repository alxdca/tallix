# Build stage
FROM node:22-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/package.json ./backend/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy backend source
COPY backend/ ./backend/

# Build the app
WORKDIR /app/backend
RUN pnpm build

# Production stage
FROM node:22-alpine

# Install pnpm for running migrations
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Copy workspace files for pnpm
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/package.json ./backend/

# Install all dependencies (need drizzle-kit for migrations)
RUN pnpm install --frozen-lockfile

# Copy built files
COPY --from=builder /app/backend/dist ./backend/dist

# Copy drizzle migrations, config, and schema source (needed for drizzle-kit)
COPY backend/drizzle ./backend/drizzle
COPY backend/drizzle.config.ts ./backend/
COPY backend/src/db ./backend/src/db

WORKDIR /app/backend

EXPOSE 3001

# Run migrations and start the server
CMD ["sh", "-c", "pnpm db:migrate && node dist/index.js"]
