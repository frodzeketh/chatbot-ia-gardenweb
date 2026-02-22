require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const OpenAI = require('openai');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ARTICULOS_API_URL = (process.env.ARTICULOS_API_URL || '').replace(/\/$/, '');
const ARTICULOS_API_KEY = (process.env.ARTICULOS_API_KEY || '').trim();
const usePrestaShopDirect = !!(ARTICULOS_API_URL && ARTICULOS_API_KEY);
// NOTA: ARTICULOS_API_BASE (ej. 127.0.0.1:5001) no se usa en este servidor. Los productos se cargan desde PrestaShop con ARTICULOS_API_URL + ARTICULOS_API_KEY.

function prestaShopAuth() {
  return { Authorization: 'Basic ' + Buffer.from(ARTICULOS_API_KEY + ':').toString('base64') };
}

function prestaShopQuery(extra = '') {
  const q = 'output_format=JSON' + (extra ? '&' + extra : '');
  return ARTICULOS_API_KEY ? q + '&ws_key=' + encodeURIComponent(ARTICULOS_API_KEY) : q;
}

function prestaShopQueryImage() {
  return ARTICULOS_API_KEY ? 'ws_key=' + encodeURIComponent(ARTICULOS_API_KEY) : '';
}

// ============================================
// IVA por id_tax_rules_group (precio exacto como en la web)
// ============================================
const IVA_MAP_DEFAULT = {
  '0': 21, '1': 21, '2': 10, '3': 4, '4': 20, '5': 10, '6': 5.5, '7': 2.1, '8': 20, '9': 21,
  '10': 20, '11': 19, '12': 21, '13': 19, '14': 25, '15': 20, '16': 24, '17': 20, '18': 24, '19': 25,
  '20': 27, '21': 23, '22': 22, '23': 21, '24': 17, '25': 21, '26': 18, '27': 21, '28': 23, '29': 23,
  '30': 19, '31': 25, '32': 22, '33': 20
};

function getIvaMap() {
  try {
    const raw = process.env.ARTICULOS_IVA_MAP;
    if (!raw) return IVA_MAP_DEFAULT;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const map = { ...IVA_MAP_DEFAULT };
      Object.keys(parsed).forEach((k) => {
        const v = Number(parsed[k]);
        if (!Number.isNaN(v)) map[String(k)] = v;
      });
      return map;
    }
  } catch (_) {}
  return IVA_MAP_DEFAULT;
}

const IVA_MAP = getIvaMap();

/** Precio con IVA incluido: usa price_tax_incl si existe; si no, precio × (1 + IVA%) según id_tax_rules_group. */
function getPriceTaxIncl(raw) {
  const taxIncl = raw.price_tax_incl;
  if (taxIncl != null) {
    const n = Number(taxIncl);
    if (!Number.isNaN(n)) return n;
  }
  const price = raw.price != null ? Number(raw.price) : NaN;
  if (Number.isNaN(price)) return null;
  const group = raw.id_tax_rules_group != null ? String(raw.id_tax_rules_group) : '';
  const ivaPercent = IVA_MAP[group];
  if (ivaPercent == null) return null;
  return Math.round(price * (1 + ivaPercent / 100) * 100) / 100;
}

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
// API ARTÍCULOS – Cache en memoria, datos en tiempo real
// ============================================
let productsCache = [];
let productsCacheTime = 0;
const CACHE_TTL_MS = (Number(process.env.ARTICULOS_CACHE_TTL_SEC) || 300) * 1000; // 5 min por defecto

function getProductName(p) {
  const n = p.name;
  if (!n) return '';
  if (typeof n === 'string') return n.trim();
  const arr = Array.isArray(n) ? n : (n.language || n);
  if (!Array.isArray(arr) || arr.length === 0) return '';
  const es = arr.find((x) => x.id === '1' || x.id === 1);
  const first = arr[0];
  const item = es || first;
  return (item && item.value) ? String(item.value).trim() : '';
}

/** Extrae texto de un campo multilenguaje (description_short, description). String, o { language: [ { id, value } ] }, o { value / "#" }. */
function getMultilangText(raw, fieldName) {
  const f = raw[fieldName];
  if (f == null) return '';
  let text = '';
  if (typeof f === 'string') text = f;
  else if (typeof f === 'object') {
    const direct = f['#'] ?? f['@value'] ?? f.value;
    if (direct != null) text = String(direct);
    else {
      const lang = f.language || (Array.isArray(f) ? f : null);
      const list = Array.isArray(lang) ? lang : (lang ? [lang] : []);
      const es = list.find((x) => x && (String(x.id) === '1'));
      const first = list[0];
      const item = es || first;
      const val = item && (item.value ?? item['#'] ?? item['@value']);
      text = val != null ? String(val) : '';
    }
  }
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
}

