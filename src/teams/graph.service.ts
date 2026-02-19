/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  ConfigurationServiceClientCredentialFactory,
  TurnContext,
  ConversationParameters,
  Channels,
  Activity,
  Attachment,
} from 'botbuilder';

@Injectable()
export class GraphService implements OnModuleInit {
  public adapter: CloudAdapter;
  private appId: string;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    this.initializeBotAdapter();
  }

  private initializeBotAdapter() {
    const appId = this.configService.get<string>('MICROSOFT_APP_ID');
    const appPassword = this.configService.get<string>('MICROSOFT_APP_PASSWORD');
    const tenantId = this.configService.get<string>('MICROSOFT_APP_TENANT_ID');

    if (!appId || !appPassword || !tenantId) {
      console.error('❌ Faltan credenciales del Bot (AppID, Password o TenantID)');
      return;
    }

    this.appId = appId;

    const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
      MicrosoftAppId: appId,
      MicrosoftAppPassword: appPassword,
      MicrosoftAppType: 'SingleTenant',
      MicrosoftAppTenantId: tenantId,
    });

    const botFrameworkAuthentication = new ConfigurationBotFrameworkAuthentication(
      {},
      credentialsFactory,
    );

    this.adapter = new CloudAdapter(botFrameworkAuthentication);
    
    this.adapter.onTurnError = async (context, error) => {
      console.error(`\n [onTurnError] unhandled error: ${error}`);
      await context.sendTraceActivity(
        'OnTurnError Trace',
        `${error}`,
        'https://www.botframework.com/schemas/error',
        'TurnError'
      );
    };

    console.log('🤖 Bot Adapter inicializado correctamente (Client Credentials)');
  }

  /**
   * Helper privado para procesar los buffers y convertirlos en Attachments de Teams
   */
  private buildAttachment(fileBuffer?: Buffer, mimetype?: string, fileName?: string, messageId?: string): Attachment | null {
    if (!fileBuffer || !mimetype) return null;

    // 1. Si es imagen, usamos Base64 nativo (Soportado por Teams)
    if (mimetype.startsWith('image/')) {
      const base64Image = fileBuffer.toString('base64');
      return {
        contentType: mimetype,
        contentUrl: `data:${mimetype};base64,${base64Image}`,
        name: fileName || 'imagen_whatsapp.jpg',
      };
    }


    // 2. Si es PDF, requiere URL pública.
    // Asumimos que guardaste el Buffer en MongoDB y este endpoint lo devuelve.
    // En desarrollo, 'tu-dominio' será tu URL de ngrok.
    if (mimetype.startsWith('application/pdf') || mimetype.startsWith('application/')) {
      const publicDomain = this.configService.get<string>('PUBLIC_APP_URL'); // ej: https://tu-ngrok.app
      const downloadUrl = `${publicDomain}/media/download/${messageId}`; 
      
      return {
        contentType: mimetype,
        contentUrl: downloadUrl,
        name: fileName || 'documento.pdf',
      };
    }

    return null;
  }

  /**
   * Crea un nuevo hilo en Teams con un "Ticket" de cabecera
   * y envía el mensaje del usuario como primera respuesta.
   */
  async sendMessageToChannel(
    userName: string,
    userPhone: string,
    content: string,
    fileBuffer?: Buffer,
    mimetype?: string,
    fileName?: string,
    messageId?: string,
  ): Promise<{ id: string }> {
    const channelId = this.configService.get<string>('teamsChannelId');
    const tenantId = this.configService.get<string>('MICROSOFT_APP_TENANT_ID');
    const serviceUrl = 'https://smba.trafficmanager.net/amer/';

    // 1. DISEÑO DEL ENCABEZADO
    const rootActivity = {
      type: 'message',
      text: `👤 <b>Cliente:</b> ${userName}<br>📱 <b>WhatsApp:</b> +${userPhone}<br>🟢 <b>Estado:</b> Nuevo Chat`,
      textFormat: 'xml',
    };

    const conversationParameters = {
      isGroup: true,
      channelData: {
        channel: { id: channelId },
        tenant: { id: tenantId },
      },
      activity: rootActivity,
    } as ConversationParameters;

    let newConversationId = '';

    // 2. CREAR EL HILO
    await this.adapter.createConversationAsync(
      this.appId,
      Channels.Msteams,
      serviceUrl,
      '', // Usar null en lugar de '' es más seguro para el audience
      conversationParameters,
      async (context) => {
        const ref = TurnContext.getConversationReference(context.activity);
        
        // CORRECCIÓN 1: Usar ?. (optional chaining) y fallback para evitar error de undefined
        newConversationId = ref.conversation?.id || ''; 
        console.log('✅ Hilo creado. ID:', newConversationId);

        // 3. ENVIAR EL CONTENIDO REAL
        await this.replyToThreadInternal(context, content, fileBuffer, mimetype, fileName, messageId);
      },
    );

    return { id: newConversationId };
  }

  /**
   * Helper interno para responder inmediatamente.
   * CORRECCIÓN 2: Ya no recibimos threadId, usamos el context directo.
   */
  private async replyToThreadInternal(
    context: TurnContext,
    content: string,
    fileBuffer?: Buffer,
    mimetype?: string,
    fileName?: string,
    messageId?: string,
  ) {
      // Pequeña pausa estética
      await new Promise(r => setTimeout(r, 500)); 

      // CORRECCIÓN 2: Definimos el tipo Partial<Activity> y quitamos 'conversation'
      // Al usar context.sendActivity, el bot ya sabe que debe responder en ESTE hilo.
      const replyActivity: Partial<Activity> = {
          type: 'message',
          text: content,
          textFormat: 'xml',
          attachments: []
      };


      // Intentamos construir el adjunto
      const attachment = this.buildAttachment(fileBuffer, mimetype, fileName, messageId);
      
      if (attachment) {
        replyActivity.attachments!.push(attachment);
        
        // Si es PDF, a Teams le gusta que le reforcemos con un texto clickable
        if (attachment.contentType.includes('pdf')) {
            replyActivity.text += `<br><br>📎 <b>Documento recibido:</b> <a href="${attachment.contentUrl}">Descargar ${fileName || 'PDF'}</a>`;
        }
      }

      await context.sendActivity(replyActivity);
  }

  // ... (El resto de métodos createNewThread y replyToThread los puedes dejar igual
  // o borrarlos si ya no los usas, pero aquí te dejo replyToThread corregido por si acaso)

  async replyToThread(
    threadId: string,
    content: string,
    fileBuffer?: Buffer,
    mimetype?: string,
    fileName?: string,
    messageId?: string
  ) {
    const serviceUrl = 'https://smba.trafficmanager.net/amer/';
    
    const conversationReference = {
        conversation: { id: threadId },
        serviceUrl: serviceUrl,
    };

    await this.adapter.continueConversationAsync(
        this.appId,
        conversationReference as any,
        async (context) => {
            // 1. Creamos la actividad base (solo una vez)
            const replyActivity = {
              type: 'message',
              text: content,
              textFormat: 'xml',
              attachments: [] as any[]
            };

            // 2. Intentamos construir y agregar el adjunto
            const attachment = this.buildAttachment(fileBuffer, mimetype, fileName, messageId);
            
            if (attachment) {
              replyActivity.attachments.push(attachment);
              
              if (typeof attachment.contentType === 'string' && attachment.contentType.includes('pdf')) {
                replyActivity.text += `<br><br>📎 <b>Documento recibido:</b> <a href="${attachment.contentUrl}">Descargar ${fileName || 'PDF'}</a>`;
              }
            }

            // 3. Enviamos a Teams UNA SOLA VEZ
            await context.sendActivity(replyActivity);
            console.log(`✅ Respuesta enviada al hilo ${threadId}`);
        }
      );
  }
}
