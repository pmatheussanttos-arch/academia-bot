FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

# Dependências primeiro, para o build reaproveitar o cache quando só o texto muda.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json instrucoes.md agenda.json mensagens.md campanha.md ./
COPY src ./src

# O banco de dados fica em /data. Na hospedagem, ligue um disco/volume permanente a esta pasta.
# (Sem VOLUME de propósito: alguns serviços, como o Railway, não aceitam essa instrução.)
ENV DATA_DIR=/data
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Limite da memória dos objetos do JavaScript: obriga o Node a liberar memória antes de chegar ao limite do plano da
# Render (512 MB). Para outro plano, mude a variável NODE_OPTIONS na Render (ex.: 1 GB -> --max-old-space-size=700).
ENV NODE_OPTIONS=--max-old-space-size=320

# "node --import tsx" em vez de "npm start": o desligamento recebe o sinal direto, sem intermediário.
CMD ["node", "--import", "tsx", "src/server.ts"]