function normalizeProduct(raw, imageUrlFromApi) {
  const name = getProductName(raw);
  const priceTaxIncl = raw.price_tax_incl != null ? Number(raw.price_tax_incl) : null;
  const price = raw.price != null ? Number(raw.price) : null;
  const productUrl = raw.product_url ? String(raw.product_url).trim() : '';
  const imageUrl = imageUrlFromApi || (raw.image_url || raw.image || raw.image_link || '').trim();
  const descShort = getMultilangText(raw, 'description_short');
  const descLong = getMultilangText(raw, 'description');
  const description = descShort || descLong || '';
  return {
    id: raw.id,
    reference: raw.reference ? String(raw.reference) : '',
    name,
    description,
    price_tax_incl: priceTaxIncl,
    price,
    product_url: productUrl,
    image_url: imageUrl,
    stock: null
  };
}

/** Extrae valor de campo que la API puede devolver como número, string u objeto (ej. {"#": "1"}). */
function extractValue(field) {
  if (field == null) return null;
  if (typeof field === 'number' && !Number.isNaN(field)) return String(field);
  if (typeof field === 'string') return field;
  if (typeof field === 'object') {
    const v = field['#'] ?? field['@value'] ?? field.value;
    if (v != null) return String(v);
    const lang = field.language;
    if (lang) {
      const first = Array.isArray(lang) ? lang[0] : lang;
      const x = first?.['#'] ?? first?.['@value'] ?? first?.value;
      if (x != null) return String(x);
    }
  }
  return null;
}

function parsePrestaShopProducts(data) {
  if (!data) return [];
  const root = data.products || data.product;
  if (!root) return [];
  const arr = Array.isArray(root)
    ? root
    : (root.product ? (Array.isArray(root.product) ? root.product : [root.product]) : [root]);
  return arr;
}

/** Recorre el árbol y recoge cualquier objeto que tenga id_product (PrestaShop: a veces array en stock_available, a veces objeto con claves numéricas). */
function flattenStockCandidates(obj, out, depth) {
  if (depth > 5) return;
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((item) => flattenStockCandidates(item, out, depth + 1));
    return;
  }
  const hasIdProduct = obj.id_product !== undefined || obj.id_product != null;
  if (hasIdProduct) {
    out.push(obj);
    return;
  }
  Object.values(obj).forEach((v) => flattenStockCandidates(v, out, depth + 1));
}

function parsePrestaShopStock(data) {
  if (!data) return {};
  const root = data.prestashop || data;
  const s = root.stock_availables ?? root.stock_available;
  if (!s) return {};
  let candidates = [];
  if (Array.isArray(s)) {
    candidates = s;
  } else if (s.stock_available != null) {
    const inner = s.stock_available;
    candidates = Array.isArray(inner) ? inner : Object.values(inner);
  } else {
    flattenStockCandidates(s, candidates, 0);
  }
  const map = {};
  candidates.forEach((x) => {
    if (!x || typeof x !== 'object') return;
    const idProduct = extractValue(x.id_product) ?? (x.id_product != null ? String(x.id_product) : null);
    if (idProduct == null || idProduct === '') return;
    const qRaw = extractValue(x.quantity) ?? x.quantity;
    const q = parseInt(String(qRaw ?? 0), 10);
    const quantity = Number.isNaN(q) ? 0 : q;
    map[idProduct] = (map[idProduct] || 0) + quantity;
  });
  return map;
}

// Lista de imágenes: GET images/products → id_product e id de cada imagen
function parsePrestaShopProductImages(data) {
  const map = {}; // id_product -> id_image (primera imagen del producto)
  if (!data) return map;
  const root = data.images || data.image;
  if (!root) return map;
  let arr = [];
  if (Array.isArray(root)) arr = root;
  else if (root.image) arr = Array.isArray(root.image) ? root.image : [root.image];
  else if (typeof root === 'object') arr = Object.keys(root).map((k) => root[k]).filter(Boolean);
  arr.forEach((img) => {
    if (!img || typeof img !== 'object') return;
    const idProduct = img.id_product != null ? String(img.id_product) : '';
    const idImage = img.id != null ? String(img.id) : '';
    if (idProduct && idImage && map[idProduct] == null) map[idProduct] = idImage;
  });
  return map;
}

async function fetchProductImagesMap() {
  if (!usePrestaShopDirect) return {};
  try {
    const url = `${ARTICULOS_API_URL}/images/products?display=full&${prestaShopQuery()}`;
    const res = await fetch(url, { headers: prestaShopAuth() });
    if (!res.ok) return {};
    const data = await res.json();
    const map = parsePrestaShopProductImages(data);
    console.log(`✅ PrestaShop imágenes: ${Object.keys(map).length} productos con imagen en lista`);
    return map;
  } catch (e) {
    console.warn('⚠️  Lista imágenes PrestaShop:', e.message);
    return {};
  }
}

function getProductImageId(raw, imageMap) {
  const id = (extractValue(raw.id) ?? (raw.id != null ? String(raw.id) : '')).toString();
  if (!id) return '';
  if (raw.id_default_image != null && String(raw.id_default_image)) return String(raw.id_default_image);
  if (imageMap[id]) return imageMap[id];
  const assoc = raw.associations || {};
  const images = assoc.images || assoc.image;
  const list = Array.isArray(images) ? images : images ? [images] : [];
  const first = list[0];
  return first && first.id != null ? String(first.id) : '';
}

/** Producto disponible en catálogo: active es "1" o 1 o true en PrestaShop. Si no viene el campo, se considera activo. */
function isProductActive(raw) {
  const a = extractValue(raw.active) ?? raw.active;
  if (a === '0' || a === 0 || a === false) return false;
  return true;
}

