const express = require('express');
const axios = require('axios');
const https = require('https');

// Carrega .env apenas se não estiver usando Docker
if (!process.env.DOCKER_ENV) {
  require('dotenv').config();
}

const app = express();
app.use(express.json());

// Configurações principais
const PORT = process.env.PORT || 3000;
const PORTAINER_URL = process.env.PORTAINER_URL || 'http://localhost:9000';
const PORTAINER_USERNAME = process.env.PORTAINER_USERNAME || 'admin';
const PORTAINER_PASSWORD = process.env.PORTAINER_PASSWORD || '';
const PORTAINER_ENDPOINT_ID = parseInt(process.env.PORTAINER_ENDPOINT_ID) || 1;
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const DOMAIN = process.env.DOMAIN;

// Cloudflare
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN ;
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;
const CLOUDFLARE_DOMAIN = process.env.CLOUDFLARE_DOMAIN;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_TUNNEL_ID = process.env.CLOUDFLARE_TUNNEL_ID;

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Cache do JWT (em memória)
let jwtCache = {
  token: null,
  expiresAt: null
};

// ✅ Função para autenticar no Portainer e obter JWT
const authenticatePortainer = async () => {
  try {
    console.log('🔐 Autenticando no Portainer...');
    
    const response = await axios.post(
      `${PORTAINER_URL}/api/auth`,
      {
        username: PORTAINER_USERNAME,
        password: PORTAINER_PASSWORD
      },
      {
        headers: { 'Content-Type': 'application/json' },
        httpsAgent
      }
    );

    const jwt = response.data.jwt;
    
    // Cache do token por 8 horas (padrão do Portainer)
    jwtCache = {
      token: jwt,
      expiresAt: Date.now() + (8 * 60 * 60 * 1000)
    };

    console.log('✅ Autenticação bem-sucedida');
    return jwt;

  } catch (error) {
    console.error('❌ Erro ao autenticar no Portainer:', error.response?.data || error.message);
    throw new Error('Falha na autenticação do Portainer');
  }
};

// ✅ Função para obter JWT válido (usa cache ou renova)
const getValidJWT = async () => {
  if (jwtCache.token && jwtCache.expiresAt > Date.now()) {
    return jwtCache.token;
  }
  return await authenticatePortainer();
};

// ✅ Função para obter headers com JWT válido
const getPortainerHeaders = async () => {
  const jwt = await getValidJWT();
  return {
    'Authorization': `Bearer ${jwt}`,
    'Content-Type': 'application/json'
  };
};

// ✅ Função para criar/atualizar registro DNS na Cloudflare
const createCloudflareRecord = async (nome, tipo, targetValue, proxied = true) => {
  try {
    if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ZONE_ID || !CLOUDFLARE_DOMAIN) {
      throw new Error('Configurações da Cloudflare não definidas (API_TOKEN, ZONE_ID ou DOMAIN)');
    }

    console.log('☁️ Criando registro DNS na Cloudflare...');
    console.log(`📝 Tipo: ${tipo}, Nome: ${nome}, Target: ${targetValue}, Proxied: ${proxied}`);

    const subdomain = `${nome}.${CLOUDFLARE_DOMAIN}`;
    
    const headers = {
      'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json'
    };

    const listResponse = await axios.get(
      `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records?name=${subdomain}`,
      { headers }
    );

    const existingRecord = listResponse.data.result[0];

    const recordData = {
      type: tipo,
      name: subdomain,
      content: targetValue,
      ttl: 1,
      proxied: proxied
    };

    if (existingRecord) {
      console.log('🔄 Registro já existe, atualizando...');
      
      const updateResponse = await axios.put(
        `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${existingRecord.id}`,
        recordData,
        { headers }
      );

      console.log('✅ Registro DNS atualizado na Cloudflare');
      return updateResponse.data.result;

    } else {
      console.log('➕ Criando novo registro DNS...');
      
      const createResponse = await axios.post(
        `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records`,
        recordData,
        { headers }
      );

      console.log('✅ Registro DNS criado na Cloudflare');
      return createResponse.data.result;
    }

  } catch (error) {
    console.error('❌ Erro ao criar registro na Cloudflare:', error.response?.data || error.message);
    throw error;
  }
};

