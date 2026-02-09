require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const OpenAI = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');

const app = express();
const PORT = process.env.PORT || 3000;

// Cliente OpenAI
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// Cliente Pinecone
let pineconeIndex = null;
async function initPinecone() {
  if (process.env.PINECONE_API_KEY && process.env.PINECONE_INDEX) {
    try {
      const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
      pineconeIndex = pinecone.index(process.env.PINECONE_INDEX);
      console.log('✅ Pinecone conectado correctamente');
    } catch (error) {
      console.error('❌ Error conectando a Pinecone:', error.message);
    }
  }
}
initPinecone();

// Prompt del sistema para el asistente
const SYSTEM_PROMPT = `Eres un asistente amigable de El Huerto Deitana. Habla de forma natural y cercana, como un experto en jardinería que ayuda a un cliente.

CÓMO RESPONDER:
- Habla de forma natural, no como un robot. Usa un tono conversacional y cálido.
- Si te preguntan por un producto, preséntalo de forma atractiva, destacando sus beneficios.
- Usa la información EXACTA del contexto (descripción, precio, stock). No inventes nada.
- Si hay varios productos relevantes, recomienda el mejor según la consulta.
- Puedes dar consejos de jardinería relacionados si es apropiado.
- Si no encuentras lo que buscan, sugiéreles contactar la tienda.

INFORMACIÓN A INCLUIR:
- Nombre del producto
- Precio (usa el precioWeb)
- Descripción del producto (si existe, úsala tal cual)
- Disponibilidad (stock web)

Responde siempre en español y sé conciso pero informativo.`;

// Configuración de CORS
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    return callback(null, true);
  },
  credentials: true
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Almacenamiento de conversaciones
const conversations = new Map();

// Función para generar embedding con OpenAI (512 dimensiones para coincidir con Pinecone)
async function getEmbedding(text) {
  if (!openai) return null;
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      dimensions: 512
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error('Error generando embedding:', error.message);
    return null;
  }
}

// Función para buscar productos en Pinecone
async function searchProducts(query, topK = 5) {
  if (!pineconeIndex || !openai) return [];
  
  try {
    const embedding = await getEmbedding(query);
    if (!embedding) return [];

    const results = await pineconeIndex.query({
      vector: embedding,
      topK: topK,
      includeMetadata: true
    });

    return results.matches.map(match => ({
      id: match.id,
      score: match.score,
      ...match.metadata
    }));
  } catch (error) {
    console.error('Error buscando en Pinecone:', error.message);
    return [];
  }
}

// Función para formatear productos como contexto
function formatProductsContext(products) {
  if (!products || products.length === 0) {
    return 'No se encontraron productos relevantes para esta consulta.';
  }

  return products.map((p, i) => {
    let info = `PRODUCTO ${i + 1}:\n`;
    info += `- Nombre: ${p.nombreWeb || p.nombre || 'Sin nombre'}\n`;
    if (p.descripcion) info += `- Descripción: ${p.descripcion}\n`;
    if (p.precioWeb) info += `- Precio web: €${parseFloat(p.precioWeb).toFixed(2)}\n`;
    if (p.stockWeb !== undefined) info += `- Stock disponible online: ${p.stockWeb} unidades\n`;
    if (p.estadoWeb) info += `- Estado: ${p.estadoWeb}\n`;
    return info;
  }).join('\n');
}

// Endpoint de configuración
app.get('/api/config', (req, res) => {
  res.json({
    botName: process.env.BOT_NAME || 'Huerto IA',
    welcomeMessage: process.env.BOT_WELCOME_MESSAGE || '¡Hola! Soy el asistente de El Huerto Deitana. ¿En qué puedo ayudarte?',
    primaryColor: process.env.PRIMARY_COLOR || '#8B7355',
    position: 'right'
  });
});

// Endpoint principal del chat
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    console.log(`\n📩 Mensaje recibido: "${message}"`);

    if (!message) {
      console.log('❌ Mensaje vacío');
      return res.status(400).json({ error: 'El mensaje es requerido' });
    }

    if (!openai) {
      console.log('❌ OpenAI no configurado');
      return res.status(500).json({ error: 'API Key de OpenAI no configurada' });
    }

    // Buscar productos relevantes en Pinecone
    console.log('🔍 Buscando productos en Pinecone...');
    const products = await searchProducts(message, 5);
    console.log(`📦 Productos encontrados: ${products.length}`);
    if (products.length > 0) {
      console.log('📋 Productos:', products.map(p => p.nombreWeb || p.nombre).join(', '));
    }
    const productsContext = formatProductsContext(products);
    console.log('📄 Contexto:\n', productsContext);

    // Historial de conversación
    const conversationId = sessionId || 'default';
    if (!conversations.has(conversationId)) {
      conversations.set(conversationId, []);
    }
    const conversationHistory = conversations.get(conversationId);

    // Agregar mensaje del usuario
    conversationHistory.push({
      role: 'user',
      content: message
    });

    // Mantener últimos 10 mensajes
    const recentHistory = conversationHistory.slice(-10);

    // Crear mensajes para OpenAI
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'system', content: `PRODUCTOS ENCONTRADOS PARA ESTA CONSULTA:\n\n${productsContext}` },
      ...recentHistory
    ];

    // Llamar a OpenAI
    console.log('🤖 Llamando a OpenAI...');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      max_tokens: 600,
      temperature: 0.5
    });

    const assistantMessage = completion.choices[0].message.content;
    console.log('✅ Respuesta generada');

    // Guardar respuesta
    conversationHistory.push({
      role: 'assistant',
      content: assistantMessage
    });

    res.json({
      message: assistantMessage,
      sessionId: conversationId
    });

  } catch (error) {
    console.error('❌ Error en chat:', error.message);
    res.status(500).json({ 
      error: 'Error al procesar el mensaje',
      details: error.message 
    });
  }
});

// Limpiar conversación
app.post('/api/chat/clear', (req, res) => {
  const { sessionId } = req.body;
  conversations.delete(sessionId || 'default');
  res.json({ success: true });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    pinecone: pineconeIndex ? 'connected' : 'not connected',
    openai: openai ? 'configured' : 'not configured'
  });
});

app.get('/embed.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'embed.js'));
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`🤖 OpenAI: ${openai ? 'Configurado' : 'No configurado'}`);
  console.log(`📦 Widget: http://localhost:${PORT}/embed.js`);
});
