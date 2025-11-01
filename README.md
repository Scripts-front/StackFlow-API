# StackFlow API

API para gerenciar e criar stacks no Portainer de forma automatizada.

## 📋 Requisitos

- Node.js 18+ ou Bun
- Portainer configurado e rodando
- Token de API do Portainer

## 🚀 Instalação
```bash
# Clonar o repositório
git clone https://github.com/biellil/stackflow-api.git
cd stackflow-api

# Instalar dependências
npm install
# ou
bun install
```

## ⚙️ Configuração

Crie um arquivo `.env` na raiz do projeto:
```env
PORT=3000
PORTAINER_URL=http://seu-portainer:9000
PORTAINER_TOKEN=ptr_seu-token-aqui
PORTAINER_ENDPOINT_ID=1
AUTH_TOKEN=seu-token-secreto-aqui
```

## 🏃 Executar
```bash
# Modo desenvolvimento
npm start
# ou
bun run start

# Modo Docker
docker-compose up -d
```

---

## 📚 Endpoints da API

### 1. **Health Check**
Verifica se a API está funcionando.
```bash
curl http://localhost:3000/health
```

**Resposta:**
```json
{
  "status": "ok",
  "timestamp": "2024-11-01T12:00:00.000Z"
}
```

---

### 2. **Listar Tipos Disponíveis**
Lista todos os tipos de stacks que podem ser criadas.
```bash
curl http://localhost:3000/api/tipos
```

**Resposta:**
```json
{
  "tipos": ["redis"],
  "exemplo": {
    "nome": "meu-app",
    "tipo": "redis",
    "rede": "network_public"
  }
}
```

---

### 3. **Criar Stack** 🔐
Cria uma nova stack no Portainer.

**Sem autenticação (se AUTH_TOKEN não estiver configurado):**
```bash
curl -X POST http://localhost:3000/api/stack \
  -H "Content-Type: application/json" \
  -d '{
    "nome": "cliente1",
    "tipo": "redis",
    "rede": "network_public"
  }'
```

**Com autenticação (se AUTH_TOKEN estiver configurado):**
```bash
curl -X POST http://localhost:3000/api/stack \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer seu-token-secreto-aqui" \
  -d '{
    "nome": "cliente1",
    "tipo": "redis",
    "rede": "network_public"
  }'
```

**Body Parameters:**
| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `nome` | string | Sim | Nome da stack (será usado como prefixo) |
| `tipo` | string | Sim | Tipo da stack (`redis`) |
| `rede` | string | Sim | Nome da rede Docker |
| `endpointId` | number | Não | ID do endpoint Portainer (padrão: 1) |

**Resposta de Sucesso (201):**
```json
{
  "success": true,
  "message": "Stack 'cliente1' do tipo 'redis' criada com sucesso",
  "stackId": 123,
  "data": {
    "Id": 123,
    "Name": "cliente1",
    "Type": 2,
    "EndpointId": 1,
    "Status": 1
  }
}
```

**Resposta de Erro (400):**
```json
{
  "error": "Campos obrigatórios: nome, tipo, rede"
}
```

**Resposta de Erro (401 - Sem Token):**
```json
{
  "error": "Token de autenticação não fornecido",
  "message": "Use o header: Authorization: Bearer seu-token"
}
```

**Resposta de Erro (403 - Token Inválido):**
```json
{
  "error": "Token inválido",
  "message": "Token de autenticação não autorizado"
}
```

---

### 4. **Listar Stacks** 🔐
Lista todas as stacks existentes no Portainer.

**Sem autenticação:**
```bash
curl http://localhost:3000/api/stacks
```

**Com autenticação:**
```bash
curl http://localhost:3000/api/stacks \
  -H "Authorization: Bearer seu-token-secreto-aqui"
```

**Resposta:**
```json
{
  "success": true,
  "stacks": [
    {
      "Id": 123,
      "Name": "cliente1",
      "Type": 2,
      "EndpointId": 1,
      "Status": 1,
      "CreationDate": 1698854400
    }
  ]
}
```

---

## 🐳 Docker

### Dockerfile
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ENV DOCKER_ENV=true

EXPOSE 3000

CMD ["node", "src/index.js"]
```

### Docker Compose
```yaml
version: '3.8'

services:
  stackflow-api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DOCKER_ENV=true
      - PORT=3000
      - PORTAINER_URL=http://portainer:9000
      - PORTAINER_TOKEN=${PORTAINER_TOKEN}
      - PORTAINER_ENDPOINT_ID=1
      - AUTH_TOKEN=${AUTH_TOKEN}
    networks:
      - network_public

networks:
  network_public:
    external: true
```

---

## 🔐 Autenticação

A API suporta autenticação via Bearer Token. Para ativar:

1. Configure `AUTH_TOKEN` no `.env`
2. Adicione o header em todas as requisições protegidas:
```bash
Authorization: Bearer seu-token-secreto-aqui
```

**Endpoints públicos (sem autenticação):**
- `GET /health`
- `GET /api/tipos`

**Endpoints protegidos (requerem autenticação se `AUTH_TOKEN` configurado):**
- `POST /api/stack`
- `GET /api/stacks`

---

## 📝 Exemplo Completo

Criar um Redis para o cliente "acme":
```bash
curl -X POST http://localhost:3000/api/stack \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer meu-token-super-secreto" \
  -d '{
    "nome": "acme",
    "tipo": "redis",
    "rede": "network_public"
  }'
```

Isso criará:
- **Serviço:** `redis-acme`
- **Senha:** `qfYHqHsN2wceR6M3DgzgctHmTgn-acme`
- **Domínio:** `redis-acme.hostexpert.com.br`
- **Porta:** `6379`
- **Volume:** `redis-acme`

---

## 🛠️ Variáveis de Ambiente

| Variável | Descrição | Padrão | Obrigatória |
|----------|-----------|--------|-------------|
| `PORT` | Porta da API | `3000` | Não |
| `PORTAINER_URL` | URL do Portainer | `http://localhost:9000` | Sim |
| `PORTAINER_TOKEN` | Token de API do Portainer | - | Sim |
| `PORTAINER_ENDPOINT_ID` | ID do endpoint Portainer | `1` | Não |
| `AUTH_TOKEN` | Token de autenticação da API | - | Não |
| `DOCKER_ENV` | Ativa modo Docker (não carrega .env) | `false` | Não |

---

## 📄 Licença

MIT

---

## 👤 Autor

Seu Nome - [@biellil](https://github.com/biellil)