import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class UbersmithService {
  private readonly logger = new Logger(UbersmithService.name);

  constructor(private configService: ConfigService) {}

  /**
   * Formato típico en Ubersmith para NANP (+1): 787-222-6780
   */
  private formatNanpDashed10(digits: string): string {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  }

  /**
   * Si solo hay 9 dígitos nacionales (p. ej. falta el último o viene 1XXXXXXXXX con X=9): 787-222-678
   */
  private formatNanpDashed9(digits: string): string {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}`;
  }

  /**
   * Construye variantes para client.lookup, priorizando el formato con guiones que usa Ubersmith.
   */
  private buildPhoneVariants(cleanPhone: string): string[] {
    const variants: string[] = [];
    const seen = new Set<string>();

    const push = (v: string) => {
      if (v && !seen.has(v)) {
        seen.add(v);
        variants.push(v);
      }
    };

    // --- NANP (+1): 11 dígitos 1 + 10, o 10 dígitos nacionales, o 1 + 9 dígitos ---
    let national10: string | null = null;
    let national9: string | null = null;

    if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
      national10 = cleanPhone.slice(1);
    } else if (cleanPhone.length === 10) {
      if (cleanPhone.startsWith('1')) {
        national9 = cleanPhone.slice(1);
      } else {
        national10 = cleanPhone;
      }
    } else if (cleanPhone.length === 9) {
      national9 = cleanPhone;
    }

    if (national10 && /^\d{10}$/.test(national10)) {
      push(this.formatNanpDashed10(national10));
      push(national10);
      push(`1${national10}`);
    }

    if (national9 && /^\d{9}$/.test(national9)) {
      push(this.formatNanpDashed9(national9));
      push(national9);
      push(`1${national9}`);
    }

    // Variantes legacy (otros países / formatos previos en BD)
    push(cleanPhone);
    if (cleanPhone.length > 8) push(cleanPhone.slice(1));
    if (cleanPhone.length > 9) push(cleanPhone.slice(2));
    if (cleanPhone.length > 10) push(cleanPhone.slice(3));

    return variants;
  }

  async getCustomerProfileLink(phoneNumber: string): Promise<string | null> {
    const apiUrl = this.configService.get<string>('ubersmith.apiUrl');
    const apiUser = this.configService.get<string>('ubersmith.apiUser');
    const apiPass = this.configService.get<string>('ubersmith.apiPass');

    if (!apiUrl || !apiUser || !apiPass) {
      this.logger.warn('Configuración Ubersmith incompleta (apiUrl, apiUser o apiPass).');
      return null;
    }

    try {
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      const variantsToTry = this.buildPhoneVariants(cleanPhone);

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
        `No se encontró cliente en Ubersmith para el teléfono: ${cleanPhone} (variantes probadas: ${variantsToTry.join(', ')})`,
      );
      return null;
    } catch (error: any) {
      this.logger.error(`Error consultando Ubersmith: ${error.message}`);
      return null;
    }
  }
}
