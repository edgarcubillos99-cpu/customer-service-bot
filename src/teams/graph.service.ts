/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
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
  CardFactory,
} from 'botbuilder';

@Injectable()
export class GraphService implements OnModuleInit {
  private readonly logger = new Logger(GraphService.name);
  public adapter: CloudAdapter;
  private appId: string;
  private publicUrl: string;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    this.initializeBotAdapter();
    this.publicUrl = this.configService.get<string>('PUBLIC_URL') ?? '';
  }

  private initializeBotAdapter() {
    const appId = this.configService.get<string>('MICROSOFT_APP_ID');
    const appPassword = this.configService.get<string>('MICROSOFT_APP_PASSWORD');
    const tenantId = this.configService.get<string>('MICROSOFT_APP_TENANT_ID');

    if (!appId || !appPassword || !tenantId) {
      this.logger.error('❌ Faltan credenciales del Bot (AppID, Password o TenantID)');
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
      this.logger.error(`[onTurnError] unhandled error: ${error}`);
      await context.sendTraceActivity(
        'OnTurnError Trace',
        `${error}`,
        'https://www.botframework.com/schemas/error',
        'TurnError',
      );
    };

    this.logger.log('🤖 Bot Adapter inicializado correctamente');
  }

  /**
   * Construye un attachment nativo para Teams
   * Para imágenes usa base64 inline que funciona mejor que URLs externas
   */
  private buildMediaAttachment(
    mediaUrl: string,
    mimetype: string,
    fileName?: string,
    caption?: string,
    base64Data?: string,
  ): { attachment: Attachment | null; textMessage: string } {
    if (!mimetype) return { attachment: null, textMessage: '' };

    // Para imágenes: usar inline base64 si está disponible, sino URL
    if (mimetype.startsWith('image/')) {
      if (base64Data) {
        // Usar base64 inline - funciona mejor en Teams
        const imageAttachment: Attachment = {
          contentType: mimetype,
          contentUrl: `data:${mimetype};base64,${base64Data}`,
          name: fileName || 'imagen.jpg',
        };
        return { attachment: imageAttachment, textMessage: '' };
      } else if (mediaUrl) {
        // Fallback a URL
        const heroCard = CardFactory.heroCard(
          '',
          caption || '',
          [mediaUrl],
          [],
        );
        return { attachment: heroCard, textMessage: '' };
      }
    }

    // Para videos: Hero Card con botón para ver
    if (mimetype.startsWith('video/') && mediaUrl) {
      const heroCard = CardFactory.heroCard(
        '🎬 Video recibido',
        caption || fileName || 'video.mp4',
        [],
        [{ type: 'openUrl', title: '▶️ Ver Video', value: mediaUrl }],
      );
      return { attachment: heroCard, textMessage: '' };
    }

    // Para audio/notas de voz: Hero Card con botón para escuchar
    if (mimetype.startsWith('audio/') && mediaUrl) {
      const isVoiceNote = mimetype.includes('opus') || mimetype.includes('ogg');
      const heroCard = CardFactory.heroCard(
        isVoiceNote ? '🎤 Nota de voz' : '🎵 Audio recibido',
        caption || '',
        [],
        [{ type: 'openUrl', title: '🔊 Escuchar', value: mediaUrl }],
      );
      return { attachment: heroCard, textMessage: '' };
    }

    // Para documentos: Hero Card con botón de descarga
    if (mediaUrl) {
      const heroCard = CardFactory.heroCard(
        '📎 Documento recibido',
        `📄 ${fileName || 'documento'}${caption ? '\n' + caption : ''}`,
        [],
        [{ type: 'openUrl', title: '⬇️ Descargar', value: mediaUrl }],
      );
      return { attachment: heroCard, textMessage: '' };
    }

    return { attachment: null, textMessage: '' };
  }

  /**
   * Construye un Adaptive Card como alternativa (para casos donde Hero Card no funcione)
   */
  private buildAdaptiveCardForMedia(
    mediaUrl: string,
    mimetype: string,
    fileName?: string,
    caption?: string,
  ): Attachment | null {
    if (!mediaUrl || !mimetype) return null;

    // Imagen con Adaptive Card
    if (mimetype.startsWith('image/')) {
      const card = {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.3',
        body: [
          {
            type: 'Image',
            url: mediaUrl,
            size: 'stretch',
            altText: fileName || 'Imagen de WhatsApp',
          },
        ],
      };

      if (caption) {
        card.body.push({
          type: 'TextBlock',
          text: caption,
          wrap: true,
          size: 'small',
        } as any);
      }

      return CardFactory.adaptiveCard(card);
    }

    return null;
  }

  /**
   * Crea un nuevo hilo en Teams con un "Ticket" de cabecera
   */
  async sendMessageToChannel(
    userName: string,
    userPhone: string,
    content: string,
    mediaUrl?: string,
    mimetype?: string,
    fileName?: string,
    base64Data?: string,
  ): Promise<{ id: string }> {
    const channelId = this.configService.get<string>('teamsChannelId');
    const tenantId = this.configService.get<string>('MICROSOFT_APP_TENANT_ID');
    const serviceUrl = 'https://smba.trafficmanager.net/amer/';

    // Encabezado del hilo
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

    await this.adapter.createConversationAsync(
      this.appId,
      Channels.Msteams,
      serviceUrl,
      '',
      conversationParameters,
      async (context) => {
        const ref = TurnContext.getConversationReference(context.activity);
        newConversationId = ref.conversation?.id || '';
        this.logger.log(`✅ Hilo creado. ID: ${newConversationId}`);

        // Enviar el mensaje del cliente
        await this.replyToThreadInternal(context, content, mediaUrl, mimetype, fileName, base64Data);
      },
    );

    return { id: newConversationId };
  }

  /**
   * Helper interno para responder dentro de createConversationAsync
   */
  private async replyToThreadInternal(
    context: TurnContext,
    content: string,
    mediaUrl?: string,
    mimetype?: string,
    fileName?: string,
    base64Data?: string,
  ) {
    await new Promise((r) => setTimeout(r, 500)); // Pequeña pausa

    const replyActivity: Partial<Activity> = {
      type: 'message',
      text: content,
      textFormat: 'xml',
      attachments: [],
    };

    // Agregar media si existe
    if (mimetype && (mediaUrl || base64Data)) {
      this.logger.log(`📎 Adjuntando media: ${mimetype} - ${base64Data ? 'base64' : mediaUrl}`);
      
      const { attachment } = this.buildMediaAttachment(mediaUrl || '', mimetype, fileName, content, base64Data);
      if (attachment) {
        replyActivity.attachments!.push(attachment);
      }
    }

    await context.sendActivity(replyActivity);
  }

  /**
   * Responde a un hilo existente en Teams
   */
  async replyToThread(
    threadId: string,
    content: string,
    mediaUrl?: string,
    mimetype?: string,
    fileName?: string,
    base64Data?: string,
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
        const replyActivity: Partial<Activity> = {
          type: 'message',
          text: content,
          textFormat: 'xml',
          attachments: [],
        };

        // Agregar media si existe
        if (mimetype && (mediaUrl || base64Data)) {
          this.logger.log(`📎 Adjuntando media al hilo: ${mimetype} - ${base64Data ? 'base64' : mediaUrl}`);
          
          const { attachment } = this.buildMediaAttachment(mediaUrl || '', mimetype, fileName, undefined, base64Data);
          if (attachment) {
            replyActivity.attachments!.push(attachment);
          }
        }

        await context.sendActivity(replyActivity);
        this.logger.log(`✅ Respuesta enviada al hilo ${threadId}`);
      },
    );
  }
}