// 🆕 Função para adicionar hostname ao túnel Cloudflare
const addHostnameToTunnel = async (hostname, service) => {
  try {
    if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_TUNNEL_ID) {
      throw new Error('Configurações do túnel Cloudflare não definidas (API_TOKEN, ACCOUNT_ID ou TUNNEL_ID)');
    }

    console.log('🚇 Adicionando hostname ao túnel Cloudflare...');
    console.log(`📝 Hostname: ${hostname}, Service: ${service}`);

    const headers = {
      'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json'
    };

    // Primeiro, busca a configuração atual do túnel
    const getTunnelUrl = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${CLOUDFLARE_TUNNEL_ID}/configurations`;
    
    const currentConfig = await axios.get(getTunnelUrl, { headers });
    
    const existingIngress = currentConfig.data.result?.config?.ingress || [];
    
    // Remove regra existente para o mesmo hostname, se houver
    const filteredIngress = existingIngress.filter(rule => rule.hostname !== hostname);
    
    // Adiciona a nova regra ANTES da regra catch-all
    const catchAllRule = filteredIngress.find(rule => !rule.hostname);
    const otherRules = filteredIngress.filter(rule => rule.hostname);
    
    const newRule = {
      hostname: hostname,
      service: service,
      originRequest: {
        noTLSVerify: true
      }
    };

    // Monta o array final: outras regras + nova regra + catch-all
    const newIngress = [...otherRules, newRule];
    if (catchAllRule) {
      newIngress.push(catchAllRule);
    }

    // Atualiza a configuração do túnel
    const updatePayload = {
      config: {
        ingress: newIngress
      }
    };

    const updateResponse = await axios.put(getTunnelUrl, updatePayload, { headers });

    console.log('✅ Hostname adicionado ao túnel com sucesso');
    return {
      success: true,
      hostname: hostname,
      service: service,
      tunnelId: CLOUDFLARE_TUNNEL_ID
    };

  } catch (error) {
    console.error('❌ Erro ao adicionar hostname ao túnel:', error.response?.data || error.message);
    throw error;
  }
};

// Middleware de autenticação da API
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!AUTH_TOKEN) return next();

  if (!token) {
    return res.status(401).json({
      error: 'Token de autenticação não fornecido',
      message: 'Use o header: Authorization: Bearer seu-token'
    });
  }

  if (token !== AUTH_TOKEN) {
    return res.status(403).json({
      error: 'Token inválido',
      message: 'Token de autenticação não autorizado'
    });
  }

  next();
};

// 🧠 Template dinâmico de stack
const getStackTemplate = (tipo, nome, rede, config = {}) => {
  switch (tipo.toLowerCase()) {
    case 'redis':
      const porta = config.porta || 6379;
      return `version: "3.7"
services:
  redis-${nome}:
    image: redis:7
    hostname: "{{.Service.Name}}"
    command: [
      "redis-server",
      "--appendonly", "yes",
      "--port", "6379",
      "--requirepass", "qfYHqHsN2wceR6M3DgzgctHmTgn-${nome}"
    ]
    networks:
      - ${rede}
    ports:
      - ${porta}:6379
    volumes:
      - redis-${nome}:/data
    deploy:
      mode: replicated
      replicas: 1
      placement:
        constraints:
          - node.role == manager
      resources:
        limits:
          cpus: "1"
          memory: 1024M
      labels:
        - traefik.enable=true
        - traefik.http.routers.redis-${nome}.rule=Host(\`redis-${nome}.${DOMAIN}\`)
        - traefik.http.routers.redis-${nome}.entrypoints=websecure
        - traefik.http.routers.redis-${nome}.tls.certresolver=letsencryptresolver
        - traefik.http.routers.redis-${nome}.service=redis-${nome}
        - traefik.http.services.redis-${nome}.loadbalancer.server.port=${porta}
volumes:
  redis-${nome}:
    external: true
    name: redis-${nome}
networks:
  ${rede}:
    external: true
    name: ${rede}`;

    case 'n8n-editor':
      const versao = config.versaoN8n || 'latest';
      return `version: "3.7"

services:
  n8n_editor_${nome}:
    image: n8nio/n8n:${versao}
    hostname: "{{.Service.Name}}.{{.Task.Slot}}"
    command: start
    networks:
      - ${rede}
    environment:
      - NODE_ENV=production
      - N8N_METRICS=true
      - N8N_DIAGNOSTICS_ENABLED=false
      - N8N_PAYLOAD_SIZE_MAX=16
      - N8N_LOG_LEVEL=info
      - GENERIC_TIMEZONE=America/Sao_Paulo
      - N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true
      - N8N_RUNNERS_ENABLED=false
      - N8N_RUNNERS_MODE=internal
      - OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS=false
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_DATABASE=${config.postgresDb || 'n8n'}
      - DB_POSTGRESDB_HOST=${config.postgresHost || 'postgres'}
      - DB_POSTGRESDB_PORT=5432
      - DB_POSTGRESDB_USER=postgres
      - DB_POSTGRESDB_PASSWORD=${config.postgresPassword || 'postgres'}
      - N8N_PORT=5678
      - N8N_HOST=editor.${nome}.${DOMAIN}
      - N8N_EDITOR_BASE_URL=https://editor.${nome}.${DOMAIN}/
      - N8N_PROTOCOL=https
      - WEBHOOK_URL=https://webhooks.${nome}.${DOMAIN}/
      - N8N_ENDPOINT_WEBHOOK=webhook
      - EXECUTIONS_MODE=queue
      - QUEUE_BULL_REDIS_HOST=${config.redisHost || 'redis'}
      - QUEUE_BULL_REDIS_PORT=${config.redisPort || '6379'}
      - QUEUE_BULL_REDIS_PASSWORD=${config.redisPassword || ''}
      - QUEUE_BULL_REDIS_DB=2
      - EXECUTIONS_TIMEOUT=3600 
      - EXECUTIONS_TIMEOUT_MAX=7200 
      - N8N_VERSION_NOTIFICATIONS_ENABLED=true
      - N8N_PUBLIC_API_SWAGGERUI_DISABLED=false
      - N8N_TEMPLATES_ENABLED=true
      - N8N_ONBOARDING_FLOW_DISABLED=true
      - N8N_WORKFLOW_TAGS_DISABLED=false
      - N8N_HIDE_USAGE_PAGE=false
      - EXECUTIONS_DATA_PRUNE=true
      - EXECUTIONS_DATA_MAX_AGE=336
      - EXECUTIONS_DATA_PRUNE_HARD_DELETE_INTERVAL=15
      - EXECUTIONS_DATA_PRUNE_SOFT_DELETE_INTERVAL=60
      - EXECUTIONS_DATA_PRUNE_MAX_COUNT=10000
      - EXECUTIONS_DATA_SAVE_ON_ERROR=all
      - EXECUTIONS_DATA_SAVE_ON_SUCCESS=all
      - EXECUTIONS_DATA_SAVE_ON_PROGRESS=true
      - EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS=true
      - NODE_FUNCTION_ALLOW_BUILTIN=*
      - NODE_FUNCTION_ALLOW_EXTERNAL=lodash
      - N8N_COMMUNITY_PACKAGES_ENABLED=true
      - N8N_REINSTALL_MISSING_PACKAGES=true
      - N8N_NODE_PATH=/home/node/.n8n/nodes
    deploy:
      mode: replicated
      replicas: 1
      placement:
        constraints:
          - node.labels.n8n-new == true
      resources:
        limits:
          cpus: "1"
          memory: 1024M
      update_config:
        parallelism: 1
        delay: 30s
        order: start-first
        failure_action: rollback
networks:
  ${rede}:
    name: ${rede}
    external: true`;

    case 'n8n-webhook':
      const versaoWebhook = config.versaoN8n || 'latest';
      return `version: "3.7"

services:
  n8n_webhook_${nome}:
    image: n8nio/n8n:${versaoWebhook}
    hostname: "{{.Service.Name}}.{{.Task.Slot}}"
    command: webhook
    networks:
      - ${rede}
    environment:
      - NODE_ENV=production
      - N8N_METRICS=true
      - N8N_DIAGNOSTICS_ENABLED=false
      - N8N_PAYLOAD_SIZE_MAX=16
      - N8N_LOG_LEVEL=info
      - GENERIC_TIMEZONE=America/Sao_Paulo
      - N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true
      - N8N_RUNNERS_ENABLED=false
      - N8N_RUNNERS_MODE=internal
      - OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS=false
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_DATABASE=${config.postgresDb || 'n8n'}
      - DB_POSTGRESDB_HOST=${config.postgresHost || 'postgres'}
      - DB_POSTGRESDB_PORT=5432
      - DB_POSTGRESDB_USER=postgres
      - DB_POSTGRESDB_PASSWORD=${config.postgresPassword || 'postgres'}
      - N8N_PORT=5678
      - N8N_HOST=editor.${nome}.${DOMAIN}
      - N8N_EDITOR_BASE_URL=https://editor.${nome}.${DOMAIN}/
      - N8N_PROTOCOL=https
      - WEBHOOK_URL=https://webhooks.${nome}.${DOMAIN}/
      - N8N_ENDPOINT_WEBHOOK=webhook
      - EXECUTIONS_MODE=queue
      - QUEUE_BULL_REDIS_HOST=${config.redisHost || 'redis'}
      - QUEUE_BULL_REDIS_PORT=${config.redisPort || '6379'}
      - QUEUE_BULL_REDIS_PASSWORD=${config.redisPassword || ''}
      - QUEUE_BULL_REDIS_DB=2
      - EXECUTIONS_TIMEOUT=3600 
      - EXECUTIONS_TIMEOUT_MAX=7200 
      - N8N_VERSION_NOTIFICATIONS_ENABLED=true
      - N8N_PUBLIC_API_SWAGGERUI_DISABLED=false
      - N8N_TEMPLATES_ENABLED=true
      - N8N_ONBOARDING_FLOW_DISABLED=true
      - N8N_WORKFLOW_TAGS_DISABLED=false
      - N8N_HIDE_USAGE_PAGE=false
      - EXECUTIONS_DATA_PRUNE=true
      - EXECUTIONS_DATA_MAX_AGE=336
      - EXECUTIONS_DATA_PRUNE_HARD_DELETE_INTERVAL=15
      - EXECUTIONS_DATA_PRUNE_SOFT_DELETE_INTERVAL=60
      - EXECUTIONS_DATA_PRUNE_MAX_COUNT=10000
      - EXECUTIONS_DATA_SAVE_ON_ERROR=all
      - EXECUTIONS_DATA_SAVE_ON_SUCCESS=all
      - EXECUTIONS_DATA_SAVE_ON_PROGRESS=true
      - EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS=true
      - NODE_FUNCTION_ALLOW_BUILTIN=*
      - NODE_FUNCTION_ALLOW_EXTERNAL=lodash
      - N8N_COMMUNITY_PACKAGES_ENABLED=true
      - N8N_REINSTALL_MISSING_PACKAGES=true
      - N8N_NODE_PATH=/home/node/.n8n/nodes
    deploy:
      mode: replicated
      replicas: 2
      placement:
        constraints:
          - node.labels.n8n-new == true
      resources:
        limits:
          cpus: "1"
          memory: 1024M
      update_config:
        parallelism: 1
        delay: 30s
        order: start-first
        failure_action: rollback
networks:
  ${rede}:
    name: ${rede}
    external: true`;

    case 'n8n-worker':
      const versaoWorker = config.versaoN8n || 'latest';
      return `version: "3.7"

services:
  n8n_worker_${nome}:
    image: n8nio/n8n:${versaoWorker}
    hostname: "{{.Service.Name}}.{{.Task.Slot}}"
    command: worker --concurrency=10
    networks:
      - ${rede}
    environment:
      - NODE_ENV=production
      - N8N_METRICS=true
      - N8N_DIAGNOSTICS_ENABLED=false
      - N8N_PAYLOAD_SIZE_MAX=16
      - N8N_LOG_LEVEL=info
      - GENERIC_TIMEZONE=America/Sao_Paulo
      - N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true
      - N8N_RUNNERS_ENABLED=false
      - N8N_RUNNERS_MODE=internal
      - OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS=false
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_DATABASE=${config.postgresDb || 'n8n'}
      - DB_POSTGRESDB_HOST=${config.postgresHost || 'postgres'}
      - DB_POSTGRESDB_PORT=5432
      - DB_POSTGRESDB_USER=postgres
      - DB_POSTGRESDB_PASSWORD=${config.postgresPassword || 'postgres'}
      - N8N_PORT=5678
      - N8N_HOST=editor.${nome}.${DOMAIN}
      - N8N_EDITOR_BASE_URL=https://editor.${nome}.${DOMAIN}/
      - N8N_PROTOCOL=https
      - WEBHOOK_URL=https://webhooks.${nome}.${DOMAIN}/
      - N8N_ENDPOINT_WEBHOOK=webhook
      - EXECUTIONS_MODE=queue
      - QUEUE_BULL_REDIS_HOST=${config.redisHost || 'redis'}
      - QUEUE_BULL_REDIS_PORT=${config.redisPort || '6379'}
      - QUEUE_BULL_REDIS_PASSWORD=${config.redisPassword || ''}
      - QUEUE_BULL_REDIS_DB=2
      - EXECUTIONS_TIMEOUT=3600 
      - EXECUTIONS_TIMEOUT_MAX=7200 
      - N8N_VERSION_NOTIFICATIONS_ENABLED=true
      - N8N_PUBLIC_API_SWAGGERUI_DISABLED=false
      - N8N_TEMPLATES_ENABLED=true
      - N8N_ONBOARDING_FLOW_DISABLED=true
      - N8N_WORKFLOW_TAGS_DISABLED=false
      - N8N_HIDE_USAGE_PAGE=false
      - EXECUTIONS_DATA_PRUNE=true
      - EXECUTIONS_DATA_MAX_AGE=336
      - EXECUTIONS_DATA_PRUNE_HARD_DELETE_INTERVAL=15
      - EXECUTIONS_DATA_PRUNE_SOFT_DELETE_INTERVAL=60
      - EXECUTIONS_DATA_PRUNE_MAX_COUNT=10000
      - EXECUTIONS_DATA_SAVE_ON_ERROR=all
      - EXECUTIONS_DATA_SAVE_ON_SUCCESS=all
      - EXECUTIONS_DATA_SAVE_ON_PROGRESS=true
      - EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS=true
      - NODE_FUNCTION_ALLOW_BUILTIN=*
      - NODE_FUNCTION_ALLOW_EXTERNAL=lodash
      - N8N_COMMUNITY_PACKAGES_ENABLED=true
      - N8N_REINSTALL_MISSING_PACKAGES=true
      - N8N_NODE_PATH=/home/node/.n8n/nodes
    deploy:
      mode: replicated
      replicas: 1
      placement:
        constraints:
          - node.labels.n8n-new == true
      resources:
        limits:
          cpus: "1"
          memory: 1024M
      update_config:
        parallelism: 1
        delay: 30s
        order: start-first
        failure_action: rollback
networks:
  ${rede}:
    name: ${rede}
    external: true`;

    default:
      throw new Error(`Tipo de stack '${tipo}' não suportado`);
  }
};

