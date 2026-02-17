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
} from 'botbuilder';

@Injectable()
export class GraphService implements OnModuleInit {
  public adapter: CloudAdapter; // Público para que el Controller lo use
  private appId: string;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    this.initializeBotAdapter();
  }

  private initializeBotAdapter() {
    // Asegúrate de tener estas variables en tu .env
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
    
    // Manejo de errores global del adaptador
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
   * Crea un nuevo hilo (conversación) en el canal de Teams
   */
  async sendMessageToChannel(
    userName: string,
    userPhone: string,
    content: string,
  ): Promise<{ id: string }> {
    const channelId = this.configService.get<string>('teamsChannelId');
    const tenantId = this.configService.get<string>('MICROSOFT_APP_TENANT_ID');
    const serviceUrl = 'https://smba.trafficmanager.net/amer/';

    const activity = {
      type: 'message',
      text: `<b>Usuario:</b> ${userName}<br><b>Teléfono:</b> ${userPhone}<br><br>${content}`,
      textFormat: 'xml',
    };

    const conversationParameters = {
      isGroup: true,
      channelData: {
        channel: { id: channelId },
        tenant: { id: tenantId },
      },
      activity: activity,
    } as ConversationParameters;

    let newConversationId = '';

    await this.adapter.createConversationAsync(
      this.appId,
      Channels.Msteams,
      serviceUrl,
      '', // Cambiado null a cadena vacía para cumplir con el tipo 'string'
      conversationParameters,
      async (context) => {
        const ref = TurnContext.getConversationReference(context.activity);
        if (ref.conversation && ref.conversation.id) {
          newConversationId = ref.conversation.id;
          console.log('✅ Hilo creado en Teams ID:', newConversationId);
        } else {
          console.error('❌ No se pudo obtener el ID de la conversación: ref.conversation es undefined.');
        }
      }
    );

    return { id: newConversationId };
  }

  /**
   * Crea un nuevo hilo en Teams con el contenido proporcionado
   */
  async createNewThread(
    content: string,
    attachmentUrl?: string,
  ): Promise<string> {
    const channelId = this.configService.get<string>('teamsChannelId');
    const tenantId = this.configService.get<string>('MICROSOFT_APP_TENANT_ID');
    const serviceUrl = 'https://smba.trafficmanager.net/amer/';

    // Si hay un attachment, agregarlo al contenido
    let messageText = content;
    if (attachmentUrl) {
      messageText += `<br><a href="${attachmentUrl}">Ver adjunto</a>`;
    }

    const activity = {
      type: 'message',
      text: messageText,
      textFormat: 'xml',
    };

    const conversationParameters = {
      isGroup: true,
      channelData: {
        channel: { id: channelId },
        tenant: { id: tenantId },
      },
      activity: activity,
    } as ConversationParameters;

    let newConversationId = '';

    await this.adapter.createConversationAsync(
      this.appId,
      Channels.Msteams,
      serviceUrl,
      '',
      conversationParameters,
      async (context) => {
        const ref = TurnContext.getConversationReference(context.activity);
        if (ref.conversation && ref.conversation.id) {
          newConversationId = ref.conversation.id;
          console.log('✅ Hilo creado en Teams ID:', newConversationId);
        } else {
          console.error('❌ No se pudo obtener el ID de la conversación: ref.conversation es undefined.');
        }
      }
    );

    return newConversationId;
  }

  /**
   * Responde a un hilo existente
   */
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
                textFormat: 'xml' // Permite usar negritas o saltos de línea simples
            });
            console.log(`✅ Respuesta enviada al hilo ${threadId}`);
        }
    );
  }
}
