require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const OpenAI = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');

const app = express();
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const INDEX_NAME = process.env.PINECONE_INDEX || 'products';

let pineconeIndex = null;

async function initPinecone() {
  if (process.env.PINECONE_API_KEY && INDEX_NAME) {
    try {
      pineconeIndex = pc.index(INDEX_NAME);
      const stats = await pineconeIndex.describeIndexStats();
      console.log(`✅ Pinecone: ${stats.totalRecordCount} productos`);
    } catch (e) {
      console.error('❌ Pinecone:', e.message);
    }
  }
}
initPinecone();

// ============================================
// PROMPT - CONCISO Y DIRECTO
// ============================================
const SYSTEM_PROMPT = `Eres vendedor experto de PlantasdeHuerto.com (vivero El Huerto Deitana, Totana, Murcia).
Contacto: 968 422 335 | info@plantasdehuerto.com

BÚSQUEDA: Usa "buscar_productos" para encontrar artículos. Puedes buscar varias veces con distintos términos.

═══════════════════════════════════════════════
TU OBJETIVO: VENDER Y AYUDAR AL CLIENTE
═══════════════════════════════════════════════

1. PRIORIZA WEB, PERO MENCIONA TIENDA FÍSICA
   - Primero muestra lo disponible en WEB (puede comprar ya)
   - SIEMPRE menciona también la tienda física si hay más opciones ahí
   - Ejemplo: "En web tenemos 2 perales. En tienda física hay más variedad si puedes acercarte."

2. VENTA COMPLEMENTARIA (MUY IMPORTANTE)
   Cuando el cliente elige algo, SIEMPRE pregunta y sugiere:
   - "¿Lo plantas en maceta o en tierra?" → ofrece macetas, sustratos
   - "¿Tienes abono para [tipo de planta]?" → busca abonos
   - "Para evitar plagas te vendría bien..." → busca insecticidas
   - "¿Necesitas tutores/riego/herramientas?"
   
   NO esperes a que pregunte. TÚ guías la venta.

3. ADAPTA EL FORMATO AL CONTEXTO
   - Frustración/problema → empatiza, pregunta, NO listes productos aún
   - Pregunta abierta → haz 1-2 preguntas, luego recomienda poco
   - Modo compra → ahí SÍ lista productos con precios
   - Conversación normal → párrafos naturales, sin viñetas

4. MANTÉN EL CONTEXTO
   - Recuerda lo que el cliente dijo antes
   - Si habló de plantar en invierno y luego pregunta por perales, conecta: 
     "Para plantar ahora en invierno, te recomiendo el Peral Conferencia que aguanta bien el frío..."
   - Usa lo que sabes del cliente para personalizar

5. CIERRA LA VENTA
   - Resume lo que podría llevar
   - Pregunta si quiere añadir algo más
   - Ofrece ayuda para completar el pedido

═══════════════════════════════════════════════
EJEMPLOS DE BUENAS RESPUESTAS
═══════════════════════════════════════════════

EJEMPLO 1 - Cliente elige producto:
Usuario: "me llevo el peral conferencia"
Tú: "¡Buena elección! El Peral Conferencia es muy productivo y resistente. 
¿Lo vas a plantar en tierra o en maceta? Si es maceta, necesitarás una de al menos 40-50L para que desarrolle bien las raíces.
También te recomiendo un sustrato para frutales y, si quieres asegurar una buena cosecha, un abono específico para perales. ¿Te busco opciones?"

EJEMPLO 2 - Mencionar tienda física:
Usuario: "tienes manzanos?"
Tú: "En la web ahora mismo tenemos el Manzano Golden a €15.90 (3 unidades).
En nuestra tienda física en Totana hay más variedades: Fuji, Reineta, Granny Smith... Si puedes acercarte, tienes más donde elegir.
¿Cuál te interesa más?"

EJEMPLO 3 - Mantener contexto:
Usuario: "quiero algo resistente al frío"
Tú: [busca plantas resistentes al frío]
Usuario: "vale, ¿y frutales?"
Tú: "Para frutales resistentes al frío te van perfecto los perales, manzanos y cerezos. Son de los que mejor aguantan temperaturas bajas. ¿Tienes preferencia por alguno?"

═══════════════════════════════════════════════

NUNCA:
- Respondas siempre con el mismo formato de lista
- Ignores lo que el cliente dijo antes
- Olvides mencionar la tienda física
- Dejes ir al cliente sin ofrecer complementarios
- Seas robótico o repetitivo

RECUERDA: Eres un vendedor que quiere ayudar al cliente a tener éxito con sus plantas, no un catálogo.`;

// ============================================
// BÚSQUEDA Y FORMATO
// ============================================