// 🆕 Função para criar stack individual no Portainer
const createSingleStack = async (stackName, stackContent, swarmId, endpointId, headers) => {
  const payload = {
    name: stackName,
    stackFileContent: stackContent,
    env: [],
    swarmID: swarmId
  };

  const url = `${PORTAINER_URL}/api/stacks/create/swarm/string?endpointId=${endpointId}`;
  
  console.log(`🔗 Criando stack: ${stackName}`);

  const response = await axios.post(url, payload, {
    headers,
    httpsAgent
  });

  console.log(`✅ Stack ${stackName} criada com sucesso`);
  return response.data;
};

// 🆕 Função auxiliar para aguardar com timeout
const waitWithTimeout = (promise, timeoutMs) => {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), timeoutMs))
  ]);
};

// 📦 Endpoint para criar stack (Redis ou N8N completo com 3 stacks separadas)
app.post('/api/stack', authenticateToken, async (req, res) => {
  try {
    const { nome, tipo, rede, porta, endpointId = PORTAINER_ENDPOINT_ID, config = {} } = req.body;

    if (!nome || !tipo || !rede) {
      return res.status(400).json({ error: 'Campos obrigatórios: nome, tipo, rede' });
    }

    // Obter headers com JWT válido
    const headers = await getPortainerHeaders();

    // Pegar Swarm ID do endpoint
    console.log('📡 Buscando Swarm ID...');
    const swarmResponse = await axios.get(
      `${PORTAINER_URL}/api/endpoints/${endpointId}/docker/swarm`,
      { headers, httpsAgent }
    );
    const swarmId = swarmResponse.data.ID;
    console.log('🆔 Swarm ID encontrado:', swarmId);

    const tipoLower = tipo.toLowerCase();

    // Redis - Stack única
    if (tipoLower === 'redis') {
      const portaFinal = porta || 6379;
      if (portaFinal < 1024 || portaFinal > 65535) {
        return res.status(400).json({
          error: 'Porta inválida',
          message: 'A porta deve estar entre 1024 e 65535'
        });
      }

      const stackContent = getStackTemplate('redis', nome, rede, { porta: portaFinal });
      const stackName = `redis-${nome}-${portaFinal}`;

      const stackData = await createSingleStack(stackName, stackContent, swarmId, endpointId, headers);

      return res.json({
        success: true,
        message: `Stack Redis '${nome}' criada com sucesso`,
        stackId: stackData.Id,
        stackName: stackName,
        porta: portaFinal,
        data: stackData
      });
    }

    // N8N - Cria 3 stacks separadas automaticamente com timeout de 30 segundos
    if (tipoLower === 'n8n') {
      // Validar configurações obrigatórias
      if (!config.postgresHost || !config.postgresDb || !config.postgresPassword) {
        return res.status(400).json({
          error: 'Configurações obrigatórias para N8N',
          message: 'É necessário fornecer: postgresHost, postgresDb, postgresPassword, redisHost, redisPort, redisPassword',
          exemplo: {
            config: {
              postgresHost: 'postgres-host',
              postgresDb: 'n8n_db',
              postgresPassword: 'senha-segura',
              redisHost: 'redis-host',
              redisPort: '6379',
              redisPassword: 'senha-redis',
              versaoN8n: 'latest'
            }
          }
        });
      }

      const stacksCreated = [];
      const errors = [];

      console.log('🚀 Iniciando criação das 3 stacks do N8N (separadas)...');

      // 1️⃣ Stack Editor (separada) - com timeout de 30 segundos
      try {
        console.log('📝 Criando stack N8N Editor...');
        const editorContent = getStackTemplate('n8n-editor', nome, rede, config);
        const editorName = `n8n-editor-${nome}`;
        
        const result = await waitWithTimeout(
          createSingleStack(editorName, editorContent, swarmId, endpointId, headers),
          30000
        );
        
        if (result.timeout) {
          stacksCreated.push({ 
            name: editorName, 
            tipo: 'editor',
            url: `https://editor.${nome}.${DOMAIN}`,
            status: 'criado'
          });
          console.log('✅ Stack Editor enviada (tempo limite atingido, assumindo sucesso)');
        } else {
          stacksCreated.push({ 
            name: editorName, 
            id: result.Id, 
            tipo: 'editor',
            url: `https://editor.${nome}.${DOMAIN}`,
            status: 'confirmado'
          });
          console.log('✅ Stack Editor criada com sucesso');
        }
      } catch (error) {
        errors.push({ stack: 'editor', error: error.message });
        console.error('❌ Erro ao criar stack Editor:', error.message);
      }

      // 2️⃣ Stack Webhook (separada) - com timeout de 30 segundos
      try {
        console.log('📝 Criando stack N8N Webhook...');
        const webhookContent = getStackTemplate('n8n-webhook', nome, rede, config);
        const webhookName = `n8n-webhook-${nome}`;
        
        const result = await waitWithTimeout(
          createSingleStack(webhookName, webhookContent, swarmId, endpointId, headers),
          30000
        );
        
        if (result.timeout) {
          stacksCreated.push({ 
            name: webhookName, 
            tipo: 'webhook',
            replicas: 2,
            url: `https://webhooks.${nome}.${DOMAIN}`,
            status: 'criado'
          });
          console.log('✅ Stack Webhook enviada (tempo limite atingido, assumindo sucesso)');
        } else {
          stacksCreated.push({ 
            name: webhookName, 
            id: result.Id, 
            tipo: 'webhook',
            replicas: 2,
            url: `https://webhooks.${nome}.${DOMAIN}`,
            status: 'confirmado'
          });
          console.log('✅ Stack Webhook criada com sucesso');
        }
      } catch (error) {
        errors.push({ stack: 'webhook', error: error.message });
        console.error('❌ Erro ao criar stack Webhook:', error.message);
      }

      // 3️⃣ Stack Worker (separada) - com timeout de 30 segundos
      try {
        console.log('📝 Criando stack N8N Worker...');
        const workerContent = getStackTemplate('n8n-worker', nome, rede, config);
        const workerName = `n8n-worker-${nome}`;
        
        const result = await waitWithTimeout(
          createSingleStack(workerName, workerContent, swarmId, endpointId, headers),
          30000
        );
        
        if (result.timeout) {
          stacksCreated.push({ 
            name: workerName, 
            tipo: 'worker',
            concurrency: 10,
            status: 'criado'
          });
          console.log('✅ Stack Worker enviada (tempo limite atingido, assumindo sucesso)');
        } else {
          stacksCreated.push({ 
            name: workerName,id: result.Id, 
            tipo: 'worker',
            concurrency: 10,
            status: 'confirmado'
          });
          console.log('✅ Stack Worker criada com sucesso');
        }
      } catch (error) {
        errors.push({ stack: 'worker', error: error.message });
        console.error('❌ Erro ao criar stack Worker:', error.message);
      }

      // Resposta final
      if (errors.length > 0 && stacksCreated.length === 0) {
        return res.status(500).json({
          success: false,
          message: 'Falha ao criar todas as stacks do N8N',
          errors: errors
        });
      }

      return res.json({
        success: stacksCreated.length > 0,
        message: `N8N '${nome}' criado com ${stacksCreated.length} de 3 stacks`,
        stacksCriadas: stacksCreated.length,
        totalStacks: 3,
        stacks: stacksCreated,
        errors: errors.length > 0 ? errors : undefined,
        urls: {
          editor: `https://editor.${nome}.${DOMAIN}`,
          webhook: `https://webhooks.${nome}.${DOMAIN}`
        }
      });
    }

    return res.status(400).json({
      error: 'Tipo não suportado',
      message: `Os tipos suportados são: redis, n8n`
    });

  } catch (error) {
    console.error('❌ Erro ao criar stack');
    
    if (error.response?.status === 401) {
      console.log('🔄 Token expirado, limpando cache...');
      jwtCache = { token: null, expiresAt: null };
    }

    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Body da resposta:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Erro sem resposta do servidor:', error.message);
    }

    res.status(error.response?.status || 500).json({
      error: 'Erro ao criar stack',
      details: error.response?.data || error.message
    });
  }
});

