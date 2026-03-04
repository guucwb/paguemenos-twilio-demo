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

# Garante diretório de dados e copia os dados seedados para dentro do container
RUN mkdir -p /app/data
COPY data ./data

EXPOSE 3000

# Health check (mais robusto: respeita PORT do Railway)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD sh -c "wget -qO- http://localhost:${PORT:-3000}/health || exit 1"

CMD ["node", "dist/index.js"]