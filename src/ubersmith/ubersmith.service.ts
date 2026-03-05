import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class UbersmithService {
  private readonly logger = new Logger(UbersmithService.name);

  constructor(private configService: ConfigService) {}

  async getCustomerProfileLink(phoneNumber: string): Promise<string | null> {
    // 1. Obtenemos credenciales desde tu archivo configuration.ts
    const apiUrl = this.configService.get<string>('ubersmith.apiUrl');
    const apiUser = this.configService.get<string>('ubersmith.apiUser');
    const apiPass = this.configService.get<string>('ubersmith.apiPass');

    if (!apiUrl || !apiUser || !apiPass) {
      this.logger.warn('Configuración Ubersmith incompleta (apiUrl, apiUser o apiPass).');
      return null;
    }

    try {
      // Limpiamos el número (quitamos el '+' o espacios si los hay)
      const cleanPhone = phoneNumber.replace(/\D/g, ''); 
      
      // 2. BUSCAR LA INFORMACIÓN DEL USUARIO (API de Ubersmith)
      // Usamos el método client.list y el parámetro 'search' (o 'phone' dependiendo de tu versión de Ubersmith)
      const response = await axios.get(`${apiUrl}?method=client.list`, {
        auth: {
          username: apiUser,
          password: apiPass, // En Ubersmith suele ser un API Token en el campo password
        },
        params: { 
          search: cleanPhone 
        }
      });

      const clients = response.data.data;

      // 3. OBTENER EL CLIENT ID
      // Ubersmith suele devolver un objeto donde las llaves son los IDs de los clientes
      // Ejemplo: { "1234": { "clientid": "1234", "first": "Juan", ... } }
      if (clients && Object.keys(clients).length > 0) {
        
        const clientId = Object.keys(clients)[0]; // Tomamos el primer ID que coincida
        
        // 4. GENERAR LA URL DEL PERFIL
        // Normalmente en Ubersmith, la URL del perfil del cliente se ve así:
        const profileUrl = `https://billing.gofiberx.com/admmin/clientmgr/client_profile.php?=clientid=${clientId}`;
        
        this.logger.log(`Cliente encontrado en Ubersmith. ClientID: ${clientId}`);
        return profileUrl;
      }

      this.logger.warn(`No se encontró cliente en Ubersmith para el teléfono: ${cleanPhone}`);
      return null;

    } catch (error) {
      this.logger.error(`Error consultando Ubersmith: ${error.message}`);
      return null;
    }
  }
}