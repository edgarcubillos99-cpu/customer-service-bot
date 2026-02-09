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

async function diagnosticarError() {
  console.log('🔍 DIAGNÓSTICO DETALLADO DEL ERROR\n');
  console.log('='.repeat(60));

  console.log('\n📋 Probando POST /teams/webhook con comando válido...\n');
  
  try {
    const response = await makeRequest('POST', '/teams/webhook', {
      text: '@botito 1234567890 Mensaje de prueba',
    });

    console.log(`Status Code: ${response.status}`);
    console.log(`Response Body: ${JSON.stringify(response.body, null, 2)}\n`);

    if (response.status === 500) {
      console.log('❌ ERROR 500 - Internal Server Error\n');
      console.log('🔎 Posibles causas:\n');
      
      if (response.body && response.body.message) {
        console.log(`   Mensaje del servidor: ${response.body.message}\n`);
      }

      console.log('   1. Falta la variable WHATSAPP_PHONE_ID en .env');
      console.log('   2. Falta la variable WHATSAPP_TOKEN en .env');
      console.log('   3. El token de WhatsApp es inválido o expiró');
      console.log('   4. El phoneId no existe o no está configurado correctamente');
      console.log('   5. Problema de conectividad con la API de Meta\n');

      console.log('💡 SOLUCIONES:\n');
      console.log('   1. Verifica que tu archivo .env tenga:');
      console.log('      WHATSAPP_TOKEN=tu_token_aqui');
      console.log('      WHATSAPP_PHONE_ID=tu_phone_id_aqui\n');
      console.log('   2. Verifica que el token sea válido en Meta for Developers');
      console.log('   3. Verifica que el phoneId corresponda a tu número de WhatsApp Business\n');
      console.log('   4. Revisa los logs del servidor para más detalles\n');
    } else if (response.status === 201 || response.status === 200) {
      if (response.body && response.body.ok === false) {
        console.log('⚠️  El comando fue procesado pero falló al enviar a WhatsApp');
        console.log(`   Razón: ${response.body.message || 'Desconocida'}\n`);
      } else {
        console.log('✅ El mensaje se procesó correctamente\n');
      }
    }
  } catch (error) {
    console.error('❌ Error de conexión:', error.message);
    console.error('   Asegúrate de que el servidor esté corriendo\n');
  }

  // Verificar variables de entorno (si es posible)
  console.log('📝 Verificando configuración...\n');
  console.log('   Nota: Las variables de entorno se cargan desde .env');
  console.log('   Verifica manualmente que tengas:\n');
  console.log('   ✓ WHATSAPP_TOKEN');
  console.log('   ✓ WHATSAPP_PHONE_ID\n');
}

diagnosticarError();

