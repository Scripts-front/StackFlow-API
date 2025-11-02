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
  // Se tem token em cache e ainda é válido
  if (jwtCache.token && jwtCache.expiresAt > Date.now()) {
    return jwtCache.token;
  }

  // Caso contrário, autentica novamente
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

// Endpoint para criar stack
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

    // 1️⃣ Obter headers com JWT válido
    const headers = await getPortainerHeaders();

    // 2️⃣ Pegar Swarm ID do endpoint
    console.log('📡 Buscando Swarm ID...');
    
    const swarmResponse = await axios.get(
      `${PORTAINER_URL}/api/endpoints/${endpointId}/docker/swarm`,
      { headers, httpsAgent }
    );

    const swarmId = swarmResponse.data.ID;
    console.log('🆔 Swarm ID encontrado:', swarmId);

    // 3️⃣ Gera o template da stack
    const stackContent = getStackTemplate(tipo, nome, rede, portaFinal);
    console.log('📄 Template gerado para tipo:', tipo);
    console.log('🔌 Porta exposta:', portaFinal);

    const stackName = tipo.toLowerCase() === 'redis'
      ? `redis-${nome}-${portaFinal}`
      : nome;

    // 4️⃣ Payload incluindo SwarmID
    const payload = {
      name: stackName,
      stackFileContent: stackContent,
      env: [],
      swarmID: swarmId
    };

    // 5️⃣ Criar stack
    const url = `${PORTAINER_URL}/api/stacks/create/swarm/string?endpointId=${endpointId}`;
    
    console.log('🔗 URL de criação:', url);
    console.log('📦 Payload:', JSON.stringify({ ...payload, stackFileContent: '[TEMPLATE OMITIDO]' }, null, 2));

    const response = await axios.post(url, payload, {
      headers,
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
    
    // Se o erro for de autenticação, limpa o cache e tenta novamente
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
    
    // Se o erro for de autenticação, limpa o cache
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
    portainerAuth: jwtCache.token ? 'authenticated' : 'not_authenticated'
  });
});

// Listar tipos
app.get('/api/tipos', (req, res) => {
  res.json({
    tipos: ['redis'],
    exemplo: {
      nome: 'meu-app',
      tipo: 'redis',
      rede: 'network_public',
      porta: 6379
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
    // Valida credenciais obrigatórias
    if (!PORTAINER_USERNAME || !PORTAINER_PASSWORD) {
      console.error('❌ ERRO: PORTAINER_USERNAME e PORTAINER_PASSWORD são obrigatórios!');
      process.exit(1);
    }

    // Tenta autenticar no início
    await authenticatePortainer();

    app.listen(PORT, () => {
      console.log(`\n🌀 version: 2.0.0`);
      console.log(`🚀 API rodando na porta ${PORT}`);
      console.log(`📦 Portainer URL: ${PORTAINER_URL}`);
      console.log(`👤 Usuário Portainer: ${PORTAINER_USERNAME}`);
      console.log(`🔐 Autenticação: JWT Automático ✅`);
      console.log(`🌐 Endpoint ID padrão: ${PORTAINER_ENDPOINT_ID}`);
      console.log(`🐳 Modo Docker: ${process.env.DOCKER_ENV || false}`);
      console.log(`🔐 Auth Token API: ${AUTH_TOKEN ? '✅' : '❌'}`);
      console.log(`\n📝 Endpoints disponíveis:`);
      console.log(`   POST   /api/stack - Criar stack`);
      console.log(`   GET    /api/stacks - Listar stacks`);
      console.log(`   GET    /api/tipos - Listar tipos disponíveis`);
      console.log(`   GET    /api/auth/status - Status da autenticação`);
      console.log(`   POST   /api/auth/refresh - Renovar autenticação`);
      console.log(`   GET    /health - Health check`);
    });

  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error.message);
    process.exit(1);
  }
};

startServer();