async function fetchProductsFromPrestaShop() {
  if (!usePrestaShopDirect) return [];
  try {
    const [productsRes, stockRes, imageMap] = await Promise.all([
      fetch(`${ARTICULOS_API_URL}/products?display=full&${prestaShopQuery()}`, { headers: prestaShopAuth() }),
      fetch(`${ARTICULOS_API_URL}/stock_availables?display=full&${prestaShopQuery()}`, { headers: prestaShopAuth() }),
      fetchProductImagesMap()
    ]);
    if (!productsRes.ok) throw new Error('Products ' + productsRes.status);
    const productsData = await productsRes.json();
    const stockData = stockRes.ok ? await stockRes.json() : {};
    const list = parsePrestaShopProducts(productsData);
    const stockMap = parsePrestaShopStock(stockData);
    const stockEntries = Object.keys(stockMap).length;
    if (list.length > 0 && stockEntries === 0) {
      const claves = typeof stockData === 'object' && stockData !== null ? Object.keys(stockData).join(', ') : 'no es objeto';
      const sa = stockData?.prestashop?.stock_availables ?? stockData?.stock_availables;
      const raw = sa != null ? JSON.stringify(sa) : '';
      const rawPreview = raw.length > 0 ? raw.slice(0, 1200) + (raw.length > 1200 ? '...' : '') : '(vacío)';
      console.warn('⚠️  stock_availables: 0 entradas. Claves en respuesta:', claves);
      console.warn('   Respuesta cruda (primeros 1200 caracteres):', rawPreview);
    }
    const shopBase = ARTICULOS_API_URL.replace(/\/api\/?$/, '');
    productsCache = list.map((raw) => {
      const id = (extractValue(raw.id) ?? (raw.id != null ? String(raw.id) : '')).toString();
      const idImage = getProductImageId(raw, imageMap);
      const imageUrl = id && idImage ? `/api/articulos/image/${id}/${idImage}` : '';
      const productUrl = `${shopBase}/index.php?id_product=${id}&controller=product`;
      const priceTaxIncl = getPriceTaxIncl(raw);
      const rawMapped = {
        id,
        reference: raw.reference || '',
        name: raw.name,
        description_short: raw.description_short,
        description: raw.description,
        price: raw.price,
        price_tax_incl: priceTaxIncl != null ? priceTaxIncl : raw.price_tax_incl,
        product_url: productUrl
      };
      const p = normalizeProduct(rawMapped, imageUrl);
      p.stock = stockMap[id] != null ? stockMap[id] : null;
      p.active = isProductActive(raw);
      if (idImage) p.imageId = idImage;
      return p;
    });
    const hasStockData = Object.keys(stockMap).length > 0;
    productsCache = productsCache.filter((p) => {
      if (!p.name || !p.active) return false;
      if (hasStockData) return p.stock != null && Number(p.stock) > 0;
      return true;
    });
    productsCacheTime = Date.now();
    const withImage = productsCache.filter((p) => p.image_url).length;
    const stockInfo = hasStockData ? `activos + stock>0` : `activos (sin datos stock_availables)`;
    console.log(`✅ PrestaShop: ${list.length} productos, ${stockEntries} con stock en API → ${productsCache.length} disponibles (${stockInfo}), ${withImage} con imagen`);
    return productsCache;
  } catch (e) {
    console.warn('⚠️  PrestaShop no disponible:', e.message || e);
    console.warn('   Comprueba ARTICULOS_API_URL y ARTICULOS_API_KEY en .env. En servidor: que la URL sea accesible (no uses 127.0.0.1).');
    return productsCache.length ? productsCache : [];
  }
}

async function ensureProductsCache() {
  const now = Date.now();
  if (productsCache.length === 0 || now - productsCacheTime > CACHE_TTL_MS) {
    if (usePrestaShopDirect) await fetchProductsFromPrestaShop();
  }
  return productsCache;
}

function formatPrice(value) {
  if (value == null || isNaN(value)) return '';
  return `${Number(value).toFixed(2).replace('.', ',')} €`;
}

/** Normaliza para búsqueda: minúsculas y sin acentos (cipres coincide con ciprés). */
function normalizeForSearch(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/\u0300-\u036f/g, '')
    .trim();
}

async function searchProductsFromAPI(term, soloWeb = false) {
  await ensureProductsCache();
  const t = normalizeForSearch(term || '');
  if (!t) return productsCache.slice(0, 8);
  const filtered = productsCache.filter((p) => {
    const nameNorm = normalizeForSearch(p.name || '');
    const refNorm = normalizeForSearch(p.reference || '');
    const descNorm = normalizeForSearch(p.description || '');
    return nameNorm.includes(t) || refNorm.includes(t) || (t.length >= 2 && descNorm.includes(t));
  });
  return filtered.slice(0, 8);
}

