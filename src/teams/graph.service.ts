/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';

@Injectable()
export class GraphService {
  private graphClient?: Client;
  private credential?: ClientSecretCredential;
  private webhookUrl?: string;

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
  ) {
    // Configurar Webhook URL (método preferido para enviar mensajes)
    this.webhookUrl = this.configService.get<string>('teamsWebhookUrl');

    if (this.webhookUrl) {
      console.log(
        '✅ GraphService: Webhook URL configurado (método preferido)',
      );
    } else {
      console.log(
        '⚠️ GraphService: TEAMS_WEBHOOK_URL no configurado. Intentando usar Graph API...',
      );
    }

    // Configurar Graph API solo si es necesario (para leer mensajes)
    try {
      const tenantId = this.configService.get<string>('teamsTenantId');
      const clientId = this.configService.get<string>('teamsClientId');
      const clientSecret = this.configService.get<string>('teamsClientSecret');

      if (tenantId && clientId && clientSecret) {
        console.log('🔐 GraphService: Configurando credenciales de Azure...', {
          tenantId: tenantId.substring(0, 8) + '...',
          clientId: clientId.substring(0, 8) + '...',
          clientSecretPresent: !!clientSecret,
        });

        // 1. Credenciales de Azure
        this.credential = new ClientSecretCredential(
          tenantId,
          clientId,
          clientSecret,
        );

        // 2. Proveedor de Autenticación oficial
        const authProvider = new TokenCredentialAuthenticationProvider(
          this.credential,
          {
            scopes: ['https://graph.microsoft.com/.default'],
          },
        );

        // 3. Inicialización del cliente
        this.graphClient = Client.initWithMiddleware({
          authProvider: authProvider,
        });

        console.log('✅ GraphService: Cliente de Microsoft Graph inicializado');
      } else {
        console.log(
          '⚠️ GraphService: Credenciales de Graph API no configuradas (solo lectura)',
        );
      }
    } catch (error) {
      console.error('❌ GraphService: Error configurando Graph API:', error);
      // No lanzar error, ya que podemos usar webhooks
    }
  }

  async replyToThread(
    threadId: string,
    content: string,
    userName: string,
    userPhone: string,
  ) {
    // Los webhooks no soportan respuestas directas a hilos
    // En su lugar, enviamos el mensaje con contexto del hilo
    if (this.webhookUrl) {
      console.log(
        `📤 Enviando respuesta a hilo ${threadId} vía Webhook (los webhooks no soportan hilos directamente)`,
      );
      // Enviar como mensaje nuevo con referencia al hilo en el contenido
      // Usar el mismo formato que sendMessageToChannel para mantener consistencia
      const message = {
        '@type': 'MessageCard',
        '@context': 'https://schema.org/extensions',
        summary: `Nuevo mensaje de WhatsApp de ${userName} - Teléfono: ${userPhone}`,
        themeColor: '25D366',
        title: `📱 Nuevo mensaje de WhatsApp - ${userName}`,
        sections: [
          {
            activityTitle: `Usuario: ${userName}`,
            activitySubtitle: `Teléfono: ${userPhone}`,
            facts: [
              {
                name: 'Usuario:',
                value: userName,
              },
              {
                name: 'Teléfono:',
                value: userPhone,
              },
              {
                name: 'Mensaje:',
                value: content,
              },
            ],
            text: `Usuario: ${userName}\nTeléfono: ${userPhone}\n\nMensaje:\n${content}`,
            markdown: true,
          },
        ],
      };

      try {
        await lastValueFrom(
          this.httpService.post(this.webhookUrl, message, {
            headers: {
              'Content-Type': 'application/json',
            },
          }),
        );
        console.log('✅ Respuesta enviada a Teams vía Webhook');
        return { id: `reply_${Date.now()}` };
      } catch (error: any) {
        console.error(
          '❌ Error enviando respuesta vía Webhook:',
          error?.message,
        );
        throw error;
      }
    }

    // Fallback a Graph API (requiere permisos delegados)
    if (!this.graphClient) {
      throw new Error(
        'Graph API no configurado y webhook no disponible para responder a hilos',
      );
    }

    const teamId = this.configService.get<string>('teamsTeamId');
    const channelId = this.configService.get<string>('teamsChannelId');

    const reply = {
      body: {
        contentType: 'html',
        content: content,
      },
    };

    // Esta ruta permite responder a un mensaje específico creando un hilo
    return await this.graphClient
      .api(
        `/teams/${teamId}/channels/${channelId}/messages/${threadId}/replies`,
      )
      .post(reply);
  }

  async sendMessageToChannel(
    userName: string,
    userPhone: string,
    content: string,
  ) {
    // Priorizar webhook si está configurado (método más simple y confiable)
    if (this.webhookUrl) {
      return await this.sendMessageViaWebhook(userName, userPhone, content);
    }

    // Fallback a Graph API (requiere permisos delegados, no funciona con app-only)
    console.log(
      '⚠️ Webhook no configurado, intentando usar Graph API (puede fallar con app-only auth)',
    );
    throw new Error(
      'TEAMS_WEBHOOK_URL no configurado. Por favor configura un Incoming Webhook en Teams.',
    );
  }

  /**
   * Envía un mensaje a Teams usando Incoming Webhook (método recomendado)
   */
  private async sendMessageViaWebhook(
    userName: string,
    userPhone: string,
    content: string,
  ) {
    if (!this.webhookUrl) {
      throw new Error('TEAMS_WEBHOOK_URL no está configurado');
    }

    // Formato de mensaje para Teams Webhook (soporta HTML básico)
    // Incluimos el número de teléfono en el text también para poder extraerlo después
    const message = {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      summary: `Nuevo mensaje de WhatsApp de ${userName} - Teléfono: ${userPhone}`,
      themeColor: '25D366',
      title: `📱 Nuevo mensaje de WhatsApp - ${userName}`,
      sections: [
        {
          activityTitle: `Usuario: ${userName}`,
          activitySubtitle: `Teléfono: ${userPhone}`,
          facts: [
            {
              name: 'Usuario:',
              value: userName,
            },
            {
              name: 'Teléfono:',
              value: userPhone,
            },
            {
              name: 'Mensaje:',
              value: content,
            },
          ],
          text: `Usuario: ${userName}\nTeléfono: ${userPhone}\n\nMensaje:\n${content}`,
          markdown: true,
        },
      ],
    };

    try {
      console.log('📤 Enviando mensaje a Teams vía Webhook...');
      await lastValueFrom(
        this.httpService.post(this.webhookUrl, message, {
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );

      // Los webhooks de Teams no retornan un ID de mensaje, así que generamos uno
      // basado en timestamp y phone number para tracking
      const messageId = `webhook_${Date.now()}_${userPhone.replace(/\D/g, '')}`;

      console.log('✅ Mensaje enviado exitosamente a Teams vía Webhook');
      return { id: messageId };
    } catch (error: any) {
      console.error('❌ Error enviando mensaje vía Webhook:', {
        message: error?.message,
        status: error?.response?.status,
        data: error?.response?.data,
      });
      throw new Error(
        `Error enviando mensaje a Teams: ${error?.message || 'Error desconocido'}`,
      );
    }
  }

  /**
   * Verifica que el canal de Teams existe y es accesible
   */
  async verifyChannelAccess(teamId: string, channelId: string): Promise<boolean> {
    if (!this.graphClient) {
      return false;
    }

    try {
      console.log(`🔍 Verificando acceso al canal: teams/${teamId}/channels/${channelId}`);
      const channel = await this.graphClient
        .api(`/teams/${teamId}/channels/${channelId}`)
        .get();
      
      console.log('✅ Canal accesible:', {
        id: channel.id,
        displayName: channel.displayName,
      });
      return true;
    } catch (error: any) {
      console.error('❌ Error verificando acceso al canal:', {
        message: error?.message,
        code: error?.code,
        teamId,
        channelId,
      });
      return false;
    }
  }

  /**
   * Crea una suscripción de Microsoft Graph API para recibir eventos de mensajes
   * en el canal de Teams especificado
   */
  async createSubscription(): Promise<any> {
    if (!this.graphClient) {
      throw new Error('Graph API no está configurado');
    }

    const teamId = this.configService.get<string>('teamsTeamId');
    const channelId = this.configService.get<string>('teamsChannelId');
    const publicUrl = this.configService.get<string>('publicUrl');

    if (!teamId || !channelId) {
      throw new Error('TEAMS_TEAM_ID y TEAMS_CHANNEL_ID son requeridos');
    }

    if (!publicUrl) {
      throw new Error(
        'PUBLIC_URL es requerido para recibir notificaciones de Graph API',
      );
    }

    // Verificar que el canal es accesible antes de crear la suscripción
    const hasAccess = await this.verifyChannelAccess(teamId, channelId);
    if (!hasAccess) {
      throw new Error(
        `No se puede acceder al canal. Verifica que TEAMS_TEAM_ID y TEAMS_CHANNEL_ID sean correctos y que la aplicación tenga los permisos necesarios (ChannelMessage.Read.All, etc.)`,
      );
    }

    // URL del webhook donde recibiremos las notificaciones
    const notificationUrl = `${publicUrl}/teams/webhook/notification`;

    // Crear suscripción para recibir eventos de mensajes en el canal
    // Solo 'created' para evitar procesar actualizaciones de mensajes antiguos
    const subscription = {
      changeType: 'created',
      notificationUrl: notificationUrl,
      lifecycleNotificationUrl: notificationUrl, // Requerido para suscripciones > 1 hora
      resource: `/teams/${teamId}/channels/${channelId}/messages`,
      expirationDateTime: new Date(
        Date.now() + 3 * 24 * 60 * 60 * 1000,
      ).toISOString(), // 3 días (máximo permitido)
      clientState: 'secret-state-value', // Opcional: para validar que las notificaciones vienen de Microsoft
    };

    try {
      console.log('📡 Creando suscripción de Graph API...', {
        resource: subscription.resource,
        notificationUrl: notificationUrl,
      });
      const result = await this.graphClient
        .api('/subscriptions')
        .post(subscription);

      console.log('✅ Suscripción creada exitosamente:', result.id);
      return result;
    } catch (error: any) {
      console.error('❌ Error creando suscripción:', {
        message: error?.message,
        code: error?.code,
        body: error?.body,
        resource: subscription.resource,
      });
      
      // Proporcionar mensajes de error más útiles
      if (error?.code === 'ExtensionError' && error?.message?.includes('NotFound')) {
        throw new Error(
          `El recurso no fue encontrado. Verifica:\n` +
          `1. Que TEAMS_TEAM_ID (${teamId}) y TEAMS_CHANNEL_ID (${channelId}) sean correctos\n` +
          `2. Que la aplicación tenga permisos: ChannelMessage.Read.All, ChannelMessage.Send\n` +
          `3. Que el canal exista y sea accesible para la aplicación`
        );
      }
      
      throw error;
    }
  }

  /**
   * Renueva una suscripción existente (las suscripciones expiran después de 3 días)
   */
  async renewSubscription(subscriptionId: string): Promise<any> {
    if (!this.graphClient) {
      throw new Error('Graph API no está configurado');
    }

    const expirationDateTime = new Date(
      Date.now() + 3 * 24 * 60 * 60 * 1000,
    ).toISOString();

    try {
      console.log(`🔄 Renovando suscripción ${subscriptionId}...`);
      const result = await this.graphClient
        .api(`/subscriptions/${subscriptionId}`)
        .patch({ expirationDateTime });

      console.log('✅ Suscripción renovada exitosamente');
      return result;
    } catch (error: any) {
      console.error('❌ Error renovando suscripción:', error?.message);
      throw error;
    }
  }

  /**
   * Obtiene un mensaje específico de Teams usando Graph API
   */
  async getMessage(teamId: string, channelId: string, messageId: string) {
    if (!this.graphClient) {
      throw new Error('Graph API no está configurado');
    }

    try {
      const message = await this.graphClient
        .api(`/teams/${teamId}/channels/${channelId}/messages/${messageId}`)
        .get();

      return message;
    } catch (error: any) {
      console.error('❌ Error obteniendo mensaje:', error?.message);
      throw error;
    }
  }

  /**
   * Obtiene una respuesta (reply) específica de un mensaje en Teams
   */
  async getReply(
    teamId: string,
    channelId: string,
    parentMessageId: string,
    replyId: string,
  ) {
    if (!this.graphClient) {
      throw new Error('Graph API no está configurado');
    }

    try {
      const reply = await this.graphClient
        .api(
          `/teams/${teamId}/channels/${channelId}/messages/${parentMessageId}/replies/${replyId}`,
        )
        .get();

      return reply;
    } catch (error: any) {
      console.error('❌ Error obteniendo reply:', error?.message);
      throw error;
    }
  }

  /**
   * Lista todas las suscripciones activas
   */
  async listSubscriptions(): Promise<any[]> {
    if (!this.graphClient) {
      throw new Error('Graph API no está configurado');
    }

    try {
      const response = await this.graphClient.api('/subscriptions').get();
      return response.value || [];
    } catch (error: any) {
      console.error('❌ Error listando suscripciones:', error?.message);
      throw error;
    }
  }

  /**
   * Elimina una suscripción
   */
  async deleteSubscription(subscriptionId: string): Promise<void> {
    if (!this.graphClient) {
      throw new Error('Graph API no está configurado');
    }

    try {
      await this.graphClient.api(`/subscriptions/${subscriptionId}`).delete();
      console.log(`✅ Suscripción ${subscriptionId} eliminada`);
    } catch (error: any) {
      console.error('❌ Error eliminando suscripción:', error?.message);
      throw error;
    }
  }

  /**
   * Intenta crear o renovar la suscripción automáticamente
   * Elimina suscripciones expiradas y crea una nueva si es necesario
   */
  async ensureSubscription(): Promise<any> {
    if (!this.graphClient) {
      console.log(
        '⚠️ Graph API no configurado, no se puede crear suscripción automática',
      );
      return null;
    }

    const teamId = this.configService.get<string>('teamsTeamId');
    const channelId = this.configService.get<string>('teamsChannelId');
    const publicUrl = this.configService.get<string>('publicUrl');

    if (!teamId || !channelId) {
      console.log(
        '⚠️ TEAMS_TEAM_ID y TEAMS_CHANNEL_ID son requeridos para suscripciones',
      );
      return null;
    }

    if (!publicUrl) {
      console.log(
        '⚠️ PUBLIC_URL no configurado, no se puede crear suscripción automática',
      );
      return null;
    }

    try {
      // Listar suscripciones existentes
      const subscriptions = await this.listSubscriptions();
      const resource = `/teams/${teamId}/channels/${channelId}/messages`;
      const notificationUrl = `${publicUrl}/teams/webhook/notification`;

      // Buscar suscripción existente para este recurso
      const existingSubscription = subscriptions.find(
        (sub: any) =>
          sub.resource === resource &&
          sub.notificationUrl === notificationUrl,
      );

      if (existingSubscription) {
        const expirationDate = new Date(existingSubscription.expirationDateTime);
        const now = new Date();
        const hoursUntilExpiration =
          (expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60);

        // Si la suscripción expira en menos de 24 horas, renovarla
        if (hoursUntilExpiration < 24) {
          console.log(
            `🔄 Suscripción existente expira pronto (${hoursUntilExpiration.toFixed(1)} horas), renovando...`,
          );
          return await this.renewSubscription(existingSubscription.id);
        } else {
          console.log(
            `✅ Suscripción activa encontrada (expira en ${hoursUntilExpiration.toFixed(1)} horas)`,
          );
          return existingSubscription;
        }
      }

      // Si no hay suscripción, crear una nueva
      console.log('📡 No hay suscripción activa, creando una nueva...');
      return await this.createSubscription();
    } catch (error: any) {
      console.error('❌ Error asegurando suscripción:', {
        message: error?.message,
        code: error?.code,
        body: error?.body,
      });
      // No lanzar error para no bloquear el inicio de la aplicación
      return null;
    }
  }
}
