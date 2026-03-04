FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copia dependências de produção
COPY --from=deps /app/node_modules ./node_modules
# Copia build
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Cria diretório de dados persistente
RUN mkdir -p /app/data

EXPOSE 3000

# Health check (Railway usa esse para saber se o container subiu)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
