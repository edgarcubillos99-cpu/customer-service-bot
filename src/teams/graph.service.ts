import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';

@Injectable()
export class GraphService {
  private graphClient: Client;
  private credential: ClientSecretCredential;

  constructor(private configService: ConfigService) {
    try {
      // Validar que todas las variables estén configuradas
      const tenantId = this.configService.get<string>('teamsTenantId');
      const clientId = this.configService.get<string>('teamsClientId');
      const clientSecret = this.configService.get<string>('teamsClientSecret');

      if (!tenantId || !clientId || !clientSecret) {
        console.error('❌ GraphService: Faltan variables de configuración:', {
          tenantId: tenantId ? '✓' : '✗',
          clientId: clientId ? '✓' : '✗',
          clientSecret: clientSecret ? '✓' : '✗',
        });
        throw new Error(
          'Faltan variables de configuración de Teams. Verifica TEAMS_TENANT_ID, TEAMS_CLIENT_ID, TEAMS_CLIENT_SECRET',
        );
      }

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

      // 3. Inicialización del cliente sin middlewares extraños para evitar errores de red
      this.graphClient = Client.initWithMiddleware({
        authProvider: authProvider,
      });

      console.log('✅ GraphService: Cliente de Microsoft Graph inicializado');
    } catch (error) {
      console.error('❌ GraphService: Error en constructor:', error);
      throw error;
    }
  }

  async sendMessageToChannel(
    userName: string,
    userPhone: string,
    content: string,
  ) {
    const teamId = this.configService.get<string>('teamsTeamId');
    const channelId = this.configService.get<string>('teamsChannelId');

    if (!teamId || !channelId) {
      throw new Error(
        `Faltan variables de configuración: teamId=${!!teamId}, channelId=${!!channelId}`,
      );
    }

    // Intentar obtener un token primero para diagnosticar el problema
    try {
      console.log('🔑 Intentando obtener token de Azure AD...');
      await this.credential.getToken(['https://graph.microsoft.com/.default']);
      console.log('✅ Token obtenido exitosamente');
    } catch (tokenError: any) {
      console.error('❌ Error al obtener token de Azure AD:', {
        message: tokenError?.message,
        code: tokenError?.code,
        name: tokenError?.name,
        statusCode: tokenError?.statusCode,
        cause: tokenError?.cause,
      });
      throw new Error(
        `Error de autenticación con Azure AD: ${tokenError?.message || 'Error desconocido'}`,
      );
    }

    // Estructura del mensaje en formato HTML para Teams
    const chatMessage = {
      body: {
        contentType: 'html',
        content: `
          <div style="border: 1px solid #e1e1e1; padding: 10px; border-left: 5px solid #25D366;">
            <h3 style="color: #075E54;">Nuevo mensaje de WhatsApp</h3>
            <b>Usuario:</b> ${userName}<br>
            <b>Teléfono:</b> ${userPhone}<br><br>
            <b>Mensaje:</b> ${content}
          </div>
        `,
      },
    };

    try {
      console.log(
        `📤 Enviando mensaje a Teams (Team: ${teamId.substring(0, 8)}..., Channel: ${channelId.substring(0, 8)}...)`,
      );
      // Petición a la API de Graph
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      const result = await this.graphClient
        .api(`/teams/${teamId}/channels/${channelId}/messages`)
        .post(chatMessage);
      console.log('✅ Mensaje enviado exitosamente a Teams');
      return result;
    } catch (error: any) {
      console.error('Error detallado en sendMessageToChannel:', {
        message: error?.message,
        code: error?.code,
        statusCode: error?.statusCode,
        body: error?.body,
        stack: error?.stack,
      });
      throw error;
    }
  }
}
