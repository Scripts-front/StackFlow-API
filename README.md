# StackFlow API

API para gerenciar e criar stacks no Portainer de forma automatizada com suporte a Redis, N8N e gerenciamento de DNS na Cloudflare.

## 📋 Requisitos

- Node.js 18+ ou Bun
- Portainer configurado e rodando
- Credenciais do Portainer (usuário e senha)
- (Opcional) Token de API da Cloudflare para gerenciamento de DNS

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
# API
PORT=3000
AUTH_TOKEN=seu-token-secreto-aqui

# Portainer
PORTAINER_URL=http://seu-portainer:9000
PORTAINER_USERNAME=admin
PORTAINER_PASSWORD=sua-senha-aqui
PORTAINER_ENDPOINT_ID=1

# Domínio principal (para templates)
DOMAIN=seudominio.com.br

# Cloudflare (opcional)
CLOUDFLARE_API_TOKEN=seu-token-cloudflare
CLOUDFLARE_ZONE_ID=seu-zone-id
CLOUDFLARE_DOMAIN=seudominio.com.br
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

## 🎯 Recursos

### ✅ Stacks Suportadas
- **Redis**: Stack standalone com persistência
- **N8N**: Cria 3 stacks separadas automaticamente
  - Editor (interface web)
  - Webhook (processamento de webhooks - 2 réplicas)
  - Worker (processamento de filas)

### ☁️ Cloudflare DNS
- Criação/atualização automática de registros DNS
- Suporte a tipos: A, AAAA, CNAME
- Configuração de proxy (proxied)

### 🔐 Segurança
- Autenticação JWT automática com o Portainer
- Cache inteligente de tokens (8 horas)
- Renovação automática de autenticação
- Token Bearer para proteger endpoints

---

## 📚 Endpoints da API

### 1. **Health Check**
Verifica se a API está funcionando e mostra status de autenticação.

```bash
curl http://localhost:3000/health
```

**Resposta:**
```json
{
  "status": "ok",
  "timestamp": "2024-11-04T12:00:00.000Z",
  "portainerAuth": "authenticated",
  "cloudflareConfigured": true
}
```

---

### 2. **Listar Tipos Disponíveis**
Lista todos os tipos de stacks e configurações disponíveis.

```bash
curl http://localhost:3000/api/tipos
```

**Resposta:**
```json
{
  "servicos": {
    "redis": {
      "endpoint": "/api/stack",
      "exemplo": {
        "nome": "meu-app",
        "tipo": "redis",
        "rede": "network_public",
        "porta": 6379
      }
    },
    "n8n": {
      "endpoint": "/api/stack",
      "exemplo": {
        "nome": "cliente1",
        "tipo": "n8n",
        "rede": "network_public",
        "config": {
          "postgresHost": "postgres-host",
          "postgresDb": "n8n_db",
          "postgresPassword": "senha-segura",
          "redisHost": "redis-host",
          "redisPort": "6379",
          "redisPassword": "senha-redis",
          "versaoN8n": "latest"
        }
      },
      "observacao": "Cria 3 stacks separadas automaticamente: n8n-editor-{nome}, n8n-webhook-{nome}, n8n-worker-{nome}"
    },
    "cloudflare": {
      "endpoint": "/api/cloudflare",
      "exemplos": {
        "A": {
          "nome": "redis-app1",
          "tipo": "A",
          "ipServidor": "1.2.3.4"
        },
        "CNAME": {
          "nome": "redis-app1",
          "tipo": "CNAME",
          "ipServidor": "new.hostexpert.com.br"
        }
      }
    }
  }
}
```

---

### 3. **Criar Stack Redis** 🔐

Cria uma stack Redis com persistência e senha automática.

```bash
curl -X POST http://localhost:3000/api/stack \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer seu-token-secreto-aqui" \
  -d '{
    "nome": "cliente1",
    "tipo": "redis",
    "rede": "network_public",
    "porta": 6379
  }'
```

**Body Parameters:**
| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `nome` | string | Sim | Nome da stack |
| `tipo` | string | Sim | `redis` |
| `rede` | string | Sim | Nome da rede Docker Swarm |
| `porta` | number | Não | Porta exposta (padrão: 6379, min: 1024, max: 65535) |
| `endpointId` | number | Não | ID do endpoint Portainer (padrão: 1) |

**Resposta de Sucesso:**
```json
{
  "success": true,
  "message": "Stack Redis 'cliente1' criada com sucesso",
  "stackId": 123,
  "stackName": "redis-cliente1-6379",
  "porta": 6379,
  "data": { ... }
}
```