// ☁️ Endpoint para criar subdomínio na Cloudflare
app.post('/api/cloudflare', authenticateToken, async (req, res) => {
  try {
    const { nome, tipo, ipServidor, content, proxied } = req.body;

    if (!nome || !tipo) {
      return res.status(400).json({ 
        error: 'Campos obrigatórios: nome, tipo',
        exemplos: {
          A: {
            nome: 'redis-app1',
            tipo: 'A',
            ipServidor: '1.2.3.4',
            proxied: true
          },
          CNAME: {
            nome: 'redis-app1',
            tipo: 'CNAME',
            ipServidor: 'new.hostexpert.com.br',
            proxied: false
          }
        }
      });
    }

    const targetValue = ipServidor || content;

    if (!targetValue) {
      return res.status(400).json({ 
        error: 'Campo obrigatório: ipServidor ou content',
        message: 'Informe o IP (tipo A/AAAA) ou domínio (tipo CNAME) para apontar o DNS'
      });
    }

    const tiposPermitidos = ['A', 'AAAA', 'CNAME'];
    const tipoUpper = tipo.toUpperCase();
    
    if (!tiposPermitidos.includes(tipoUpper)) {
      return res.status(400).json({
        error: 'Tipo de registro inválido',
        message: `Tipos permitidos: ${tiposPermitidos.join(', ')}`
      });
    }

    let proxiedValue;
    if (proxied !== undefined) {
      proxiedValue = Boolean(proxied);
    } else {
      proxiedValue = tipoUpper !== 'CNAME';
    }

    if (tipoUpper === 'CNAME') {
      const cleanTarget = targetValue.replace(/^https?:\/\//, '');
      const record = await createCloudflareRecord(nome, tipoUpper, cleanTarget, proxiedValue);
      
      res.json({
        success: true,
        message: `Subdomínio '${nome}.${CLOUDFLARE_DOMAIN}' criado/atualizado com sucesso`,
        subdomain: `${nome}.${CLOUDFLARE_DOMAIN}`,
        target: cleanTarget,
        proxied: proxiedValue,
        recordId: record.id,
        data: record
      });
    } else {
      const record = await createCloudflareRecord(nome, tipoUpper, targetValue, proxiedValue);
      
      res.json({
        success: true,
        message: `Subdomínio '${nome}.${CLOUDFLARE_DOMAIN}' criado/atualizado com sucesso`,
        subdomain: `${nome}.${CLOUDFLARE_DOMAIN}`,
        ip: targetValue,
        proxied: proxiedValue,
        recordId: record.id,
        data: record
      });
    }

  } catch (error) {
    console.error('❌ Erro ao criar subdomínio na Cloudflare');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Body da resposta:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Erro:', error.message);
    }

    res.status(error.response?.status || 500).json({
      error: 'Erro ao criar subdomínio na Cloudflare',
      details: error.response?.data || error.message
    });
  }
});

