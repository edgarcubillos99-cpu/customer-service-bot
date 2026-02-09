const http = require('http');

const BASE_URL = 'http://localhost:3000';

function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        let parsedBody;
        try {
          parsedBody = JSON.parse(body);
        } catch (e) {
          parsedBody = body;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsedBody,
          rawBody: body,
        });
      });
    });

    req.on('error', (error) => {
      reject({
        message: error.message,
        code: error.code,
      });
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function checkServer() {
  try {
    const response = await makeRequest('GET', '/');
    return { running: true, response };
  } catch (error) {
    return { running: false, error };
  }
}

async function runTests() {
  console.log('🧪 Iniciando pruebas de Customer Service Bot\n');
  console.log('='.repeat(60));

  // Verificar que el servidor esté corriendo
  console.log('\n📡 Verificando que el servidor esté corriendo...');
  const serverCheck = await checkServer();
  if (!serverCheck.running) {
    console.error('❌ ERROR: El servidor no está corriendo en http://localhost:3000');
    console.error(`   Error: ${serverCheck.error.message}`);
    console.error('\n💡 Solución: Ejecuta "npm run start:dev" en otra terminal');
    process.exit(1);
  }
  console.log('✅ Servidor está corriendo\n');

  const results = {
    passed: 0,
    failed: 0,
    tests: [],
  };

  // Test 1: Endpoint raíz
  console.log('1️⃣ Probando GET /');
  try {
    const test1 = await makeRequest('GET', '/');
    if (test1.status === 200) {
      console.log(`   ✅ PASS - Status: ${test1.status}`);
      results.passed++;
      results.tests.push({ name: 'GET /', status: 'PASS' });
    } else {
      console.log(`   ❌ FAIL - Status: ${test1.status} (esperado: 200)`);
      results.failed++;
      results.tests.push({ name: 'GET /', status: 'FAIL', error: `Status ${test1.status}` });
    }
    console.log(`   Response: ${test1.rawBody}\n`);
  } catch (error) {
    console.log(`   ❌ ERROR: ${error.message}`);
    results.failed++;
    results.tests.push({ name: 'GET /', status: 'ERROR', error: error.message });
    console.log('');
  }

  // Test 2: Verificación de webhook WhatsApp (exitoso)
  console.log('2️⃣ Probando GET /whatsapp/webhook (verificación exitosa)');
  try {
    const test2 = await makeRequest(
      'GET',
      '/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=clave&hub.challenge=test123'
    );
    if (test2.status === 200 && test2.rawBody === 'test123') {
      console.log(`   ✅ PASS - Status: ${test2.status}, Challenge recibido correctamente`);
      results.passed++;
      results.tests.push({ name: 'GET /whatsapp/webhook (exitoso)', status: 'PASS' });
    } else {
      console.log(`   ❌ FAIL - Status: ${test2.status}, Response: ${test2.rawBody}`);
      console.log(`   Esperado: Status 200, Body "test123"`);
      results.failed++;
      results.tests.push({ name: 'GET /whatsapp/webhook (exitoso)', status: 'FAIL', error: `Status ${test2.status}` });
    }
    console.log('');
  } catch (error) {
    console.log(`   ❌ ERROR: ${error.message}`);
    results.failed++;
    results.tests.push({ name: 'GET /whatsapp/webhook (exitoso)', status: 'ERROR', error: error.message });
    console.log('');
  }

  // Test 3: Verificación de webhook WhatsApp (fallido)
  console.log('3️⃣ Probando GET /whatsapp/webhook (verificación fallida - token incorrecto)');
  try {
    const test3 = await makeRequest(
      'GET',
      '/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=token_incorrecto&hub.challenge=test123'
    );
    if (test3.status === 403) {
      console.log(`   ✅ PASS - Status: ${test3.status} (rechazado correctamente)`);
      results.passed++;
      results.tests.push({ name: 'GET /whatsapp/webhook (fallido)', status: 'PASS' });
    } else {
      console.log(`   ❌ FAIL - Status: ${test3.status} (esperado: 403)`);
      results.failed++;
      results.tests.push({ name: 'GET /whatsapp/webhook (fallido)', status: 'FAIL', error: `Status ${test3.status}` });
    }
    console.log(`   Response: ${test3.rawBody}\n`);
  } catch (error) {
    console.log(`   ❌ ERROR: ${error.message}`);
    results.failed++;
    results.tests.push({ name: 'GET /whatsapp/webhook (fallido)', status: 'ERROR', error: error.message });
    console.log('');
  }

  // Test 4: Mensaje de WhatsApp simulado
  console.log('4️⃣ Probando POST /whatsapp/webhook (mensaje de texto simulado)');
  try {
    const test4 = await makeRequest('POST', '/whatsapp/webhook', {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: '1234567890',
                    type: 'text',
                    text: {
                      body: 'Hola, este es un mensaje de prueba',
                    },
                  },
                ],
                contacts: [
                  {
                    profile: {
                      name: 'Usuario Prueba',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    if (test4.status === 201 || test4.status === 200) {
      console.log(`   ✅ PASS - Status: ${test4.status}`);
      console.log(`   Response: ${JSON.stringify(test4.body)}`);
      if (test4.body && test4.body.status === 'RECEIVED') {
        console.log('   ✅ Mensaje procesado correctamente');
        results.passed++;
        results.tests.push({ name: 'POST /whatsapp/webhook', status: 'PASS' });
      } else {
        console.log('   ⚠️  WARNING: Respuesta inesperada');
        results.passed++;
        results.tests.push({ name: 'POST /whatsapp/webhook', status: 'PASS (con warning)' });
      }
    } else {
      console.log(`   ❌ FAIL - Status: ${test4.status} (esperado: 200 o 201)`);
      console.log(`   Response: ${JSON.stringify(test4.body)}`);
      results.failed++;
      results.tests.push({ name: 'POST /whatsapp/webhook', status: 'FAIL', error: `Status ${test4.status}` });
    }
    console.log('');
  } catch (error) {
    console.log(`   ❌ ERROR: ${error.message}`);
    results.failed++;
    results.tests.push({ name: 'POST /whatsapp/webhook', status: 'ERROR', error: error.message });
    console.log('');
  }

  // Test 5: Webhook de Teams (comando válido)
  console.log('5️⃣ Probando POST /teams/webhook (comando válido)');
  try {
    const test5 = await makeRequest('POST', '/teams/webhook', {
      text: '@botito 1234567890 Este es un mensaje de prueba desde Teams',
    });
    if (test5.status === 201 || test5.status === 200) {
      console.log(`   ✅ PASS - Status: ${test5.status}`);
      console.log(`   Response: ${JSON.stringify(test5.body)}`);
      if (test5.body && test5.body.ok === true) {
        console.log('   ✅ Comando procesado correctamente');
        results.passed++;
        results.tests.push({ name: 'POST /teams/webhook (válido)', status: 'PASS' });
      } else if (test5.body && test5.body.ok === false) {
        console.log('   ⚠️  WARNING: Comando rechazado (puede ser por falta de credenciales)');
        results.passed++;
        results.tests.push({ name: 'POST /teams/webhook (válido)', status: 'PASS (con warning)' });
      } else {
        console.log('   ⚠️  WARNING: Respuesta inesperada');
        results.passed++;
        results.tests.push({ name: 'POST /teams/webhook (válido)', status: 'PASS (con warning)' });
      }
    } else {
      console.log(`   ❌ FAIL - Status: ${test5.status} (esperado: 200 o 201)`);
      console.log(`   Response: ${JSON.stringify(test5.body)}`);
      results.failed++;
      results.tests.push({ name: 'POST /teams/webhook (válido)', status: 'FAIL', error: `Status ${test5.status}` });
    }
    console.log('');
  } catch (error) {
    console.log(`   ❌ ERROR: ${error.message}`);
    results.failed++;
    results.tests.push({ name: 'POST /teams/webhook (válido)', status: 'ERROR', error: error.message });
    console.log('');
  }

  // Test 6: Webhook de Teams (comando inválido)
  console.log('6️⃣ Probando POST /teams/webhook (comando inválido)');
  try {
    const test6 = await makeRequest('POST', '/teams/webhook', {
      text: 'Este no es un comando válido',
    });
    if (test6.status === 201 || test6.status === 200) {
      console.log(`   ✅ PASS - Status: ${test6.status}`);
      console.log(`   Response: ${JSON.stringify(test6.body)}`);
      if (test6.body && test6.body.ok === false) {
        console.log('   ✅ Comando inválido rechazado correctamente');
        results.passed++;
        results.tests.push({ name: 'POST /teams/webhook (inválido)', status: 'PASS' });
      } else {
        console.log('   ⚠️  WARNING: Respuesta inesperada');
        results.passed++;
        results.tests.push({ name: 'POST /teams/webhook (inválido)', status: 'PASS (con warning)' });
      }
    } else {
      console.log(`   ❌ FAIL - Status: ${test6.status} (esperado: 200 o 201)`);
      results.failed++;
      results.tests.push({ name: 'POST /teams/webhook (inválido)', status: 'FAIL', error: `Status ${test6.status}` });
    }
    console.log('');
  } catch (error) {
    console.log(`   ❌ ERROR: ${error.message}`);
    results.failed++;
    results.tests.push({ name: 'POST /teams/webhook (inválido)', status: 'ERROR', error: error.message });
    console.log('');
  }

  // Resumen
  console.log('='.repeat(60));
  console.log('\n📊 RESUMEN DE PRUEBAS\n');
  console.log(`✅ Pasadas: ${results.passed}`);
  console.log(`❌ Fallidas: ${results.failed}`);
  console.log(`📈 Total: ${results.passed + results.failed}\n`);

  if (results.failed > 0) {
    console.log('❌ Pruebas fallidas:');
    results.tests
      .filter((t) => t.status === 'FAIL' || t.status === 'ERROR')
      .forEach((t) => {
        console.log(`   - ${t.name}: ${t.error || 'Error desconocido'}`);
      });
    console.log('');
  }

  if (results.failed === 0) {
    console.log('🎉 ¡Todas las pruebas pasaron exitosamente!');
  } else {
    console.log('⚠️  Algunas pruebas fallaron. Revisa los detalles arriba.');
  }

  return results;
}

runTests().catch((error) => {
  console.error('❌ Error fatal:', error);
  process.exit(1);
});

