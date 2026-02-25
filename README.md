# 🤖 Omni-Channel Bot Backend – WhatsApp + Teams + NestJS

```plaintext
Sistema backend corporativo para atención omnicanal, con:

✅ Webhook de recepción bidireccional Meta API / Teams
✅ Integración proactiva con Microsoft Graph y Bot Framework
✅ Escaneo de seguridad (ClamAV) contra malware en adjuntos
✅ Persistencia de sesiones relacionales con TypeORM + SQLite
✅ Descarga, conversión y publicación de archivos multimedia
✅ Docker y Docker Compose listos para producción
```

---

# 📑 Índice

    🔎 Descripción General

    📁 Estructura del Proyecto

    🏗 Arquitectura del Sistema

    ⚙️ Configuración del Entorno

    ☁️ Configuración en Azure y Teams

    🐳 Ejecución con Docker

    🧩 Diseño del Sistema

    💾 Modelo de Datos

    ⚠️ Reglas de Sesión y Enrutamiento

    🛡️ Seguridad (MIME & ClamAV)

    🧪 Pruebas y Verificación

    🚨 Troubleshooting

---

# 🔎 Descripción General

Este servicio actúa como un intermediario (Middleware) orquestador entre clientes finales comunicándose por WhatsApp y operadores de soporte o agentes de Microsoft Teams.

El sistema recibe un mensaje vía el webhook de Meta, evalúa si el usuario ya posee una sesión activa y, de ser así, inyecta el mensaje al hilo correspondiente en Teams. Si existen archivos multimedia, pasan previamente por un servicio antivirus en contenedor antes de ser expuestos en Teams. Las respuestas nativas del agente en Microsoft Teams son captadas por el Azure Bot Service y reenviadas transparentemente al número original de WhatsApp.

---

# 📁 Estructura del Proyecto

```plaintext

Bot-Manage-Messages-Whasapp-Teams/
├── src/
│   ├── app.module.ts
│   ├── common/                 → Entidades (Conversation, Message, Media)
│   ├── config/                 → Variables y validaciones de entorno
│   ├── conversations/          → Gestión del estado (OPEN/CLOSED)
│   ├── media/                  → Descarga y procesamiento de archivos WA
│   ├── messages/               → Prevención de duplicidad e historial
│   ├── security/               → ClamAV y control de riesgos
│   ├── teams/                  → Integración de Graph, Bot Framework y webhooks
│   │   ├── teams-bot.handler.ts→ Escucha de respuestas en los hilos
│   │   └── graph.service.ts    → Peticiones al canal y manipulación
│   └── whatsapp/               → Webhooks de Meta y llamadas Graph de WA
├── data/                       → Volumen para SQLite persistente
├── env.template
├── docker-compose.yml
├── dockerfile
└── package.json
```

---

# 🏗 Arquitectura del Sistema

<p align="center">
  <img src="./docs/arquitectura-flujo.jpg" alt="Diagrama de Flujo del Bot Omnicanal" width="850">
</p>
<p align="center">
  <em>Flujo de mensajes bidireccional entre WhatsApp y Microsoft Teams.</em>
</p>

```plaintext

A[Cliente WhatsApp] <-->|API de Meta| B[WhatsApp Controller]
B --> C[Validación de Duplicados & Sesión]
C -->|Adjunto detectado| D[Media Service]
D -->|Buffer de red| E[ClamAV Container]
E -->|Limpio| F[Persistencia Base de Datos SQLite]
E -->|Infectado| X[Bloqueo FileSecurityBlockedError]
F -->|Nuevo Cliente| G[Graph Service: Crear Hilo Teams]
F -->|Cliente Existente| H[Graph Service: Responder Hilo Teams]
I[Operador Teams] -->|Respuesta Bot| J[Teams Bot Handler]
J --> K[Reenvío a Meta API WhatsApp]
```

---

# ⚙️ Configuración del Entorno

## 1) ⚙️ Archivo .env

### 💻 Aplicación y Puerto
PORT=3000

--------------------------------------------------------
### 🟢 CREDENCIALES DEL BOT (Azure Bot Service)
--------------------------------------------------------
MICROSOFT_APP_ID=uuid_generado_en_azure_ad

MICROSOFT_APP_PASSWORD=secreto_generado_en_azure_ad

MICROSOFT_APP_TENANT_ID=uuid_del_tenant_de_microsoft

MICROSOFT_APP_TYPE=SingleTenant

--------------------------------------------------------
### 🔵 CONFIGURACIÓN DE TEAMS
--------------------------------------------------------
TEAMS_CHANNEL_ID=19:xxxxxxxx@thread.tacv2 # Canal central de recepción

TEAMS_TEAM_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx # ID del grupo de M365

