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
  } else {
    console.log('⚠️ Pinecone no configurado');
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
- Si te saludan, saluda de vuelta amablemente.
- Si preguntan por contacto/ubicación, da la información del negocio.
- Cuando el usuario pregunte por productos, plantas o artículos, USA LA INFORMACIÓN DE {ARTICULOS} para responder.
- Muestra los productos con su nombre, descripción, precio y disponibilidad.
- Si {ARTICULOS} está vacío o no hay productos relevantes, sugiere contactar a la tienda.
- NUNCA inventes productos ni precios. Solo usa lo que está en {ARTICULOS}.`;

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
  if (!pineconeIndex) {
    console.log('⚠️ Pinecone no disponible');
    return [];
  }
  
  try {
    console.log(`🔍 Buscando: "${query}"`);
    const embedding = await getEmbedding(query);
    const results = await pineconeIndex.query({
      vector: embedding,
      topK: 8,
      includeMetadata: true
    });

    console.log(`📦 Resultados: ${results.matches?.length || 0}`);
    
    // Log estructura del primer resultado para debug
    if (results.matches?.length > 0) {
      console.log('🔎 Estructura metadata:', JSON.stringify(results.matches[0].metadata, null, 2));
    }
    
    // Sin filtro de score - devolver todos los resultados
    const products = results.matches?.map(m => ({
      score: m.score,
      ...m.metadata
    })) || [];
    
    return products;
  } catch (error) {
    console.error('❌ Error buscando:', error.message);
    return [];
  }
}

// Formatear productos - usa todos los campos disponibles
function formatProducts(products) {
  if (!products || products.length === 0) {
    return '\n\n{ARTICULOS}: No se encontraron productos.';
  }
  
  const formatted = products.map((p, i) => {
    // Obtener nombre del campo que exista
    const nombre = p.nombreWeb || p.nombre || p.name || p.title || p.producto || Object.values(p).find(v => typeof v === 'string' && v.length > 2) || 'Producto';
    
    let info = `\n[PRODUCTO ${i + 1}]`;
    info += `\nNombre: ${nombre}`;
    
    // Añadir todos los campos disponibles
    for (const [key, value] of Object.entries(p)) {
      if (key === 'score') continue; // Skip score
      if (key.toLowerCase().includes('nombre') || key === 'name' || key === 'title') continue; // Ya lo pusimos
      if (value !== null && value !== undefined && value !== '') {
        info += `\n${key}: ${value}`;
      }
    }
    return info;
  }).join('\n');
  
  return `\n\n{ARTICULOS} - ${products.length} productos encontrados:${formatted}`;
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

    console.log(`\n💬 Usuario: "${message}"`);

    // Buscar productos relevantes
    const products = await searchProducts(message);
    const articulos = formatProducts(products);

    // Historial
    const convId = sessionId || 'default';
    if (!conversations.has(convId)) conversations.set(convId, []);
    const history = conversations.get(convId);
    
    history.push({ role: 'user', content: message });

    // Construir prompt completo
    const fullPrompt = SYSTEM_PROMPT + articulos;

    // Llamar a OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: fullPrompt },
        ...history.slice(-10)
      ],
      max_tokens: 600,
      temperature: 0.7
    });

    const reply = completion.choices[0].message.content;
    console.log(`🤖 Bot: "${reply.substring(0, 100)}..."`);
    
    history.push({ role: 'assistant', content: reply });

    res.json({ message: reply, sessionId: convId });

  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ error: 'Error procesando mensaje' });
  }
});

// Limpiar chat
app.post('/api/chat/clear', (req, res) => {
  conversations.delete(req.body.sessionId || 'default');
  res.json({ success: true });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    pinecone: pineconeIndex ? 'conectado' : 'no conectado'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);
});
