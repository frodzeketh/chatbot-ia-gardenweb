require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const OpenAI = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');

const app = express();
const PORT = process.env.PORT || 3000;

// Cliente OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Cliente Pinecone
let pineconeIndex = null;
async function initPinecone() {
  if (process.env.PINECONE_API_KEY && process.env.PINECONE_INDEX) {
    try {
      const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
      pineconeIndex = pinecone.index(process.env.PINECONE_INDEX);
      console.log('✅ Pinecone conectado');
    } catch (error) {
      console.error('❌ Error Pinecone:', error.message);
    }
  }
}
initPinecone();

// Prompt del sistema
const SYSTEM_PROMPT = `Eres el asistente virtual de El Huerto Deitana, un vivero especializado en plantas de huerto.

INFORMACIÓN DEL NEGOCIO:
- Nombre: El Huerto Deitana
- Dirección: Ctra. Mazarrón, km 2,4 - 30850 Totana, Murcia, España
- Teléfono: 968 422 335
- Email: info@plantasdehuerto.com

INSTRUCCIONES:
- Responde siempre en español de forma amable y profesional.
- Si te saludan, saluda de vuelta.
- Si preguntan por contacto/ubicación, da la información del negocio.
- Si hay productos en el CONTEXTO, úsalos para responder. Muestra nombre, precio y disponibilidad.
- Si preguntan por un producto y NO está en el contexto, sugiere contactar a la tienda para consultar disponibilidad.
- NUNCA inventes productos ni precios.`;

// CORS
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Almacenamiento de conversaciones
const conversations = new Map();

// Generar embedding
async function getEmbedding(text) {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    dimensions: 512
  });
  return response.data[0].embedding;
}

// Buscar en Pinecone
async function searchProducts(query) {
  if (!pineconeIndex) return [];
  
  try {
    const embedding = await getEmbedding(query);
    const results = await pineconeIndex.query({
      vector: embedding,
      topK: 5,
      includeMetadata: true
    });

    return results.matches
      .filter(m => m.score > 0.3)
      .map(m => m.metadata);
  } catch (error) {
    console.error('Error buscando:', error.message);
    return [];
  }
}

// Formatear productos
function formatProducts(products) {
  if (!products.length) return '';
  
  return '\n\nCONTEXTO - Productos encontrados:\n' + products.map((p, i) => 
    `${i + 1}. ${p.nombreWeb || p.nombre} - €${parseFloat(p.precioWeb || 0).toFixed(2)} - Stock: ${p.stockWeb || 0}`
  ).join('\n');
}

// Config endpoint
app.get('/api/config', (req, res) => {
  res.json({
    botName: process.env.BOT_NAME || 'Huerto Deitana IA',
    welcomeMessage: process.env.BOT_WELCOME_MESSAGE || '¡Hola! Soy el asistente de El Huerto Deitana. ¿En qué puedo ayudarte?',
    primaryColor: process.env.PRIMARY_COLOR || '#4A7C59'
  });
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: 'Mensaje requerido' });

    // Buscar productos relevantes
    const products = await searchProducts(message);
    const context = formatProducts(products);

    // Historial
    const convId = sessionId || 'default';
    if (!conversations.has(convId)) conversations.set(convId, []);
    const history = conversations.get(convId);
    
    history.push({ role: 'user', content: message });

    // Llamar a OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + context },
        ...history.slice(-10)
      ],
      max_tokens: 500,
      temperature: 0.7
    });

    const reply = completion.choices[0].message.content;
    history.push({ role: 'assistant', content: reply });

    res.json({ message: reply, sessionId: convId });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: 'Error procesando mensaje' });
  }
});

// Limpiar chat
app.post('/api/chat/clear', (req, res) => {
  conversations.delete(req.body.sessionId || 'default');
  res.json({ success: true });
});

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);
});