**Configurações criadas:**
- **Nome do serviço:** `redis-{nome}`
- **Senha:** `qfYHqHsN2wceR6M3DgzgctHmTgn-{nome}`
- **Domínio Traefik:** `redis-{nome}.seudominio.com.br`
- **Volume:** `redis-{nome}`
- **Recursos:** 1 CPU, 1024M RAM

---

### 4. **Criar Stack N8N Completa** 🔐

Cria **3 stacks separadas** automaticamente para um ambiente N8N completo.

```bash
curl -X POST http://localhost:3000/api/stack \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer seu-token-secreto-aqui" \
  -d '{
    "nome": "cliente1",
    "tipo": "n8n",
    "rede": "network_public",
    "config": {
      "postgresHost": "postgres.exemplo.com",
      "postgresDb": "n8n_cliente1",
      "postgresPassword": "senha-postgres-123",
      "redisHost": "redis.exemplo.com",
      "redisPort": "6379",
      "redisPassword": "senha-redis-123",
      "versaoN8n": "latest"
    }
  }'
```

**Body Parameters:**
| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `nome` | string | Sim | Nome base para as stacks |
| `tipo` | string | Sim | `n8n` |
| `rede` | string | Sim | Nome da rede Docker Swarm |
| `config.postgresHost` | string | Sim | Host do PostgreSQL |
| `config.postgresDb` | string | Sim | Nome do banco de dados |
| `config.postgresPassword` | string | Sim | Senha do PostgreSQL |
| `config.redisHost` | string | Sim | Host do Redis |
| `config.redisPort` | string | Sim | Porta do Redis |
| `config.redisPassword` | string | Sim | Senha do Redis |
| `config.versaoN8n` | string | Não | Versão do N8N (padrão: `latest`) |
| `endpointId` | number | Não | ID do endpoint Portainer (padrão: 1) |

**Resposta de Sucesso:**
```json
{
  "success": true,
  "message": "N8N 'cliente1' criado com 3 de 3 stacks",
  "stacksCriadas": 3,
  "totalStacks": 3,
  "stacks": [
    {
      "name": "n8n-editor-cliente1",
      "id": 123,
      "tipo": "editor",
      "url": "https://editor.cliente1.seudominio.com.br"
    },
    {
      "name": "n8n-webhook-cliente1",
      "id": 124,
      "tipo": "webhook",
      "replicas": 2,
      "url": "https://webhooks.cliente1.seudominio.com.br"
    },
    {
      "name": "n8n-worker-cliente1",
      "id": 125,
      "tipo": "worker",
      "concurrency": 10
    }
  ],
  "urls": {
    "editor": "https://editor.cliente1.seudominio.com.br",
    "webhook": "https://webhooks.cliente1.seudominio.com.br"
  }
}
```

**Stacks criadas:**

| Stack | Serviço | Réplicas | Descrição |
|-------|---------|----------|-----------|
| `n8n-editor-{nome}` | `n8n_editor_{nome}` | 1 | Interface web do N8N |
| `n8n-webhook-{nome}` | `n8n_webhook_{nome}` | 2 | Processamento de webhooks |
| `n8n-worker-{nome}` | `n8n_worker_{nome}` | 1 | Worker de filas (concurrency=10) |

**Constraint de deployment:**
- Todas as stacks requerem: `node.labels.n8n-new == true`

**Recursos por serviço:**
- 1 CPU
- 1024M RAM

---

### 5. **Criar/Atualizar DNS na Cloudflare** 🔐 ☁️

Gerencia registros DNS na Cloudflare.

#### Registro tipo A (IPv4)
```bash
curl -X POST http://localhost:3000/api/cloudflare \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer seu-token-secreto-aqui" \
  -d '{
    "nome": "app1",
    "tipo": "A",
    "ipServidor": "192.168.1.100",
    "proxied": true
  }'
```

#### Registro tipo CNAME
```bash
curl -X POST http://localhost:3000/api/cloudflare \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer seu-token-secreto-aqui" \
  -d '{
    "nome": "app2",
    "tipo": "CNAME",
    "ipServidor": "servidor.exemplo.com",
    "proxied": false
  }'
```

**Body Parameters:**
| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `nome` | string | Sim | Subdomínio (sem o domínio principal) |
| `tipo` | string | Sim | Tipo: `A`, `AAAA` ou `CNAME` |
| `ipServidor` | string | Sim | IP (A/AAAA) ou domínio (CNAME) |
| `proxied` | boolean | Não | Usar proxy Cloudflare (padrão: true para A/AAAA, false para CNAME) |

