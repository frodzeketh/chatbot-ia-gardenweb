require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

// Cliente OpenAI (solo se crea si hay API key, para poder arrancar el servidor en local sin key)
function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// Configuración de CORS
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : [];

app.use(cors({
  origin: function(origin, callback) {
    // Permitir requests sin origin (como curl o Postman)
    if (!origin) return callback(null, true);
    
    // Si no hay orígenes configurados, permitir todos
    if (allowedOrigins.length === 0) return callback(null, true);
    
    // Verificar si el origen está permitido
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    return callback(new Error('No permitido por CORS'), false);
  },
  credentials: true
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Almacenamiento temporal de conversaciones (en producción usar Redis/DB)
const conversations = new Map();

// Endpoint de configuración del widget
app.get('/api/config', (req, res) => {
  res.json({
    botName: process.env.BOT_NAME || 'Asistente Virtual',
    welcomeMessage: process.env.BOT_WELCOME_MESSAGE || '¡Hola! ¿En qué puedo ayudarte?',
    primaryColor: process.env.PRIMARY_COLOR || '#4F46E5',
    position: process.env.WIDGET_POSITION || 'right'
  });
});

// Endpoint principal del chat
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'El mensaje es requerido' });
    }

    const openai = getOpenAIClient();
    if (!openai) {
      return res.status(500).json({ error: 'API Key de OpenAI no configurada. Crea un archivo .env con OPENAI_API_KEY=tu-key' });
    }

    // Obtener o crear historial de conversación
    const conversationId = sessionId || 'default';
    if (!conversations.has(conversationId)) {
      conversations.set(conversationId, []);
    }
    const conversationHistory = conversations.get(conversationId);

    // Agregar mensaje del usuario al historial
    conversationHistory.push({
      role: 'user',
      content: message
    });

    // Mantener solo los últimos 20 mensajes para no exceder tokens
    const recentHistory = conversationHistory.slice(-20);

    // Crear mensajes para OpenAI
    const messages = [
      {
        role: 'system',
        content: process.env.SYSTEM_PROMPT || 'Eres un asistente virtual amable y profesional. Responde de forma clara y concisa en español.'
      },
      ...recentHistory
    ];

    // Llamar a OpenAI (openai ya validado arriba)
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      max_tokens: 500,
      temperature: 0.7
    });

    const assistantMessage = completion.choices[0].message.content;

    // Guardar respuesta en historial
    conversationHistory.push({
      role: 'assistant',
      content: assistantMessage
    });

    res.json({
      message: assistantMessage,
      sessionId: conversationId
    });

  } catch (error) {
    console.error('Error en chat:', error);
    
    if (error.code === 'invalid_api_key') {
      return res.status(401).json({ error: 'API Key de OpenAI inválida' });
    }
    
    res.status(500).json({ 
      error: 'Error al procesar el mensaje',
      details: error.message 
    });
  }
});

// Endpoint para limpiar conversación
app.post('/api/chat/clear', (req, res) => {
  const { sessionId } = req.body;
  const conversationId = sessionId || 'default';
  conversations.delete(conversationId);
  res.json({ success: true });
});

// Health check para Railway
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Servir el widget embed
app.get('/embed.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'embed.js'));
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor del chatbot corriendo en puerto ${PORT}`);
  console.log(`📦 Widget disponible en: http://localhost:${PORT}/embed.js`);
});
