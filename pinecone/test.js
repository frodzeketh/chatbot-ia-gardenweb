// Test Pinecone v2
require('dotenv').config({ path: '../.env' });
const { Pinecone } = require('@pinecone-database/pinecone');

async function test() {
  console.log('🔗 Conectando a Pinecone v2...');
  
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const index = pc.index(process.env.PINECONE_INDEX);
  
  console.log('📊 Stats:');
  const stats = await index.describeIndexStats();
  console.log(stats);
  
  // Vector de prueba
  const vectors = [
    {
      id: 'test_001',
      values: Array(512).fill(0).map(() => Math.random()),
      metadata: { name: 'Test' }
    }
  ];
  
  console.log('\n🧪 Upsert test...');
  try {
    await index.upsert(vectors);
    console.log('✅ Upsert exitoso!');
    
    // Verificar
    const newStats = await index.describeIndexStats();
    console.log('📊 Nuevo total:', newStats.totalRecordCount);
  } catch (e) {
    console.log('❌ Error:', e.message);
  }
}

test().catch(console.error);