function formatProductForTool(p) {
  const name = p.name || 'Sin nombre';
  const priceStr = formatPrice(p.price_tax_incl) || formatPrice(p.price) || 'Consultar';
  const url = p.product_url || 'https://plantasdehuerto.com/';
  const image = p.image_url || '';
  const stock = p.stock != null ? String(p.stock) : 'Consultar';
  const ref = p.reference || '';
  const desc = (p.description || '').slice(0, 280).replace(/\|/g, ' ');
  return `${name} | ${priceStr} | ${url} | ${image} | ${stock} | ${ref} | ${desc}`;
}

// Precarga de cache al arranque y log de resumen (sin gastar tokens en chat)
if (usePrestaShopDirect) {
  console.log(`📦 Artículos: PrestaShop directo → ${ARTICULOS_API_URL ? ARTICULOS_API_URL.replace(/\/api\/?$/, '') + '/api' : '(vacío)'}`);
  ensureProductsCache()
    .then((list) => {
      const conImagen = (list || []).filter((p) => p.image_url).length;
      console.log(`📊 Artículos al iniciar: ${(list || []).length} disponibles, ${conImagen} con imagen`);
    })
    .catch((e) => {
      console.warn('⚠️ Precarga cache fallida:', e.message || e);
      console.warn('   Comprueba en el servidor: ARTICULOS_API_URL, ARTICULOS_API_KEY y que pueda conectar a la URL (red/firewall).');
    });
} else {
  console.warn('⚠️ Artículos: NO configurado. Faltan ARTICULOS_API_URL y/o ARTICULOS_API_KEY en .env → buscar_productos devolverá 0 resultados.');
  console.warn('   En el servidor, configura .env con ARTICULOS_API_URL=https://www.plantasdehuerto.com/api y ARTICULOS_API_KEY=tu_ws_key');
}

