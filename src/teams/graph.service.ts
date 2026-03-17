/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UbersmithService } from '../ubersmith/ubersmith.service';
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

  constructor(private configService: ConfigService, private readonly ubersmithService: UbersmithService) {}

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
  const ubersmithUrl = await this.ubersmithService.getCustomerProfileLink(userPhone);

  // Construimos dinámicamente las acciones de la tarjeta (elementos de Adaptive Card)
  const cardActions: Array<{
    type: string;
    url: string;
    width: string;
    altText: string;
    tooltip: string;
    selectAction: { type: string; title: string; url: string };
  }> = [];

  // Solo si se encontró el cliente en Ubersmith, agregamos el botón
  if (ubersmithUrl) {
    cardActions.push({
      type: 'Image',
      url: 'data:image/png;base64,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',
      width: '25px',
      altText: 'Abrir perfil en Ubersmith',
      tooltip: 'Ver cliente en Ubersmith', // Tooltip nativo al pasar el mouse
      selectAction: {
        type: 'Action.OpenUrl',
        title: 'Ver Ubersmith',
        url: ubersmithUrl // Inyectamos la URL generada
        }
      });
    }

 // 1. Crear el diseño estético de la tarjeta (Adaptive Card) siguiendo el nuevo branding
const ticketCard = CardFactory.adaptiveCard({
  type: 'AdaptiveCard',
  $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
  version: '1.4',
  body: [
    {
      type: 'Container',
      backgroundImage: {
        url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJYAAADIAQMAAAAwS4omAAAAA1BMVEVCQHPtEQv3AAAACXBIWXMAAA7EAAAOxAGVKw4bAAAAG0lEQVRIie3BMQEAAADCoPVPbQwfoAAAAIC3AQ+gAAEq5xQCAAAAAElFTkSuQmCC',
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
            // Solo si hay URL de Ubersmith: columna con el botón (cardActions son elementos Image)
            ...(cardActions.length > 0
              ? [
                  {
                    type: 'Column',
                    width: 'auto',
                    spacing: 'Medium',
                    verticalContentAlignment: 'Center',
                    items: cardActions
                  }
                ]
              : []),
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
                    title: 'Bloquear Número',
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
