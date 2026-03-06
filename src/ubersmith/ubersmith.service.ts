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

      // Construimos variantes: número completo y sin prefijo (1, 2 o 3 dígitos).
      // En Ubersmith a veces se guarda solo el número local (ej: Colombia 573103296471 -> 3103296471).
      const variantsToTry: string[] = [cleanPhone];
      if (cleanPhone.length > 8) variantsToTry.push(cleanPhone.slice(1));
      if (cleanPhone.length > 9) variantsToTry.push(cleanPhone.slice(2));
      if (cleanPhone.length > 10) variantsToTry.push(cleanPhone.slice(3));

      for (const phoneVariant of variantsToTry) {
        const response = await axios.get(apiUrl, {
          params: {
            method: 'client.lookup',
            phone: phoneVariant,
          },
          auth: {
            username: apiUser,
            password: apiPass,
          },
        });

        const clients = response.data.data;

        if (clients && Object.keys(clients).length > 0) {
          const clientId = Object.keys(clients)[0];
          const profileUrl = `https://billing.gofiberx.com/admin/clientmgr/client_profile.php?clientid=${clientId}`;
          this.logger.log(
            `Cliente encontrado en Ubersmith. ClientID: ${clientId} (búsqueda con: ${phoneVariant})`,
          );
          return profileUrl;
        }
      }

      this.logger.warn(
        `No se encontró cliente en Ubersmith para el teléfono: ${cleanPhone} (probadas variantes sin prefijo)`,
      );
      return null;

    } catch (error) {
      this.logger.error(`Error consultando Ubersmith: ${error.message}`);
      return null;
    }
  }
}