// 🚇 Endpoint para adicionar hostname ao túnel Cloudflare
app.post('/api/cloudflare/tunnel', authenticateToken, async (req, res) => {
  try {
    const { hostname, service, port = 80, protocol = 'http' } = req.body;

    if (!hostname || !service) {
      return res.status(400).json({ 
        error: 'Campos obrigatórios: hostname, service',
        exemplos: {
          'N8N Editor': {
            hostname: 'editor.cliente1',
            service: 'http://n8n_editor_cliente1:5678',
            description: `Será criado: editor.cliente1.${DOMAIN}`
          },
          'N8N Webhook': {
            hostname: 'webhooks.cliente1',
            service: 'http://n8n_webhook_cliente1:5678',
            description: `Será criado: webhooks.cliente1.${DOMAIN}`
          },
          'Redis': {
            hostname: 'redis-app1',
            service: 'tcp://redis-app1:6379',
            description: `Será criado: redis-app1.${DOMAIN}`
          },
          'Com porta customizada': {
            hostname: 'app',
            service: 'myservice',
            port: 8080,
            protocol: 'http',
            description: `Será criado: app.${DOMAIN}`
          }
        }
      });
    }

    // Adiciona o DOMAIN ao hostname se não estiver presente
    const fullHostname = hostname.includes('.') && hostname.split('.').length > 2 
      ? hostname 
      : `${hostname}.${DOMAIN}`;

    // Se o service não contém protocolo, adiciona automaticamente
    let serviceUrl = service;
    if (!service.includes('://')) {
      serviceUrl = `${protocol}://${service}:${port}`;
    }

    const result = await addHostnameToTunnel(fullHostname, serviceUrl);

    res.json({
      success: true,
      message: `Hostname '${fullHostname}' adicionado ao túnel com sucesso`,
      hostname: fullHostname,
      hostnameInformado: hostname,
      service: serviceUrl,
      tunnelId: result.tunnelId,
      data: result
    });

  } catch (error) {
    console.error('❌ Erro ao adicionar hostname ao túnel');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Body da resposta:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Erro:', error.message);
    }

    res.status(error.response?.status || 500).json({
      error: 'Erro ao adicionar hostname ao túnel Cloudflare',
      details: error.response?.data || error.message
    });
  }
});