**Resposta de Sucesso:**
```json
{
  "success": true,
  "message": "Subdomínio 'app1.seudominio.com.br' criado/atualizado com sucesso",
  "subdomain": "app1.seudominio.com.br",
  "ip": "192.168.1.100",
  "proxied": true,
  "recordId": "abc123def456",
  "data": { ... }
}
```

---

### 6. **Listar Stacks** 🔐

Lista todas as stacks existentes no Portainer.

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
      "Name": "redis-cliente1-6379",
      "Type": 2,
      "EndpointId": 1,
      "Status": 1,
      "CreationDate": 1698854400
    },
    {
      "Id": 124,
      "Name": "n8n-editor-cliente1",
      "Type": 2,
      "EndpointId": 1,
      "Status": 1
    }
  ]
}
```

---

### 7. **Status de Autenticação Portainer** 🔐

Verifica o status da autenticação JWT com o Portainer.

```bash
curl http://localhost:3000/api/auth/status \
  -H "Authorization: Bearer seu-token-secreto-aqui"
```

**Resposta:**
```json
{
  "authenticated": true,
  "expiresAt": "2024-11-04T20:00:00.000Z",
  "timeRemaining": 28800000
}
```

---

### 8. **Renovar Autenticação Portainer** 🔐

Força a renovação do token JWT do Portainer.

```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Authorization: Bearer seu-token-secreto-aqui"
```

**Resposta:**
```json
{
  "success": true,
  "message": "Autenticação renovada com sucesso",
  "expiresAt": "2024-11-04T20:00:00.000Z"
}
```

---

## 🐳 Docker

### Dockerfile
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

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
      - PORTAINER_USERNAME=${PORTAINER_USERNAME}
      - PORTAINER_PASSWORD=${PORTAINER_PASSWORD}
      - PORTAINER_ENDPOINT_ID=1
      - AUTH_TOKEN=${AUTH_TOKEN}
      - DOMAIN=${DOMAIN}
      - CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN}
      - CLOUDFLARE_ZONE_ID=${CLOUDFLARE_ZONE_ID}
      - CLOUDFLARE_DOMAIN=${CLOUDFLARE_DOMAIN}
    networks:
      - network_public
    restart: unless-stopped

networks:
  network_public:
    external: true
```

---

## 🔐 Autenticação

### Autenticação da API (Bearer Token)
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
- `POST /api/cloudflare`
- `GET /api/stacks`
- `GET /api/auth/status`
- `POST /api/auth/refresh`

### Autenticação com Portainer (JWT Automático)
A API gerencia automaticamente a autenticação com o Portainer:
- ✅ Login automático na inicialização
- ✅ Cache de token JWT por 8 horas
- ✅ Renovação automática quando expirado
- ✅ Retry em caso de falha 401

---

## 📝 Exemplos Completos

### Exemplo 1: Deploy Redis completo com DNS
```bash
# 1. Criar stack Redis
curl -X POST http://localhost:3000/api/stack \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer meu-token" \
  -d '{
    "nome": "acme",
    "tipo": "redis",
    "rede": "network_public",
    "porta": 6380
  }'

# 2. Criar DNS na Cloudflare
curl -X POST http://localhost:3000/api/cloudflare \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer meu-token" \
  -d '{
    "nome": "redis-acme",
    "tipo": "A",
    "ipServidor": "192.168.1.100",
    "proxied": true
  }'
```

**Resultado:**
- **Serviço:** `redis-acme` rodando na porta 6380
- **Senha:** `qfYHqHsN2wceR6M3DgzgctHmTgn-acme`
- **DNS:** `redis-acme.seudominio.com.br` → 192.168.1.100 (com proxy CF)
- **Volume persistente:** `redis-acme`

---

### Exemplo 2: Deploy N8N completo
```bash
curl -X POST http://localhost:3000/api/stack \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer meu-token" \
  -d '{
    "nome": "empresa-xyz",
    "tipo": "n8n",
    "rede": "network_public",
    "config": {
      "postgresHost": "postgres-prod.exemplo.com",
      "postgresDb": "n8n_empresa_xyz",
      "postgresPassword": "P@ssw0rd!Forte",
      "redisHost": "redis-prod.exemplo.com",
      "redisPort": "6379",
      "redisPassword": "R3d!s@S3cur3",
      "versaoN8n": "1.15.2"
    }
  }'
```

