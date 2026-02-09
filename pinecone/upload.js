/**
 * Subir artículos a Pinecone
 * Uso: node upload.js articulos.txt
 */

require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const INDEX_NAME = process.env.PINECONE_INDEX || 'products';

function parseArticulo(block) {
  const lines = block.trim().split('\n');
  const art = {};
  
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    
    const key = line.substring(0, i).trim().toLowerCase().replace(/\s+/g, '_');
    const val = line.substring(i + 1).trim();
    
    // Codigo siempre string
    if (key === 'codigo_referencia') {
      art[key] = val;
    } else if (/^\d+\.\d+$/.test(val)) {
      art[key] = parseFloat(val);
    } else if (/^\d+$/.test(val) && val.length < 10) {
      art[key] = parseInt(val);
    } else {
      art[key] = val;
    }
  }
  return art;
}

function createText(art) {
  const p = [];
  if (art.denominacion_familia && art.denominacion_familia !== 'N/A') p.push(art.denominacion_familia);
  if (art.denominacion_grupo && art.denominacion_grupo !== 'N/A') p.push(art.denominacion_grupo);
  if (art.denominacion_web && art.denominacion_web !== 'N/A') p.push(art.denominacion_web);
  if (art.descripcion_bandeja && art.descripcion_bandeja !== 'N/A') p.push(art.descripcion_bandeja);
  if (art.descripcion_de_cada_articulo && art.descripcion_de_cada_articulo !== 'N/A') p.push(art.descripcion_de_cada_articulo);
  if (p.length === 0) p.push(`Producto ${art.codigo_referencia}`);
  return p.join(' - ');
}

async function main(filePath) {
  console.log('📂 Leyendo:', filePath);
  
  const content = fs.readFileSync(filePath, 'utf-8');
  const articulos = content.split(/={3,}/)
    .map(b => parseArticulo(b))
    .filter(a => a.codigo_referencia);
  
  console.log(`✅ Artículos: ${articulos.length}`);
  console.log('📋 Ejemplo:', articulos[0].codigo_referencia, '-', createText(articulos[0]).substring(0, 50));
  
  const index = pc.index(INDEX_NAME);
  console.log(`\n🔗 Pinecone: ${INDEX_NAME}`);
  
  const BATCH = 50;
  let ok = 0, err = 0;
  
  console.log('📤 Subiendo...\n');
  
  for (let i = 0; i < articulos.length; i += BATCH) {
    const batch = articulos.slice(i, i + BATCH);
    const texts = batch.map(a => createText(a));
    
    try {
      // Embeddings en batch
      const resp = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: texts,
        dimensions: 512
      });
      
      const vectors = batch.map((art, j) => ({
        id: art.codigo_referencia,
        values: resp.data[j].embedding,
        metadata: art
      }));
      
      await index.upsert(vectors);
      ok += vectors.length;
      
    } catch (e) {
      err += batch.length;
      if (err <= 5) console.log(`\n❌ ${e.message}`);
    }
    
    process.stdout.write(`\r📤 ${ok}/${articulos.length} (${(i/articulos.length*100).toFixed(0)}%)`);
    await new Promise(r => setTimeout(r, 100));
  }
  
  console.log(`\n\n✅ Listo: ${ok} subidos, ${err} errores`);
}

const file = process.argv[2];
if (!file) {
  console.log('Uso: node upload.js articulos.txt');
  process.exit(1);
}

main(file).catch(e => console.error('❌', e.message));
