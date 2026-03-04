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
        [{ type: 'openUrl', title: '▶ Ver Video', value: mediaUrl }],
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
   * Intercepta mensajes que contienen una ubicación y los convierte en una tarjeta interactiva.
   */
  private formatLocationCard(content: string): { text: string; attachment?: Attachment } {
    // Detectamos si el mensaje tiene el formato de una ubicación
    if (content.includes('🌎 Ubicación:') || content.includes('maps.google.com') || content.includes('googleusercontent.com')) {
      
      // Extraer la URL del enlace usando Regex
      const urlMatch = content.match(/(https?:\/\/[^\s]+)/);
      const mapUrl = urlMatch ? urlMatch[0] : null;

      // Extraer las coordenadas
      const coordMatch = content.match(/Coordenadas:\s*([0-9.-]+,\s*[0-9.-]+)/i);
      const coordinates = coordMatch ? coordMatch[1] : 'Ubicación seleccionada';

      // Extraer el nombre del remitente (viene dentro de las etiquetas <b>)
      const nameMatch = content.match(/<b>(.*?)<\/b>:/);
      const senderName = nameMatch ? nameMatch[1] : 'El cliente';

      if (mapUrl) {
        // Construimos la tarjeta con el botón clickeable
        const card = CardFactory.heroCard(
          '🌎 Ubicación Compartida',
          [], // Sin imagen de previsualización
          [{ type: 'openUrl', title: '🗺️ Abrir en Google Maps', value: mapUrl }]
        );

        return {
          text: `<b>${senderName}:</b> Ha compartido una ubicación.`,
          attachment: card
        };
      }
    }
    
    // Si no es una ubicación, devolvemos el texto original sin cambios
    return { text: content };
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
   * Crea un nuevo hilo en Teams con un "Ticket" de cabecera usando Adaptive Cards
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

 // 1. Crear el diseño estético de la tarjeta (Adaptive Card) siguiendo el nuevo branding
const ticketCard = CardFactory.adaptiveCard({
  type: 'AdaptiveCard',
  $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
  version: '1.4',
  body: [
    {
      type: 'Container',
      backgroundImage: {
        url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwAAACoCAMAAABt9SM9AAAAA1BMVEUomfZleUz4AAAAR0lEQVR4nO3BAQEAAACCIP+vbkhAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAO8GxYgAAb0jQ/cAAAAASUVORK5CYII=',
        fillMode: 'repeat' // El píxel se repite hasta llenar la barra
      },
      bleed: true,
      items: [
        {
          type: 'ColumnSet',
          columns: [
            {
              type: 'Column',
              width: 'auto',
              verticalContentAlignment: 'Center',
              items: [
                {
                  type: 'Image',
                  // URL de icono de usuario o WhatsApp
                  url: 'data:image/png;base64,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',
                  size: 'medium',
                  style: 'Person'
                }
              ]
            },
            {
              type: 'Column',
              width: 'stretch',
              verticalContentAlignment: 'Center',
              items: [
                {
                  type: 'TextBlock',
                  text: `${userName || 'Desconocido'}`,
                  color: 'Light',
                  size: 'large',
                  weight: 'Bolder',
                  fontType: 'Default',
                  wrap: true
                },
                {
                  type: 'TextBlock',
                  text: `+${userPhone}`,
                  color: 'Light',
                  fontType: 'Default',
                  spacing: 'None',
                  size: 'Small'
                }
              ]
            }
          ]
        }
      ]
    },
    {
      type: 'Container',
      style: 'default',
      bleed: true,
      verticalContentAlignment: 'Center',
      items: [
        {
          type: 'ColumnSet',
          spacing: 'None',
          columns: [
            {
              type: 'Column',
              width: 'stretch' // Esta columna vacía empuja todo a la derecha
            },
            {
              type: 'Column',
              width: 'auto',
              items: [
                {
                  type: 'Image',
                  url: 'data:image/png;base64,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', 
                  width: '25px', // Controla el tamaño para que la barra se vea delgada
                  altText: 'Bloquear número',
                  // CLAVE: Esto convierte la imagen en un botón funcional
                  selectAction: {
                    type: 'Action.Submit',
                    data: {
                      action: 'block_user',
                      phoneNumber: userPhone
                    }
                  }
                }
              ]
            }
          ]
        }
      ]
    }
  ],
  // Los estilos globales se pueden aplicar aquí para el fondo blanco/negro
  msTeams: {
    width: 'full'
  }
});

  // 2. Adjuntar la tarjeta como la actividad principal del hilo
  const rootActivity: Partial<Activity> = {
    type: 'message',
    attachments: [ticketCard],
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

      // Enviar el mensaje del cliente inicial dentro de este nuevo hilo
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

    // Procesar el contenido por si es una ubicación
    const processedContent = this.formatLocationCard(content);

    // Si vamos a enviar una tarjeta (ubicación o archivo), no enviar el texto plano para evitar duplicado
    const hasLocationCard = !!processedContent.attachment;
    const willHaveMediaCard = !!(mimetype && (mediaUrl || base64Data));
    const textToSend = hasLocationCard || willHaveMediaCard ? '' : content;

    const replyActivity: Partial<Activity> = {
      type: 'message',
      text: textToSend,
      textFormat: 'xml',
      attachments: [],
    };

    // Agregar la tarjeta de ubicación si se generó
    if (processedContent.attachment) {
      replyActivity.attachments!.push(processedContent.attachment);
    }

    // Agregar media si existe
    if (mimetype && (mediaUrl || base64Data)) {
      this.logger.log(`📎 Adjuntando media: ${mimetype} - ${base64Data ? 'base64' : mediaUrl}`);

      const textForMedia = processedContent.attachment ? undefined : processedContent.text;
      
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
        //Procesar el contenido por si es una ubicación
        const processedContent = this.formatLocationCard(content);

        // Si vamos a enviar una tarjeta (ubicación o archivo), no enviar el texto plano para evitar duplicado
        const hasLocationCard = !!processedContent.attachment;
        const willHaveMediaCard = !!(mimetype && (mediaUrl || base64Data));
        const textToSend = hasLocationCard || willHaveMediaCard ? '' : content;

        const replyActivity: Partial<Activity> = {
          type: 'message',
          text: textToSend,
          textFormat: 'xml',
          attachments: [],
        };

        // Agregar la tarjeta de ubicación si se generó
        if (processedContent.attachment) {
          replyActivity.attachments!.push(processedContent.attachment);
        }

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
