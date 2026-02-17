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
  Activity, // <--- Importante importar esto para los tipos
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
   * Crea un nuevo hilo en Teams con un "Ticket" de cabecera
   * y envía el mensaje del usuario como primera respuesta.
   */
  async sendMessageToChannel(
    userName: string,
    userPhone: string,
    content: string,
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
        await this.replyToThreadInternal(context, content);
      },
    );

    return { id: newConversationId };
  }

  /**
   * Helper interno para responder inmediatamente.
   * CORRECCIÓN 2: Ya no recibimos threadId, usamos el context directo.
   */
  private async replyToThreadInternal(context: TurnContext, content: string) {
      // Pequeña pausa estética
      await new Promise(r => setTimeout(r, 500)); 

      // CORRECCIÓN 2: Definimos el tipo Partial<Activity> y quitamos 'conversation'
      // Al usar context.sendActivity, el bot ya sabe que debe responder en ESTE hilo.
      const replyActivity: Partial<Activity> = {
          type: 'message',
          text: content,
          textFormat: 'xml',
      };
      
      await context.sendActivity(replyActivity);
  }

  // ... (El resto de métodos createNewThread y replyToThread los puedes dejar igual
  // o borrarlos si ya no los usas, pero aquí te dejo replyToThread corregido por si acaso)

  async replyToThread(threadId: string, content: string) {
    const serviceUrl = 'https://smba.trafficmanager.net/amer/';
    
    const conversationReference = {
        conversation: { id: threadId },
        serviceUrl: serviceUrl,
    };

    await this.adapter.continueConversationAsync(
        this.appId,
        conversationReference as any,
        async (context) => {
            await context.sendActivity({
                type: 'message',
                text: content,
                textFormat: 'xml'
            });
            console.log(`✅ Respuesta enviada al hilo ${threadId}`);
        }
    );
  }
}