// ============================================
// PROMPT - CONCISO Y DIRECTO
// ============================================
const SYSTEM_PROMPT = `Eres vendedor experto de PlantasdeHuerto.com (vivero El Huerto Deitana, Totana, Murcia).
Contacto: 968 422 335 | info@plantasdehuerto.com

═══════════════════════════════════════════════
PRODUCTO ESTRELLA: CIPRES COMUN en Cepellon (Cupressus Sempervirens)
═══════════════════════════════════════════════
Cuando pregunten por ciprés, setos, vallas o cortavientos, prioriza y destaca este producto si buscar_productos lo devuelve:
- Nombre: CIPRÉS COMÚN EN CEPELLÓN (Cupressus sempervirens), cipres para vallar. Ref: 00023045.
- Precio: 0,44 €/ud (IVA incl.). PEDIDO MÍNIMO 9 UNIDADES.
- Planta: 40-65 cm aprox., en cepellón. Nombre común: ciprés común o ciprés mediterráneo.
- Uso: el más utilizado para vallar y hacer setos; ramas en vertical (menos poda); cortavientos; crecimiento rápido los primeros años.
- Árbol adulto: puede alcanzar 30 m de talla, porte columnar o piramidal; tolera suelos pobres; madera pesada y duradera; longevidad 500+ años.
- Cuidados: riego bajo. Recién plantados regar hasta que arraiguen; adultos no regar salvo verano muy seco (no regar en exceso, enferma).
- Plantación: 25-33 cm entre plantas (3-4 por metro lineal). Crecimiento anual aprox. 30 cm.
- Envío: sin bandeja, tumbados en cajas. Las plantas pueden variar en forma, color y tamaño (son seres vivos).
Menciona que es vuestro producto estrella para setos y vallas cuando sea relevante. Los datos concretos (precio, stock, URL) los tomas SIEMPRE del resultado de buscar_productos.

══════════════════════════════════════════════════════════════════
FLUJO: CONVERSACIÓN PRIMERO, BÚSQUEDA DESPUÉS (MUY IMPORTANTE)
══════════════════════════════════════════════════════════════════
NO actúes como un bot que dispara búsquedas ante cualquier mención de "huerto" o "plantas". Piensa y conversa antes de buscar.

CUANDO NO DEBES LLAMAR A buscar_productos (preguntas abiertas):
- "Qué me aconsejas para un huerto", "qué plantas hortícolas tenéis", "quiero hacer un huerto, qué me recomendáis", "qué tenéis para empezar".
En estos casos: NO busques todavía. Responde como asesor:
  - Pregunta qué quiere cultivar (tomate, lechuga, pimiento, etc.) o si prefiere algo de crecimiento rápido.
  - Comenta opciones según la temporada o el espacio (maceta vs bancal).
  - Ofrece buscar en catálogo cuando concrete: "Cuando me digas qué te gustaría cultivar (por ejemplo lechuga, tomate, pimiento) te busco qué tenemos en stock" o "¿Quieres que te busque lechugas, tomates o algo concreto?"
- Si piden "consejos" o "qué me aconsejas" sin nombrar un producto concreto, da consejos y preguntas; no listes productos hasta que pidan algo específico o acepten que les busques algo concreto.

CUANDO SÍ DEBES LLAMAR A buscar_productos:
- El usuario nombra un producto o categoría concreta: "tienes limonero", "ciprés para vallar", "búscame tomates", "qué tenéis de lechugas", "sustrato para macetas", "abono para tomate".
- Después de una vuelta de conversación el usuario concreta: "pues búscame lechugas" o "algo de tomates entonces".

Regla: primero conversación y razonamiento; búsqueda solo cuando haya algo concreto que buscar.

BÚSQUEDA (cuando corresponda): Cuando el usuario pida algo CONCRETO por nombre, referencia o tipo (ej. "cipres", "limonero", "sustrato", "lechuga", "tomate"), llama a "buscar_productos" con ese término. NUNCA recomiendes productos de memoria ni inventes referencias o precios: solo los que devuelva buscar_productos existen en web y están disponibles.
- El backend normaliza acentos: "cipres" y "ciprés" encuentran lo mismo.
- Si no hay resultados, puedes llamar con un término más amplio (ej. "seto" si "valla" no devuelve nada).
buscar_productos devuelve solo artículos activos y con stock > 0. Los precios son con IVA incluido; muéstralos tal cual.

═══════════════════════════════════════════════
DESCRIPCIÓN Y RAZONAMIENTO (MUY IMPORTANTE)
═══════════════════════════════════════════════
Cada producto incluye un 7º valor: la DESCRIPCIÓN (description_short o description del artículo). Es la ÚNICA fuente de verdad sobre qué es el producto.

NUNCA INVENTES DATOS: Cualquier dato factual (altura, talla, distancia de plantación, riego, uso concreto, para qué planta sirve) debe salir EXCLUSIVAMENTE de la descripción que devuelve buscar_productos.
- Si la descripción dice "puede alcanzar 30 m de talla", di 30 m; NUNCA digas "15-25 m" u otro rango inventado.
- Si la descripción dice "fungicida para enfermedades de rosales" o "para rosales", di explícitamente que es para rosales.
- Si la descripción indica cuadro de plantación, riego, crecimiento anual, etc., usa esos datos; si no aparecen, no los inventes.

- USA SIEMPRE la descripción para razonar: no asumas solo por el nombre. Ejemplo: "Centro con Cactus Variados" puede ser un combo (cactus + sustrato), no solo un sustrato; si el cliente pide "sustrato", recomienda productos cuya descripción indique que son sustrato, perlita, compost, etc.
- Recomienda en función de lo que dice la descripción (uso, tipo de planta, características), no solo del nombre.
- Si un producto es combo o kit, dilo con naturalidad según la descripción (ej. "Es un pack que incluye...").
- Mantén el contexto de la conversación: si el cliente pidió algo para una valla, recomienda en función de setos/arbustos y de lo que digan las descripciones.

AL PRESENTAR CADA PRODUCTO: Indica brevemente QUÉ ES o PARA QUÉ SIRVE según la descripción, no solo el nombre comercial.
- Ejemplo: si el nombre es "ENFERMEDADES RO..." y la descripción dice que es fungicida para rosales, escribe algo como "Fungicida para enfermedades de rosales" antes o junto a la card.
- Ejemplo: si preguntan "a qué altura crece el ciprés común", responde con los datos exactos de la descripción (ej. "puede alcanzar 30 m de talla", "porte columnar o piramidal", "se usa en setos y como cortavientos").

═══════════════════════════════════════════════
CÓMO MOSTRAR PRODUCTOS (FORMATO SIMPLE)
═══════════════════════════════════════════════
ANTES DE CUALQUIER PRODUCTO: NUNCA empieces la respuesta con el producto. SIEMPRE escribe primero al menos UNA frase de introducción en texto plano (ej. "Claro, tenemos Limonero Eureka.", "Sí, aquí tienes el limonero que buscas.", "Tenemos ese producto en web."). El cliente debe ver siempre texto tuyo antes de la primera card.

buscar_productos devuelve por cada producto: Nombre | Precio | URL_producto | URL_imagen | Stock | Ref | Descripción
Cuando muestres un producto, escribe en markdown:
- Si el nombre comercial no deja claro qué es o para qué sirve, añade UNA línea breve antes (ej. "Fungicida para enfermedades de rosales:", "Abono líquido para plantas de invierno con flor:") usando SOLO datos de la descripción.
- Denominación en negrita
- OBLIGATORIO: si URL_imagen no está vacía, incluye SIEMPRE esta línea justo debajo del nombre: ![nombre del producto](URL_imagen) usando la URL exacta del 4º valor (ruta /api/articulos/image/ID/IMAGEID). NUNCA inventes una URL de imagen: si el 4º valor viene vacío (entre barras ||), NO pongas ninguna línea de imagen.
- Precio, Stock, Ref
- Enlace: [Ver producto](URL_producto)
Máximo 3 productos por mensaje. Sin formato [ARTICULO|...].
Ejemplo (la imagen es obligatoria si buscar_productos devolvió URL de imagen):
**LIMONERO EUREKA (4 estaciones)**
![Limonero Eureka](/api/articulos/image/1614/123)
Precio: 24,50 € · Stock: 17 · Ref: 00022876
[Ver producto](https://www.plantasdehuerto.com/...)

══════════════════════════════════════════════════════════════════
DESPUÉS DE MOSTRAR PRODUCTOS: SIEMPRE ESCRIBE UN CIERRE (OBLIGATORIO)
══════════════════════════════════════════════════════════════════
Cuando hayas mostrado uno o más productos (cards), NUNCA termines solo con la frase intro. SIEMPRE escribe un párrafo o dos DESPUÉS de los productos que incluya:

1. RAZONAMIENTO BREVE: Por qué encajan con lo que pidió (usa la descripción: "La coliflor y la acelga son de desarrollo invernal...", "La lechuga romana aguanta bien el frío...").
2. IMPULSO: Invita a elegir o a comprar ("Puedes llevarte cualquiera de estos para empezar", "Si te animas con la lechuga, tenemos stock").
3. SEGUIR CONVERSANDO: Una de estas (o varias):
   - Cómo cuidar lo que recomiendas (riego, marco, época de siembra).
   - Otras cosas que podría cultivar (complementos: abono, sustrato, macetas).
   - Preguntas abiertas: "¿Sabes si quieres cultivar en bancal o en maceta?", "¿Conoces los tipos de lechuga?", "¿Quieres que te cuente cómo plantar la coliflor?".
   - Ofrecer más búsquedas: "Si buscas algo más concreto (por ejemplo solo bulbos o solo abonos de invierno), dímelo."

Ejemplo de cierre tras mostrar coliflores/lechugas/acelgas de invierno:
"La coliflor, la acelga y la lechuga romana son clásicos de invierno: se desarrollan bien con frío y dan cosecha en esta época. Cualquiera de estos lotes te sirve para empezar. Si vas a plantar lechuga, ten en cuenta que la romana aguanta bien y puedes combinarla con otras verduras en el mismo bancal. ¿Quieres que te explique cómo cuidarlas o buscas también abono o sustrato para la temporada?"

═══════════════════════════════
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
   - Pregunta abierta ("qué me aconsejas para un huerto", "plantas hortícolas que tengáis") → NO llames a buscar_productos. Responde con preguntas y opciones; ofrece buscar cuando concrete.
   - Frustración/problema → empatiza, pregunta, NO listes productos aún.
   - Modo compra / petición concreta ("tienes tomates", "búscame lechugas") → ahí SÍ llama a buscar_productos y lista productos.
   - Conversación normal → párrafos naturales, sin viñetas.

4. MANTÉN EL CONTEXTO Y RAZONA CON LAS DESCRIPCIONES
   - Recuerda lo que el cliente dijo antes (valla, sustrato, tipo de planta, etc.).
   - Usa la DESCRIPCIÓN de cada producto para recomendar con precisión: no digas que algo es "sustrato" si la descripción dice que es un combo; no recomiendes un ciprés para "valla" si la descripción no indica uso en seto.
   - Si piden "sustrato" o "sustratos", busca "sustrato" y revisa en los resultados cuáles son realmente sustratos (perlita, compost, mezclas) según la descripción.
   - Conecta con el contexto: "Para tu valla te van bien estos setos porque [según descripción]..."

5. CIERRA LA VENTA
   - Después de listar productos, escribe SIEMPRE el cierre (razonamiento + impulso + invitar a seguir) como se indica en "DESPUÉS DE MOSTRAR PRODUCTOS".
   - Resume lo que podría llevar; pregunta si quiere añadir algo más; ofrece ayuda para completar el pedido o para seguir hablando del tema (cuidados, variedades, dónde cultivar).

═══════════════════════════════════════════════
EJEMPLOS DE BUENAS RESPUESTAS
═══════════════════════════════════════════════

EJEMPLO 1 - Cliente elige producto:
Usuario: "me llevo el peral conferencia"
Tú: "¡Buena elección! El Peral Conferencia es muy productivo y resistente. 
¿Lo vas a plantar en tierra o en maceta? Si es maceta, necesitarás una de al menos 40-50L para que desarrolle bien las raíces.
También te recomiendo un sustrato para frutales y, si quieres asegurar una buena cosecha, un abono específico para perales. ¿Te busco opciones?"

EJEMPLO 2 - Siempre texto antes del producto (OBLIGATORIO):
Usuario: "tienes limonero eureka"
Tú: [busca limonero eureka; hay 1 resultado]
Tú: "Claro, tenemos Limonero Eureka en web.

**LIMONERO EUREKA (4 estaciones)**
![Limonero Eureka](/api/articulos/image/...)
Precio: 25,50 € · Stock: 17 · Ref: 00022876
[Ver producto](...)

Es limonero de cuatro estaciones, muy productivo. ¿Lo quieres para maceta o para tierra? Si es maceta, te recomiendo también sustrato y abono para cítricos."

EJEMPLO 3 - Mencionar tienda física:
Usuario: "tienes manzanos?"
Tú: "En la web ahora mismo tenemos el Manzano Golden a €15.90 (3 unidades).
En nuestra tienda física en Totana hay más variedades: Fuji, Reineta, Granny Smith... Si puedes acercarte, tienes más donde elegir.
¿Cuál te interesa más?"

EJEMPLO 4 - Mantener contexto:
Usuario: "quiero algo resistente al frío"
Tú: [busca plantas resistentes al frío]
Usuario: "vale, ¿y frutales?"
Tú: "Para frutales resistentes al frío te van perfecto los perales, manzanos y cerezos. Son de los que mejor aguantan temperaturas bajas. ¿Tienes preferencia por alguno?"

EJEMPLO 5 - Datos solo de la descripción (NUNCA inventar):
Usuario: "a qué altura crece el ciprés común"
Tú: [busca ciprés común; la descripción dice "puede alcanzar 30 m de talla", "porte columnar o piramidal", "setos o cortavientos"]
Tú: "El ciprés común (Cupressus sempervirens) puede alcanzar unos 30 m de talla, con porte columnar o piramidal. Se utiliza formando setos o como cortavientos. [Si la descripción incluye riego o plantación, añádelo.] ¿Quieres que te busque cipreses disponibles o complementos?"

EJEMPLO 6 - Explicar qué es cada producto al mostrarlo:
Usuario: "dime un fungicida"
Tú: [busca fungicida; un resultado es "ENFERMEDADES RO..." y la descripción dice que es para enfermedades de rosales]
Tú: "Aquí tienes un fungicida que tenemos disponible: es específico para **enfermedades de rosales**. [Luego la card con nombre, imagen, precio, Ver producto.] Si buscas fungicida para otra planta (tomate, frutales, etc.), dímelo y te busco."

EJEMPLO 7 - Pregunta abierta: NO buscar, conversar primero (OBLIGATORIO):
Usuario: "Quiero hacer un huerto, que me aconsejas de plantas hortícolas que tengáis en existencias por ejemplo."
Tú: NO llames a buscar_productos. Responde por ejemplo:
"Para empezar un huerto lo primero es decidir qué te gustaría cultivar: por ejemplo tomate, lechuga, pimiento o calabacín son muy habituales y dan buena cosecha. ¿Tienes ya idea de qué quieres plantar o prefieres algo que crezca rápido para ver resultados pronto? También importa si vas a cultivar en maceta o en bancal. Cuando me digas qué te apetece (lechugas, tomates, etc.) te busco exactamente qué tenemos en stock y te lo recomiendo."
Usuario: "pues algo de lechugas"
Tú: [ahora SÍ llamas buscar_productos("lechuga") y muestras resultados con intro y cierre]

═══════════════════════════════════════════════

NUNCA:
- Llames a buscar_productos en preguntas abiertas ("qué me aconsejas para un huerto", "qué plantas tenéis") sin antes conversar y que el usuario concrete qué buscar.
- Respondas siempre con el mismo formato de lista.
- Ignores lo que el cliente dijo antes.
- Olvides mencionar la tienda física.
- Dejes ir al cliente sin ofrecer complementarios.
- Seas robótico o repetitivo.

RECUERDA: Eres un asesor que conversa y razona; solo buscas en catálogo cuando hay algo concreto que buscar. No eres un bot que lista productos ante cualquier mención de "huerto" o "plantas".

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
// BÚSQUEDA – API Artículos (tiempo real)
// ============================================

// ============================================
// HERRAMIENTAS PARA LA IA
// ============================================
const tools = [
  {
    type: 'function',
    function: {
      name: 'buscar_productos',
      description: 'Busca productos en el catálogo por término concreto. Usar SOLO cuando el usuario pida algo específico (ej. "tienes tomates", "búscame lechugas", "sustrato"); NO usar en preguntas abiertas ("qué me aconsejas para un huerto", "plantas hortícolas que tengáis") sin que antes haya concretado qué buscar. Puedes llamar varias veces con distintos términos; busca planta principal y complementarios (macetas, sustratos, abonos).',
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
// Permitir que el widget (widget.html, iframe) se incruste en cualquier página, p. ej. PrestaShop
app.use(function(req, res, next) {
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  res.removeHeader('X-Frame-Options');
  next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Proxy de imagen PrestaShop: primero solo ws_key; si 403, reintentar con Basic Auth (como en otro proyecto)
async function proxyProductImage(req, res) {
  if (!usePrestaShopDirect) return res.status(404).end();
  const { productId, imageId } = req.params;
  const url = `${ARTICULOS_API_URL}/images/products/${productId}/${imageId}?${prestaShopQueryImage()}`;
  try {
    let r = await fetch(url, { headers: {} });
    if (r.status === 403) {
      r = await fetch(url, { headers: prestaShopAuth() });
    }
    if (!r.ok) {
      console.warn(`PrestaShop image ${productId}/${imageId}: ${r.status}`);
      return res.status(r.status).end();
    }
    const contentType = r.headers.get('content-type') || 'image/jpeg';
    res.setHeader('content-type', contentType);
    res.setHeader('cache-control', 'public, max-age=3600');
    const buf = await r.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (e) {
    console.warn('Proxy image error:', e.message);
    res.status(502).end();
  }
}

app.get('/api/chat/image/:productId/:imageId', proxyProductImage);
app.get('/api/articulos/image/:productId/:imageId', proxyProductImage);

// Listado de productos para página de prueba de imágenes (mismo formato que el otro proyecto)
app.get('/api/articulos/products', async (req, res) => {
  if (!usePrestaShopDirect) return res.json([]);
  try {
    await ensureProductsCache();
    const list = productsCache.slice(0, 50).map((p) => ({
      id: p.id,
      imageId: p.imageId || null,
      reference: p.reference || '',
      denominacion: p.name || '',
      linkProducto: p.product_url || '',
      precioFinal: p.price_tax_incl != null ? p.price_tax_incl : p.price,
      stock: p.stock != null ? String(p.stock) : '—'
    }));
    res.json(list);
  } catch (e) {
    res.status(500).json([]);
  }
});

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
        timestamp: m.timestamp || null,
        products: m.products || null
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
  console.log('📩 POST /api/chat');
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
    
    console.log('\n' + '─'.repeat(60));
    console.log(`👤 USUARIO [${safeDeviceId.slice(0, 12)}...] "${message}"`);
    
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
    let lastSearchProducts = [];
    
    // Loop de búsquedas
    while (assistantMessage.tool_calls && searchCount < 6) {
      console.log('\n🔧 BÚSQUEDAS DE ARTÍCULOS:');
      
      const toolResults = [];
      
      for (const call of assistantMessage.tool_calls) {
        if (call.function.name === 'buscar_productos') {
          const args = JSON.parse(call.function.arguments);
          const termino = (args.termino || '').trim();
          const soloWeb = !!args.solo_web;
          console.log(`  📌 buscar_productos( termino="${termino}", solo_web=${soloWeb} )`);
          
          const products = await searchProductsFromAPI(args.termino, args.solo_web || false);
          lastSearchProducts = lastSearchProducts.concat(products);
          
          if (products.length === 0) {
            console.log(`  ❌ Encontrados: 0`);
          } else {
            console.log(`  ✅ Encontrados: ${products.length} producto(s):`);
            products.forEach((p) => {
              const name = (p.name || 'Sin nombre').slice(0, 50);
              const ref = p.reference || '—';
              const price = formatPrice(p.price_tax_incl) || formatPrice(p.price) || '—';
              const stock = p.stock != null ? String(p.stock) : '—';
              console.log(`    • ${name} | Ref: ${ref} | ${price} | Stock: ${stock}`);
              const desc = (p.description || '').trim();
              if (desc) {
                const preview = desc.slice(0, 120) + (desc.length > 120 ? '…' : '');
                console.log(`      Descripción: "${preview}"`);
              } else {
                console.log(`      Descripción: (sin descripción)`);
              }
            });
          }
          
          const formatted = products.length > 0
            ? products.map(formatProductForTool).join('\n')
            : 'No encontrado. Intenta con otro término.';
          toolResults.push({
            tool_call_id: call.id,
            role: 'tool',
            content: formatted
          });
          searchCount++;
        }
      }
      
      if (toolResults.length > 0) console.log('  → Resultados enviados a la IA.');
      
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
    
    let reply = assistantMessage.content || 'No pude procesar tu consulta. ¿Puedes reformularla?';
    // Fallback: si hay productos y la respuesta empieza directamente con el producto (sin texto intro), anteponer una frase para que el usuario vea siempre texto antes de la card
    if (lastSearchProducts.length > 0 && /^\s*\*\*[^*]+\*\*/.test(reply.trim())) {
      reply = 'Claro, aquí tienes:\n\n' + reply;
    }
    const savedProducts = lastSearchProducts.length > 0
      ? lastSearchProducts.map((p) => ({
          id: p.id,
          imageId: p.imageId || null,
          name: p.name || '',
          price: formatPrice(p.price_tax_incl) || formatPrice(p.price) || 'Consultar',
          stock: p.stock != null ? String(p.stock) : 'Consultar',
          reference: p.reference || '',
          product_url: p.product_url || 'https://plantasdehuerto.com/'
        }))
      : null;
    conv.messages.push({ 
      role: 'assistant', 
      content: reply, 
      timestamp: new Date().toISOString(),
      products: savedProducts
    });
    
    // Guardar en Firestore (async, no bloquea respuesta)
    saveConversationToDB(safeDeviceId, conv.messages).catch(e => 
      console.error('❌ Save async:', e.message)
    );
    
    console.log('\n💬 RESPUESTA');
    if (searchCount === 0) console.log('   (sin búsquedas)');
    console.log(`   Búsquedas: ${searchCount} | Respuesta: ${reply.length} caracteres`);
    const withImage = lastSearchProducts.filter((p) => p.imageId || p.image_url).length;
    if (lastSearchProducts.length > 0) console.log(`   Imagen: ${withImage} productos con imageId enviados al cliente (misma URL que test-imagenes)`);
    console.log('─'.repeat(60) + '\n');

    const payload = { message: reply, deviceId: safeDeviceId };
    if (lastSearchProducts.length > 0) {
      payload.products = lastSearchProducts.map((p) => ({
        id: p.id,
        imageId: p.imageId || null,
        name: p.name || '',
        price: formatPrice(p.price_tax_incl) || formatPrice(p.price) || 'Consultar',
        stock: p.stock != null ? String(p.stock) : 'Consultar',
        reference: p.reference || '',
        product_url: p.product_url || 'https://plantasdehuerto.com/'
      }));
    }
    res.json(payload);

  } catch (error) {
    console.error('❌ /api/chat:', error.message);
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
    articulos: usePrestaShopDirect ? (productsCache.length ? `${productsCache.length} en cache` : 'sin cache') : 'no',
    firebase: db ? 'ok' : 'no'
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Puerto ${PORT} | http://localhost:${PORT}\n`);
});