TEAMS_BOT_NAME=Nombre del bot (nombres de azure bot, teams bot y esta variable deben iguales)

--------------------------------------------------------
### 🟢 WHATSAPP API (Meta)
--------------------------------------------------------
WHATSAPP_TOKEN=token_permanente_graph_api

WHATSAPP_PHONE_ID=id_del_numero_telefonico

WHATSAPP_VERIFY_TOKEN=token_manual_para_webhook

--------------------------------------------------------
### 🌍 URL PÚBLICA (Ngrok o Producción)
--------------------------------------------------------
IMPORTANTE: Esta URL es necesaria para:
- Recibir webhooks de Azure Bot y WhatsApp
- Servir archivos multimedia a Teams (imágenes, videos, documentos)
- Sin esta URL correcta, los archivos NO se mostrarán en Teams

PUBLIC_URL=https://tu-url-ngrok.ngrok-free.app

--------------------------------------------------------
### 🛡️ SEGURIDAD
--------------------------------------------------------
ENABLE_CLAMAV=false or true # con true se habilita el uso del antivirus

CLAMAV_HOST=clamav-service

CLAMAV_PORT=3310

--------------------------------------------------------

## 2) ☁️ Configuración en Azure y Teams


Para el correcto funcionamiento del Bot, la infraestructura corporativa debe inicializarse de la siguiente forma:

    Azure Active Directory (App Registration):

        Crear una aplicación de Inquilino Único (Single Tenant).

        Generar el secreto en Certificates & Secrets.

        Consolidar permisos en API Permissions si es necesario para leer archivos de Microsoft Graph.
          -ChannelMessage.Read.All
          -ChannelMessage.UpdatePolicyViolation.All
          -Files.Read.All
          -Sites.Read.All 

    Azure Bot (Recurso):

        Enlazar el MICROSOFT_APP_ID.

        En el Endpoint de Mensajería, configurar la URL donde esté desplegado tu proyecto bajo HTTPS apuntando a /api/messages. (esta URL debe ser:"PUBLIC_URL/teams/webhook/messages")

        Agregar el "Canal" de Microsoft Teams a tu Bot de Azure.

    Manifest y MS Teams:

        Usar el Developer Portal de Teams para compilar tu bot y cargarlo en el TEAMS_TEAM_ID.

        El bot debe tener acceso al canal específico indicado en TEAMS_CHANNEL_ID para ser capaz de inyectar hilos proactivos y responder.
---

# 🐳 Ejecución con Docker

Ejecutar:

```bash
docker compose up --build
```

El proceso:

    Inicia un contenedor de ClamAV (clamav-service) para antivirus de red.

    Inicia el contenedor principal en Node.js cargando las reglas de NestJS.

    El volumen /data de SQLite se expone de forma persistente.

    El puerto 3000 queda expuesto para integraciones de proxy inverso (Nginx) y SSL.

Para ver registros en tiempo real:

```bash
docker logs -f customer_service_bot
```

---

# 🧩 Diseño del Sistema

✔ Manejo de Estados (ConversationsService) Se usa la llave de teléfono del cliente (waPhoneNumber) y el status: 'OPEN' para localizar en TypeORM el puntero hacia la conversación actual en Teams (teamsThreadId).

✔ Prevención de Webhook Duplicados Meta reintenta envíos si se excede el TTL o hay pérdida de paquetes. Se mantiene una memoria viva y validación en SQLite (messageExistsByWaId) para dropear solicitudes duplicadas.

✔ Protección con ClamAV (FileSecurityService) A diferencia de retransmisiones ciegas, todo buffer del cliente se interseca. Si detecta malware, lanza un error tipado FileSecurityBlockedError que cancela la inserción a la red corporativa.

✔ Respuestas Inversas (Teams -> WA) El TeamsBotHandler atrapa cualquier actividad type === 'message'. Filtra si el remitente role === 'bot' para evitar ciclos infinitos y luego usa el activity.conversation.id de Teams para rastrear el ID telefónico en la DB y publicar de vuelta a Meta.

---

# 💾 Modelo de Datos

Estructura referencial manejada por TypeORM / SQLite:

```plaintext
conversations
{
  "id": "uuid",
  "waPhoneNumber": "573000000000",
  "teamsThreadId": "19:xxx@thread.tacv2;messageid=123",
  "status": "OPEN", // OPEN | CLOSED
  "createdAt": "timestamp"
}

messages
{
  "id": "uuid",
  "conversationId": "uuid_conversacion",
  "whatsappId": "wamid.xxxxxx",
  "teamsMessageId": "16542131234",
  "content": "Hola, necesito soporte",
  "direction": "INBOUND" // INBOUND | OUTBOUND
}

media_attachments
{
  "id": "uuid",
  "messageId": "uuid_del_mensaje",
  "mimetype": "image/jpeg",
  "fileName": "ticket_12.jpg",
  "isScanned": true,
  "publicUrl": "https://midominio.com/media/ticket_12.jpg"
}
```
---

