/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
// UsernamePasswordCredential está deprecado pero es necesario para permisos delegados
import { UsernamePasswordCredential } from '@azure/identity';
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
    this.webhookUrl = this.configService.get<string>('teamsWebhookUrl');
    this.initializeGraphClient();
  }
  private initializeGraphClient() {
    // Configurar Graph API solo si es necesario (para leer mensajes)
    try {
      const tenantId = this.configService.get<string>('teamsTenantId');
      const clientId = this.configService.get<string>('teamsClientId');
      const clientSecret = this.configService.get<string>('teamsClientSecret');

      // Credenciales del bot de Teams
      const botEmail = this.configService.get<string>('teamsBotEmail');
      const botPassword = this.configService.get<string>('teamsBotPassword');

      let credential;

      if (tenantId && clientId && botEmail && botPassword) {
        console.log(
          '🔐 GraphService: Configurando credenciales Azure de ${botEmail}',
        );

        // UsernamePasswordCredential está deprecado pero es necesario para permisos delegados
        // Se mantiene intencionalmente para autenticación con permisos delegados
        credential = new UsernamePasswordCredential(
          botEmail,
          botPassword,
          tenantId,
          clientId,
        );
      } else if (tenantId && clientId && clientSecret) {
        // OPCIÓN B: Autenticación de Aplicación (Solo lectura o Migración)
        // ❌ Esto fallará al intentar enviar mensajes normales
        console.warn(
          '⚠️ GraphService: Usando Client Secret (App Context). El envío de mensajes fallará.',
        );

        // 1. Credenciales de Azure
        this.credential = new ClientSecretCredential(
          tenantId,
          clientId,
          clientSecret,
        );
        credential = this.credential;
      }

      if (credential) {
        // Proveedor de Autenticación oficial
        const authProvider = new TokenCredentialAuthenticationProvider(
          credential,
          {
            scopes: ['https://graph.microsoft.com/.default'],
          },
        );

        // Inicialización del cliente
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
    }
  }

  async sendMessageToChannel(
    userName: string,
    userPhone: string,
    content: string,
  ) {
    // Si tenemos cliente de Graph configurado como Usuario, lo usamos (soporta hilos)
    if (this.graphClient) {
      const teamId = this.configService.get<string>('teamsTeamId');
      const channelId = this.configService.get<string>('teamsChannelId');

      const message = {
        body: {
          contentType: 'html',
          content: `<b>Usuario:</b> ${userName}<br><b>Teléfono:</b> ${userPhone}<br><br>${content}`,
        },
      };

      // Enviamos mensaje raíz al canal
      const result = await this.graphClient
        .api(`/teams/${teamId}/channels/${channelId}/messages`)
        .post(message);

      console.log('✅ Mensaje raíz enviado vía Graph API. ID:', result.id);
      return { id: result.id }; // Retorna el ID REAL de Teams
    }

    throw new Error(
      'TEAMS_WEBHOOK_URL no configurado. Por favor configura un Incoming Webhook en Teams.',
    );
  }

  async replyToThread(
    threadId: string,
    content: string,
    userName: string,
    userPhone: string,
  ) {
    // Verificar si intentamos responder a un ID falso de webhook
    if (threadId.startsWith('webhook_')) {
      console.warn(
        '⚠️ Intentando responder a un ID de Webhook. Se enviará como mensaje nuevo.',
      );
      return this.sendMessageToChannel(userName, userPhone, content);
    }

    if (!this.graphClient) {
      throw new Error('Graph API requerida para responder hilos.');
    }

    const teamId = this.configService.get<string>('teamsTeamId');
    const channelId = this.configService.get<string>('teamsChannelId');

    const reply = {
      body: {
        contentType: 'html',
        content: `${content}`, // El contenido de la respuesta
      },
    };

    // Endpoint específico para replies
    await this.graphClient
      .api(
        `/teams/${teamId}/channels/${channelId}/messages/${threadId}/replies`,
      )
      .post(reply);

    console.log(`✅ Respuesta enviada al hilo ${threadId}`);
  }

  /**
   * Verifica que el canal de Teams existe y es accesible
   */
  async verifyChannelAccess(
    teamId: string,
    channelId: string,
  ): Promise<boolean> {
    if (!this.graphClient) {
      return false;
    }

    try {
      console.log(
        `🔍 Verificando acceso al canal: teams/${teamId}/channels/${channelId}`,
      );
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
      if (
        error?.code === 'ExtensionError' &&
        error?.message?.includes('NotFound')
      ) {
        throw new Error(
          `El recurso no fue encontrado. Verifica:\n` +
            `1. Que TEAMS_TEAM_ID (${teamId}) y TEAMS_CHANNEL_ID (${channelId}) sean correctos\n` +
            `2. Que la aplicación tenga permisos: ChannelMessage.Read.All, ChannelMessage.Send\n` +
            `3. Que el canal exista y sea accesible para la aplicación`,
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
          sub.resource === resource && sub.notificationUrl === notificationUrl,
      );

      if (existingSubscription) {
        const expirationDate = new Date(
          existingSubscription.expirationDateTime,
        );
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
