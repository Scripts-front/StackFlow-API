const express = require('express');
const axios = require('axios');

// Carrega .env apenas se não estiver usando Docker
if (!process.env.DOCKER_ENV) {
  require('dotenv').config();
}

const app = express();

app.use(express.json());

// Configurações do Portainer
const PORT = process.env.PORT || 3000;
const PORTAINER_URL = process.env.PORTAINER_URL || 'http://localhost:9000';
const PORTAINER_TOKEN = process.env.PORTAINER_TOKEN || 'seu-token-aqui';
const PORTAINER_ENDPOINT_ID = parseInt(process.env.PORTAINER_ENDPOINT_ID) || 1;
const AUTH_TOKEN = process.env.AUTH_TOKEN;

// Middleware de autenticação
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!AUTH_TOKEN) {
    // Se não houver token configurado, permite acesso
    return next();
  }

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

// Templates das stacks
const getStackTemplate = (tipo, nome, rede) => {
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
      - 6379:6379
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
        - traefik.http.routers.redis-${nome}.rule=Host(\`redis-${nome}.hostexpert.com.br\`)
        - traefik.http.routers.redis-${nome}.entrypoints=websecure
        - traefik.http.routers.redis-${nome}.tls.certresolver=letsencryptresolver
        - traefik.http.routers.redis-${nome}.service=redis-${nome}
        - traefik.http.services.redis-${nome}.loadbalancer.server.port=6379
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
    const { nome, tipo, rede, endpointId = PORTAINER_ENDPOINT_ID } = req.body;

    // Validação
    if (!nome || !tipo || !rede) {
      return res.status(400).json({
        error: 'Campos obrigatórios: nome, tipo, rede'
      });
    }

    // Gera o template da stack
    const stackContent = getStackTemplate(tipo, nome, rede);

    // Payload para o Portainer
    const payload = {
      name: nome,
      stackFileContent: stackContent,
      env: []
    };

    // Envia para o Portainer
    const response = await axios.post(
      `${PORTAINER_URL}/api/stacks?type=1&method=string&endpointId=${endpointId}`,
      payload,
      {
        headers: {
          'X-API-Key': PORTAINER_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      success: true,
      message: `Stack '${nome}' do tipo '${tipo}' criada com sucesso`,
      stackId: response.data.Id,
      data: response.data
    });

  } catch (error) {
    console.error('Erro ao criar stack:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Erro ao criar stack',
      details: error.response?.data || error.message
    });
  }
});

// Endpoint para listar stacks
app.get('/api/stacks', authenticateToken, async (req, res) => {
  try {
    const response = await axios.get(
      `${PORTAINER_URL}/api/stacks`,
      {
        headers: {
          'X-API-Key': PORTAINER_TOKEN
        }
      }
    );

    res.json({
      success: true,
      stacks: response.data
    });

  } catch (error) {
    console.error('Erro ao listar stacks:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Erro ao listar stacks',
      details: error.response?.data || error.message
    });
  }
});

// Endpoint de health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Endpoint para listar tipos disponíveis
app.get('/api/tipos', (req, res) => {
  res.json({
    tipos: ['redis'],
    exemplo: {
      nome: 'meu-app',
      tipo: 'redis',
      rede: 'network_public'
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 API rodando na porta ${PORT}`);
  console.log(`📦 Portainer URL: ${PORTAINER_URL}`);
  console.log(`🔑 Token configurado: ${PORTAINER_TOKEN ? '✅' : '❌'}`);
  console.log(`🌐 Endpoint ID padrão: ${PORTAINER_ENDPOINT_ID}`);
  console.log(`🐳 Modo Docker: ${process.env.DOCKER_ENV ? '✅' : '❌'}`);
  console.log(`🔐 Autenticação: ${AUTH_TOKEN ? '✅ Ativa' : '❌ Desativada'}`);
  console.log(`\n📝 Endpoints disponíveis:`);
  console.log(`   POST   /api/stack - Criar stack`);
  console.log(`   GET    /api/stacks - Listar stacks`);
  console.log(`   GET    /api/tipos - Listar tipos disponíveis`);
  console.log(`   GET    /health - Health check`);
  console.log(`\n💡 Exemplo de uso:`);
  console.log(`   curl -X POST http://localhost:${PORT}/api/stack -H "Content-Type: application/json" -d '{"nome":"teste","tipo":"redis","rede":"network_public"}'`);
});