// Endpoint para listar stacks
app.get('/api/stacks', authenticateToken, async (req, res) => {
  try {
    const headers = await getPortainerHeaders();
    
    const response = await axios.get(`${PORTAINER_URL}/api/stacks`, {
      headers,
      httpsAgent
    });

    res.json({ success: true, stacks: response.data });
  } catch (error) {
    console.error('Erro ao listar stacks:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      jwtCache = { token: null, expiresAt: null };
    }

    res.status(error.response?.status || 500).json({
      error: 'Erro ao listar stacks',
      details: error.response?.data || error.message
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    portainerAuth: jwtCache.token ? 'authenticated' : 'not_authenticated',
    cloudflareConfigured: !!(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ZONE_ID && CLOUDFLARE_DOMAIN),
    cloudflareTunnelConfigured: !!(CLOUDFLARE_TUNNEL_ID && CLOUDFLARE_ACCOUNT_ID)
  });
});

// Listar tipos
app.get('/api/tipos', (req, res) => {
  res.json({
    servicos: {
      redis: {
        endpoint: '/api/stack',
        exemplo: {
          nome: 'meu-app',
          tipo: 'redis',
          rede: 'network_public',
          porta: 6379
        }
      },
      n8n: {
        endpoint: '/api/stack',
        exemplo: {
          nome: 'cliente1',
          tipo: 'n8n',
          rede: 'network_public',
          config: {
            postgresHost: 'postgres-host',
            postgresDb: 'n8n_db',
            postgresPassword: 'senha-segura',
            redisHost: 'redis-host',
            redisPort: '6379',
            redisPassword: 'senha-redis',
            versaoN8n: 'latest'
          }
        },
        observacao: 'Cria 3 stacks separadas automaticamente: n8n-editor-{nome}, n8n-webhook-{nome}, n8n-worker-{nome}. Timeout de 30 segundos por stack.'
      },
      cloudflare_dns: {
        endpoint: '/api/cloudflare',
        exemplos: {
          A: {
            nome: 'redis-app1',
            tipo: 'A',
            ipServidor: '1.2.3.4'
          },
          CNAME: {
            nome: 'redis-app1',
            tipo: 'CNAME',
            ipServidor: 'new.hostexpert.com.br'
          }
        }
      },
      cloudflare_tunnel: {
        endpoint: '/api/cloudflare/tunnel',
        exemplos: {
          n8n_editor: {
            hostname: 'editor.cliente1',
            service: 'http://n8n_editor_cliente1:5678',
            description: `Hostname completo será: editor.cliente1.${DOMAIN}`
          },
          n8n_webhook: {
            hostname: 'webhooks.cliente1',
            service: 'http://n8n_webhook_cliente1:5678',
            description: `Hostname completo será: webhooks.cliente1.${DOMAIN}`
          }
        },
        observacao: `Adiciona hostname ao túnel Cloudflare. O domínio ${DOMAIN} será adicionado automaticamente`
      }
    }
  });
});

// Status da autenticação
app.get('/api/auth/status', authenticateToken, (req, res) => {
  res.json({
    authenticated: !!jwtCache.token,
    expiresAt: jwtCache.expiresAt ? new Date(jwtCache.expiresAt).toISOString() : null,
    timeRemaining: jwtCache.expiresAt ? Math.max(0, jwtCache.expiresAt - Date.now()) : 0
  });
});

// Forçar reautenticação
app.post('/api/auth/refresh', authenticateToken, async (req, res) => {
  try {
    jwtCache = { token: null, expiresAt: null };
    const jwt = await authenticatePortainer();
    
    res.json({
      success: true,
      message: 'Autenticação renovada com sucesso',
      expiresAt: new Date(jwtCache.expiresAt).toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: 'Erro ao renovar autenticação',
      details: error.message
    });
  }
});

// Inicialização do servidor
const startServer = async () => {
  try {
    if (!PORTAINER_USERNAME || !PORTAINER_PASSWORD) {
      console.error('❌ ERRO: PORTAINER_USERNAME e PORTAINER_PASSWORD são obrigatórios!');
      process.exit(1);
    }

    await authenticatePortainer();

    app.listen(PORT, () => {
      console.log(`\n🌀 version: 3.0.3`);
      console.log(`🚀 API rodando na porta ${PORT}`);
      console.log(`📦 Portainer URL: ${PORTAINER_URL}`);
      console.log(`👤 Usuário Portainer: ${PORTAINER_USERNAME}`);
      console.log(`🔐 Autenticação Portainer: JWT Automático ✅`);
      console.log(`🌐 Endpoint ID padrão: ${PORTAINER_ENDPOINT_ID}`);
      console.log(`🐳 Modo Docker: ${process.env.DOCKER_ENV || false}`);
      console.log(`🔐 Auth Token API: ${AUTH_TOKEN ? '✅' : '❌'}`);
      console.log(`🌍 Domínio principal: ${DOMAIN || 'Não configurado'}`);

      console.log(`\n☁️ Cloudflare:`);
      console.log(`   Token: ${CLOUDFLARE_API_TOKEN ? '✅' : '❌'}`);
      console.log(`   Zone ID: ${CLOUDFLARE_ZONE_ID ? '✅' : '❌'}`);
      console.log(`   Account ID: ${CLOUDFLARE_ACCOUNT_ID ? '✅' : '❌'}`);
      console.log(`   Tunnel ID: ${CLOUDFLARE_TUNNEL_ID ? '✅' : '❌'}`);
      console.log(`   Domínio: ${CLOUDFLARE_DOMAIN || 'Não configurado'}`);

      console.log(`\n📝 Endpoints disponíveis:`);
      console.log(`   POST   /api/stack - Criar stack Redis ou N8N (3 stacks separadas)`);
      console.log(`   POST   /api/cloudflare - Criar subdomínio na Cloudflare (DNS)`);
      console.log(`   POST   /api/cloudflare/tunnel - Adicionar hostname ao túnel Cloudflare`);
      console.log(`   GET    /api/stacks - Listar stacks`);
      console.log(`   GET    /api/tipos - Listar serviços disponíveis`);
      console.log(`   GET    /api/auth/status - Status da autenticação`);
      console.log(`   POST   /api/auth/refresh - Renovar autenticação`);
      console.log(`   GET    /health - Health check`);

      console.log(`\n🎯 Tipos de stack suportados:`);
      console.log(`   - redis: Stack Redis standalone`);
      console.log(`   - n8n: Cria 3 stacks separadas (editor, webhook, worker)`);
      console.log(`   - ⏱️  Timeout: 30 segundos por stack N8N`);

      console.log(`\n🚇 Cloudflare Tunnel:`);
      console.log(`   - Use /api/cloudflare/tunnel para adicionar hostnames ao túnel`);
      console.log(`   - O domínio ${DOMAIN} será adicionado automaticamente aos hostnames`);
    });

  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error.message);
    process.exit(1);
  }
};

startServer();