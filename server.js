require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const OpenAI = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const INDEX_NAME = process.env.PINECONE_INDEX || 'products';

// ============================================
// FIREBASE ADMIN - Inicialización segura
// ============================================
let db = null;

function initFirebase() {
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        })
      });
      db = admin.firestore();
      console.log('✅ Firebase: Conectado');
    } catch (e) {
      console.error('❌ Firebase:', e.message);
    }
  } else {
    console.log('⚠️ Firebase: No configurado (usando memoria)');
  }
}
initFirebase();

// ============================================
// FIRESTORE - Funciones de persistencia
// ============================================

// Obtener la fecha de sesión en hora española (nuevo día a las 6:00 AM)
function getSessionDate() {
  const now = new Date();
  
  // Convertir a hora española (Europe/Madrid)
  const spainTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
  
  // Si son antes de las 6:00 AM, usar fecha del día anterior
  if (spainTime.getHours() < 6) {
    spainTime.setDate(spainTime.getDate() - 1);
  }
  
  // Formato: YYYY-MM-DD
  const year = spainTime.getFullYear();
  const month = String(spainTime.getMonth() + 1).padStart(2, '0');
  const day = String(spainTime.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

async function getConversationFromDB(deviceId) {
  if (!db) return null;
  
  try {
    const sessionDate = getSessionDate();
    const docRef = db.collection('conversations').doc(deviceId)
                     .collection('sessions').doc(sessionDate);
    const doc = await docRef.get();
    
    if (doc.exists) {
      return doc.data();
    }
    return null;
  } catch (e) {
    console.error('❌ Firestore get:', e.message);
    return null;
  }
}

async function saveConversationToDB(deviceId, messages) {
  if (!db) return;
  
  try {
    const sessionDate = getSessionDate();
    
    // Guardar en la sesión del día
    const sessionRef = db.collection('conversations').doc(deviceId)
                         .collection('sessions').doc(sessionDate);
    
    const sessionData = {
      messages: messages.slice(-100), // Guardar últimos 100 mensajes por sesión
      lastActivity: admin.firestore.FieldValue.serverTimestamp(),
      messageCount: messages.length,
      sessionDate: sessionDate
    };
    
    const sessionDoc = await sessionRef.get();
    if (!sessionDoc.exists) {
      sessionData.createdAt = admin.firestore.FieldValue.serverTimestamp();
    }
    
    await sessionRef.set(sessionData, { merge: true });
    
    // Actualizar también el documento principal del dispositivo
    await db.collection('conversations').doc(deviceId).set({
      lastActivity: admin.firestore.FieldValue.serverTimestamp(),
      lastSessionDate: sessionDate,
      totalSessions: admin.firestore.FieldValue.increment(sessionDoc.exists ? 0 : 1)
    }, { merge: true });
    
  } catch (e) {
    console.error('❌ Firestore save:', e.message);
  }
}

// ============================================
// PINECONE
// ============================================
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

RECUERDA: Eres un vendedor que quiere ayudar al cliente a tener éxito con sus plantas, no un catálogo.

═══════════════════════════════════════════════
📦 MÓDULO: ENVÍOS Y LOGÍSTICA
═══════════════════════════════════════════════

La siguiente información es normativa interna de la tienda.
El asistente debe responder siempre basándose exclusivamente en estos datos.

🌍 Zonas de envío
- España peninsular: Sí realizamos envíos
- Islas Baleares: Sí realizamos envíos
- Resto de Europa: Solo enviamos a Portugal
- No realizamos envíos a otros países
Si el cliente pregunta por otro país, responder de forma clara y educada que actualmente solo se envía a España (península y Baleares) y Portugal.

🚚 Plazos de entrega
- Preparación del pedido: 1 día
- Entrega estándar: 24 a 48 horas
- En temporada alta: puede demorarse 1 día adicional
Si el cliente pregunta por urgencias, explicar que el plazo habitual es 24/48h tras preparación.

💰 Costes de envío
- No hay pedido mínimo.
- Envío gratuito a partir de 70 €.
- Coste estándar de envío: 9,90 €.
- Coste internacional (Portugal): informar que puede variar según destino (si no está definido, indicar que se confirma antes del envío).
Si el pedido supera 70 €, indicar automáticamente que el envío es gratuito.

🌱 Productos especiales
- Las plantas grandes no tienen condiciones especiales de envío.
- Los cipreses por bandeja se envían sin bandeja.
- La venta por unidades no afecta al transporte.
Si el cliente pregunta por embalaje o logística especial, aclarar que se envían protegidos pero sin bandejas en el caso de cipreses.

📦 Incidencias
- Retrasos: muy poco frecuentes.
- Roturas: poco frecuentes.
- Sustituciones: poco frecuentes.
- No se aceptan devoluciones.
Si el cliente pregunta por devoluciones, responder claramente que no se aceptan devoluciones, pero que puede contactar con soporte ante cualquier incidencia.

📞 Gestión de incidencias
En caso de problema, el asistente debe indicar:
- Email: info@plantasdehuerto.com
- Teléfono: 968 422 335
- Plazo máximo para reclamar: 1 semana desde la recepción del pedido

═══════════════════════════════════════════════
CONTACTO Y WHATSAPP
═══════════════════════════════════════════════

Cuando el cliente pida WhatsApp, teléfono o contacto, usa este formato que se mostrará como tarjeta bonita:

[CONTACTO:34968422335:+34968422335:info@plantasdehuerto.com]

O si solo quieres dar el WhatsApp, usa un link normal a wa.me:
https://wa.me/34968422335

Estos links se convertirán automáticamente en botones bonitos de WhatsApp.

Datos de contacto:
- WhatsApp/Teléfono: 968 422 335 (con prefijo España: 34968422335)
- Email: info@plantasdehuerto.com
- Dirección: Ctra. Mazarrón km 2,4, Totana, Murcia`;

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

// Cache en memoria para sesiones activas (reduce lecturas a Firestore)
const memoryCache = new Map();

async function getConversation(deviceId) {
  // Primero buscar en cache
  if (memoryCache.has(deviceId)) {
    return memoryCache.get(deviceId);
  }
  
  // Luego buscar en Firestore
  const dbConv = await getConversationFromDB(deviceId);
  const conv = {
    messages: dbConv?.messages || [],
    createdAt: Date.now()
  };
  
  memoryCache.set(deviceId, conv);
  return conv;
}

// Limpiar cache cada 30 minutos (las conversaciones persisten en Firestore)
setInterval(() => {
  const now = Date.now();
  for (const [id, conv] of memoryCache) {
    if (now - conv.createdAt > 1800000) memoryCache.delete(id);
  }
}, 600000);

app.get('/api/config', (req, res) => {
  res.json({
    botName: process.env.BOT_NAME || 'Huerto Deitana IA',
    welcomeMessage: process.env.BOT_WELCOME_MESSAGE || '¡Hola! Soy el asistente de PlantasdeHuerto.com. ¿En qué puedo ayudarte?',
    primaryColor: process.env.PRIMARY_COLOR || '#4A7C59'
  });
});

// Endpoint para cargar historial de la sesión actual (al recargar página)
app.get('/api/chat/history', async (req, res) => {
  try {
    const { deviceId } = req.query;
    
    // Validar deviceId
    if (!deviceId || !/^dev_[a-f0-9-]{36}$/.test(deviceId)) {
      return res.json({ messages: [], sessionDate: getSessionDate() });
    }
    
    const conv = await getConversationFromDB(deviceId);
    const sessionDate = getSessionDate();
    
    if (conv && conv.messages) {
      // Devolver mensajes formateados para el widget
      const messages = conv.messages.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp || null
      }));
      
      res.json({ 
        messages, 
        sessionDate,
        messageCount: messages.length
      });
    } else {
      res.json({ messages: [], sessionDate });
    }
  } catch (error) {
    console.error('❌ History:', error.message);
    res.json({ messages: [], sessionDate: getSessionDate() });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message, deviceId } = req.body;
    if (!message) return res.status(400).json({ error: 'Mensaje requerido' });
    
    // Validar deviceId (debe empezar con 'dev_' y tener formato UUID-like)
    const safeDeviceId = (deviceId && /^dev_[a-f0-9-]{36}$/.test(deviceId)) 
      ? deviceId 
      : 'anonymous';

    const conv = await getConversation(safeDeviceId);
    conv.messages.push({ 
      role: 'user', 
      content: message, 
      timestamp: new Date().toISOString() 
    });
    
    console.log(`\n👤 [${safeDeviceId.slice(0, 12)}...] "${message}"`);
    
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
    conv.messages.push({ 
      role: 'assistant', 
      content: reply, 
      timestamp: new Date().toISOString() 
    });
    
    // Guardar en Firestore (async, no bloquea respuesta)
    saveConversationToDB(safeDeviceId, conv.messages).catch(e => 
      console.error('❌ Save async:', e.message)
    );
    
    console.log(`💬 OK (${searchCount} búsquedas)\n`);

    res.json({ message: reply, deviceId: safeDeviceId });

  } catch (error) {
    console.error('❌', error.message);
    res.status(500).json({ error: 'Error procesando mensaje' });
  }
});

app.post('/api/chat/clear', async (req, res) => {
  const { deviceId } = req.body;
  if (deviceId) {
    // Solo limpiar cache en memoria
    // NO borramos de Firestore para mantener registros históricos
    memoryCache.delete(deviceId);
  }
  res.json({ success: true });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    pinecone: pineconeIndex ? 'ok' : 'no',
    firebase: db ? 'ok' : 'no'
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Puerto ${PORT} | http://localhost:${PORT}\n`);
});
