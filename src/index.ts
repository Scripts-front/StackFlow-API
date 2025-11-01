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
const PORTAINER_API_KEY = process.env.PORTAINER_API_KEY || ''; // API Key
const PORTAINER_JWT = process.env.PORTAINER_JWT || ''; // JWT (Bearer)
const PORTAINER_ENDPOINT_ID = parseInt(process.env.PORTAINER_ENDPOINT_ID) || 1;
const AUTH_TOKEN = process.env.AUTH_TOKEN ;
const DOMAIN = process.env.DOMAIN ; 

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Middleware de autenticação
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

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
const getStackTemplate = (tipo, nome, rede, porta = 6379) => {
  switch (tipo.toLowerCase()) {
    case 'redis':
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
    default:
      throw new Error(`Tipo de stack '${tipo}' não suportado`);
  }
};

// Endpoint para criar stack com Swarm ID usando API Key
app.post('/api/stack', authenticateToken, async (req, res) => {
  try {
    const { nome, tipo, rede, porta, endpointId = PORTAINER_ENDPOINT_ID } = req.body;

    if (!nome || !tipo || !rede) {
      return res.status(400).json({ error: 'Campos obrigatórios: nome, tipo, rede' });
    }

    // Validação de porta
    const portaFinal = porta || 6379;
    if (portaFinal < 1024 || portaFinal > 65535) {
      return res.status(400).json({ 
        error: 'Porta inválida', 
        message: 'A porta deve estar entre 1024 e 65535' 
      });
    }

    // 1️⃣ Pegar Swarm ID do endpoint (API Key)
    console.log('📡 Buscando Swarm ID...');
    const swarmResponse = await axios.get(`${PORTAINER_URL}/api/endpoints/${endpointId}/docker/swarm`, {
      headers: { 'X-API-Key': PORTAINER_API_KEY },
      httpsAgent
    });

    const swarmId = swarmResponse.data.ID; // ID do Swarm
    console.log('🆔 Swarm ID encontrado:', swarmId);

    // 2️⃣ Gera o template da stack
    const stackContent = getStackTemplate(tipo, nome, rede, portaFinal);
    console.log('📄 Template gerado para tipo:', tipo);
    console.log('🔌 Porta exposta:', portaFinal);

    const stackName = tipo.toLowerCase() === 'redis'
  ? `redis-${nome}-${portaFinal}`
  : nome;

      // 3️⃣ Payload incluindo SwarmID
  const payload = {
    name: stackName,         
    stackFileContent: stackContent,
    env: [],
    swarmID: swarmId
  };

    // 4️⃣ URL corrigida para criação de stacks (remover parâmetro 'method')
    const url = `${PORTAINER_URL}/api/stacks/create/swarm/string?endpointId=${endpointId}`;
    
    console.log('🔗 URL de criação:', url);
    console.log('📦 Payload:', JSON.stringify({ ...payload, stackFileContent: '[TEMPLATE OMITIDO]' }, null, 2));

    const response = await axios.post(url, payload, {
      headers: {
        'X-API-Key': PORTAINER_API_KEY,
        'Content-Type': 'application/json'
      },
      httpsAgent
    });

    console.log('✅ Stack criada com sucesso:', response.data);

    res.json({
      success: true,
      message: `Stack '${nome}' do tipo '${tipo}' criada com sucesso`,
      stackId: response.data.Id,
      porta: portaFinal,
      data: response.data
    });

  } catch (error) {
    console.error('❌ Erro ao criar stack');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Headers da resposta:', error.response.headers);
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

// Endpoint para listar stacks usando JWT se fornecido
app.get('/api/stacks', authenticateToken, async (req, res) => {
  try {
    const headers = PORTAINER_JWT
      ? { 'Authorization': `Bearer ${PORTAINER_JWT}` }
      : { 'X-API-Key': PORTAINER_API_KEY };

    const response = await axios.get(`${PORTAINER_URL}/api/stacks`, {
      headers,
      httpsAgent
    });

    res.json({ success: true, stacks: response.data });
  } catch (error) {
    console.error('Erro ao listar stacks:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Erro ao listar stacks',
      details: error.response?.data || error.message
    });
  }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Listar tipos
app.get('/api/tipos', (req, res) => {
  res.json({
    tipos: ['redis'],
    exemplo: { 
      nome: 'meu-app', 
      tipo: 'redis', 
      rede: 'network_public',
      porta: 6379  // opcional, padrão: 6379
    }
  });
});

// Inicialização do servidor
app.listen(PORT, () => {
  console.log(`\n🌀 version: 1.1.2`);
  console.log(`🚀 API rodando na porta ${PORT}`);
  console.log(`📦 Portainer URL: ${PORTAINER_URL}`);
  console.log(`🔑 API Key configurada: ${PORTAINER_API_KEY ? '✅' : '❌'}`);
  console.log(`🔑 JWT configurado: ${PORTAINER_JWT ? '✅' : '❌'}`);
  console.log(`🌐 Endpoint ID padrão: ${PORTAINER_ENDPOINT_ID}`);
  console.log(`🐳 Modo Docker: ${process.env.DOCKER_ENV ? '✅' : '❌'}`);
  console.log(`🔐 Autenticação: ${AUTH_TOKEN ? '✅ Ativa' : '❌ Desativada'}`);
  console.log(`\n📝 Endpoints disponíveis:`);
  console.log(`   POST   /api/stack - Criar stack`);
  console.log(`   GET    /api/stacks - Listar stacks`);
  console.log(`   GET    /api/tipos - Listar tipos disponíveis`);
  console.log(`   GET    /health - Health check`);
});