# ⚠️ Reglas de Sesión y Enrutamiento
Condición de Entrada WhatsApp:

    Si un teléfono ingresa por 1ra vez o su último registro está CLOSED ➡️ Crea Hilo Padre en Teams.

    Si un teléfono tiene un registro OPEN ➡️ Realiza un replyToThread concatenando al hilo existente.

Condición de Entrada Teams:

    Solo se procesan respuestas que provengan dentro de un Hilo. No se leerán mensajes aislados creados por fuera de un teamsThreadId registrado en DB.

Formatos soportados: Texto plano, imágenes (image/jpeg, image/png) y documentos que logren pasar la criba de seguridad.

---

# 🛡️ Seguridad (MIME & ClamAV)

El manejo de archivos adjuntos provenientes de usuarios externos (WhatsApp) hacia una red corporativa (Microsoft Teams) representa una de las superficies de ataque más críticas. Este proyecto implementa un modelo preventivo de confianza cero (*Zero Trust*) dividido en dos capas para la ingesta de medios:

### 1. Validación de Tipos (MIME Type Checking)
Antes de siquiera descargar el cuerpo del archivo, el sistema valida el tipo MIME (`mimetype`) reportado por la API de Meta.

* **Lista Blanca (Allowlist):** El sistema restringe el procesamiento exclusivamente a formatos esperados y seguros (como `image/jpeg`, `image/png`, `application/pdf`, etc.).
* **Prevención de Suplantación (Spoofing):** Esta capa evita ataques básicos donde un usuario malintencionado intenta enviar un script o un archivo ejecutable camuflado (por ejemplo, enviando un `virus.exe` renombrado maliciosamente a `foto.jpg`). Si el MIME no está autorizado, la petición se descarta.

### 2. Escaneo Antimalware Aislado (ClamAV)
Si el archivo aprueba el filtro MIME, es sometido a un análisis heurístico y de firmas profundas utilizando el motor de código abierto **ClamAV**, bajo una arquitectura segura:

* **Escaneo al Vuelo (In-Memory Buffer):** El `MediaService` de NestJS descarga el archivo desde WhatsApp y lo mantiene únicamente como un *Buffer* en la memoria RAM. **El archivo crudo nunca toca el disco duro del servidor.**
* **Análisis TCP Externo:** Ese *Buffer* se envía por la red interna de Docker (puerto `3310`) hacia el contenedor de `clamav-service`, el cual está completamente aislado del entorno de ejecución de Node.js.
* **Toma de Decisiones (Veredicto):**
  * ✅ **Si ClamAV responde `OK` (Limpio):** El archivo se autoriza, se persiste en la base de datos y se expone a Microsoft Teams.
  * ❌ **Si ClamAV responde `FOUND` (Malware detectado):** El motor lanza instantáneamente un `FileSecurityBlockedError`. El flujo de ejecución se corta de inmediato, el *Buffer* se purga de la memoria RAM y la amenaza es neutralizada antes de poder infiltrarse en el *tenant* de Microsoft de la empresa.

---

# 🧪 Pruebas y Verificación

✅ Validar Conexión de Webhook (Meta)
Puedes consultar la validación de suscripción en el navegador o terminal:
```bash
curl "http://localhost:3000/whatsapp/webhook?hub.mode=subscribe&hub.challenge=1234&hub.verify_token=[TU_VERIFY_TOKEN]"
```
✅ Simular Fallo Antivirus local
Puedes enviar el estándar antimalware EICAR por WhatsApp al bot para garantizar que caiga en el FileSecurityBlockedError y se bloquee.

---

# 🚨 Troubleshooting
❌ "Error de Verificación" / HTTP 403 en WhatsApp
Asegúrate de que la variable WHATSAPP_VERIFY_TOKEN coincida exactamente con el portal para Desarrolladores de Meta y el túnel HTTPS esté activo.

❌ El bot responde en Teams pero no llega el mensaje al cliente
El Token permanente (WHATSAPP_TOKEN) puede estar vencido o tu aplicación de Meta está en modo "SandBox/Desarrollo" y estás respondiendo a un teléfono no testeado de la lista blanca.

❌ Aparecen respuestas múltiples del bot / desorden en los hilos
No se está completando exitosamente el código 200 OK al webhook de Meta lo suficientemente rápido, por ende Meta dispara el webhook nuevamente y tu caché no detecta el ID. Revisa tiempos de respuesta al crear hilos de Teams.

❌ "FileSecurityBlockedError" constante
El contenedor clamav-service no tiene base de firmas actualizadas o las políticas restringen por extensión general. Verifica los logs del antivirus.