**Isso criará automaticamente:**

1. **n8n-editor-empresa-xyz**
   - URL: `https://editor.empresa-xyz.seudominio.com.br`
   - 1 réplica do editor web

2. **n8n-webhook-empresa-xyz**
   - URL: `https://webhooks.empresa-xyz.seudominio.com.br`
   - 2 réplicas para alta disponibilidade

3. **n8n-worker-empresa-xyz**
   - 1 réplica processando filas
   - Concurrency: 10 jobs simultâneos

---

## 🛠️ Variáveis de Ambiente

| Variável | Descrição | Padrão | Obrigatória |
|----------|-----------|--------|-------------|
| **API** |
| `PORT` | Porta da API | `3000` | Não |
| `AUTH_TOKEN` | Token Bearer para proteger endpoints | - | Não |
| **Portainer** |
| `PORTAINER_URL` | URL do Portainer | `http://localhost:9000` | Sim |
| `PORTAINER_USERNAME` | Usuário do Portainer | `admin` | Sim |
| `PORTAINER_PASSWORD` | Senha do Portainer | - | Sim |
| `PORTAINER_ENDPOINT_ID` | ID do endpoint Portainer | `1` | Não |
| **Domínio** |
| `DOMAIN` | Domínio principal para templates | - | Sim |
| **Cloudflare** |
| `CLOUDFLARE_API_TOKEN` | Token de API da Cloudflare | - | Não* |
| `CLOUDFLARE_ZONE_ID` | ID da zona DNS | - | Não* |
| `CLOUDFLARE_DOMAIN` | Domínio gerenciado | - | Não* |
| **Sistema** |
| `DOCKER_ENV` | Ativa modo Docker | `false` | Não |

\* Obrigatório apenas para usar o endpoint `/api/cloudflare`

---

## 🎯 Templates de Stack

### Redis
- **Imagem:** `redis:7`
- **Comando:** Redis Server com AOF habilitado
- **Senha automática:** Gerada baseada no nome
- **Persistência:** Volume externo
- **Recursos:** 1 CPU, 1GB RAM
- **Traefik:** Labels automáticos para proxy reverso

### N8N
Todas as stacks N8N compartilham:
- **Timezone:** America/Sao_Paulo
- **Queue Mode:** Bull Redis
- **Database:** PostgreSQL
- **Constraint:** `node.labels.n8n-new == true`
- **Update Strategy:** Rolling update (start-first)

**Editor:**
- Comando: `start`
- Réplicas: 1
- Porta: 5678

**Webhook:**
- Comando: `webhook`
- Réplicas: 2
- Porta: 5678

**Worker:**
- Comando: `worker --concurrency=10`
- Réplicas: 1
- Concurrency: 10 jobs simultâneos

---

## 🔧 Troubleshooting

### Erro: "Falha na autenticação do Portainer"
- Verifique se `PORTAINER_USERNAME` e `PORTAINER_PASSWORD` estão corretos
- Confirme se o Portainer está acessível na URL configurada

### Erro: "Token inválido"
- Verifique se o header `Authorization: Bearer {token}` está correto
- Confirme se o `AUTH_TOKEN` no `.env` é o mesmo usado na requisição

### Erro: "Configurações da Cloudflare não definidas"
- Configure todas as 3 variáveis: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_DOMAIN`
- Verifique se o token tem permissões de DNS

### N8N não conecta ao PostgreSQL/Redis
- Verifique se os hosts estão acessíveis da rede configurada
- Confirme se as credenciais estão corretas
- Teste a conectividade: `docker exec -it <container> ping postgres-host`

---

## 📊 Monitoramento

A API fornece logs detalhados:
```bash
# Visualizar logs
docker logs stackflow-api -f

# Logs incluem:
🔐 Autenticação no Portainer...
✅ Autenticação bem-sucedida
📡 Buscando Swarm ID...
🆔 Swarm ID encontrado: abc123
🚀 Iniciando criação das 3 stacks do N8N (separadas)...
📝 Criando stack N8N Editor...
✅ Stack Editor criada com sucesso
```

---

## 🚀 Roadmap

- [ ] Suporte a mais tipos de stacks (PostgreSQL, MySQL, MongoDB)
- [ ] Interface web para gerenciamento
- [ ] Backup automático de stacks
- [ ] Webhooks para notificações
- [ ] Métricas e dashboards
- [ ] Multi-tenant com isolamento

---

## 📄 Licença

MIT

---

## 👤 Autor

[@biellil](https://github.com/biellil)

