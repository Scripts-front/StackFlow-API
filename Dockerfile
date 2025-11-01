
FROM oven/bun:1.1.29

WORKDIR /app

COPY package.json ./

RUN bun install --production

COPY . .

EXPOSE 3000

# Comando padrão pra iniciar o app
CMD ["bun", "run", "start"]