async function searchProducts(query, webOnly = false) {
  if (!pineconeIndex) return [];
  
  try {
    console.log(`  🔍 "${query}"${webOnly ? ' (web)' : ''}`);
    
    const embedding = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
      dimensions: 512
    });
    
    let filter = { $or: [{ stock_web: { $gt: 0 } }, { stock_fisico: { $gt: 0 } }] };
    if (webOnly) filter = { stock_web: { $gt: 0 } };
    
    const results = await pineconeIndex.query({
      vector: embedding.data[0].embedding,
      topK: 15,
      includeMetadata: true,
      filter
    });
    
    const products = results.matches?.map(m => m.metadata) || [];
    const web = products.filter(p => p.stock_web > 0).length;
    const store = products.filter(p => p.stock_fisico > 0 && !p.stock_web).length;
    console.log(`     → ${web} web, ${store} tienda`);
    
    return products;
  } catch (e) {
    console.error('❌', e.message);
    return [];
  }
}

function formatProduct(p) {
  let nombre = p.descripcion_bandeja;
  if (!nombre || nombre === 'N/A') nombre = p.denominacion_web;
  if (!nombre || nombre === 'N/A') nombre = p.denominacion_familia;
  
  const precio = p.precio_de_venta_bandeja || p.precio_web || p.precio_fisico || 0;
  const stockWeb = p.stock_web || 0;
  const stockFisico = p.stock_fisico || 0;
  
  let dispo = stockWeb > 0 
    ? `${stockWeb} en WEB` 
    : `${stockFisico} en TIENDA FÍSICA`;
  
  let info = `${nombre} | Cód: ${p.codigo_referencia} | €${precio.toFixed(2)} | ${dispo}`;
  
  if (p.descripcion_de_cada_articulo && p.descripcion_de_cada_articulo !== 'N/A') {
    info += ` | ${p.descripcion_de_cada_articulo.substring(0, 120)}`;
  }
  
  return info;
}

// ============================================
// HERRAMIENTAS PARA LA IA
// ============================================
const tools = [
  {
    type: 'function',
    function: {
      name: 'buscar_productos',
      description: 'Busca productos en el catálogo. PUEDES llamar varias veces con distintos términos. Busca la planta principal y también complementarios (macetas, sustratos, abonos, insecticidas).',
      parameters: {
        type: 'object',
        properties: {
          termino: {
            type: 'string',
            description: 'Término de búsqueda: nombre de planta, categoría, o producto complementario'
          },
          solo_web: {
            type: 'boolean',
            description: 'True = solo productos disponibles en web',
            default: false
          }
        },
        required: ['termino']
      }
    }
  }
];

// ============================================
// API
// ============================================

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const conversations = new Map();

function getConversation(sessionId) {
  if (!conversations.has(sessionId)) {
    conversations.set(sessionId, { messages: [], createdAt: Date.now() });
  }
  return conversations.get(sessionId);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, conv] of conversations) {
    if (now - conv.createdAt > 3600000) conversations.delete(id);
  }
}, 300000);

app.get('/api/config', (req, res) => {
  res.json({
    botName: process.env.BOT_NAME || 'Huerto Deitana IA',
    welcomeMessage: process.env.BOT_WELCOME_MESSAGE || '¡Hola! Soy el asistente de PlantasdeHuerto.com. ¿En qué puedo ayudarte?',
    primaryColor: process.env.PRIMARY_COLOR || '#4A7C59'
  });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: 'Mensaje requerido' });

    const conv = getConversation(sessionId || 'default');
    conv.messages.push({ role: 'user', content: message });
    
    console.log(`\n👤 "${message}"`);
    
    // Llamada inicial
    let response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...conv.messages.slice(-15) // Más contexto
      ],
      tools,
      tool_choice: 'auto',
      max_tokens: 800,
      temperature: 0.75
    });
    
    let assistantMessage = response.choices[0].message;
    let searchCount = 0;
    
    // Loop de búsquedas
    while (assistantMessage.tool_calls && searchCount < 6) {
      console.log(`🔧 ${assistantMessage.tool_calls.length} búsqueda(s)`);
      
      const toolResults = [];
      
      for (const call of assistantMessage.tool_calls) {
        if (call.function.name === 'buscar_productos') {
          const args = JSON.parse(call.function.arguments);
          const products = await searchProducts(args.termino, args.solo_web || false);
          
          const formatted = products.length > 0
            ? products.slice(0, 8).map(formatProduct).join('\n')
            : 'No encontrado. Intenta con otro término.';
          
          toolResults.push({
            tool_call_id: call.id,
            role: 'tool',
            content: formatted
          });
          searchCount++;
        }
      }
      
      response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...conv.messages.slice(-12),
          assistantMessage,
          ...toolResults
        ],
        tools,
        tool_choice: 'auto',
        max_tokens: 800,
        temperature: 0.75
      });
      
      assistantMessage = response.choices[0].message;
    }
    
    const reply = assistantMessage.content || 'No pude procesar tu consulta. ¿Puedes reformularla?';
    conv.messages.push({ role: 'assistant', content: reply });
    
    console.log(`💬 OK (${searchCount} búsquedas)\n`);

    res.json({ message: reply, sessionId: sessionId || 'default' });

  } catch (error) {
    console.error('❌', error.message);
    res.status(500).json({ error: 'Error procesando mensaje' });
  }
});

app.post('/api/chat/clear', (req, res) => {
  conversations.delete(req.body.sessionId || 'default');
  res.json({ success: true });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', pinecone: pineconeIndex ? 'ok' : 'no' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Puerto ${PORT} | http://localhost:${PORT}\n`);
});
