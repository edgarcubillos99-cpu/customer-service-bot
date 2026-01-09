import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { AxiosResponse } from 'axios';
import { WhatsappResponse } from '../common/whatsapp-response.interface';
import { Observable } from 'rxjs';

@Injectable()
export class WhatsappService {
  private readonly token: string;
  private readonly phoneId: string;

  constructor(
    private readonly http: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.token = this.configService.get<string>('whatsappToken') ?? '';
    this.phoneId = this.configService.get<string>('whatsappPhoneId') ?? '';

    console.log(
      'WhatsApp Service Inicializado con Token:',
      this.token ? 'PRESENTE' : 'FALTANTE',
    );
  }

  async sendMessage(to: string, message: string): Promise<WhatsappResponse> {
    if (!this.token || !this.phoneId) {
      throw new InternalServerErrorException(
        'WhatsApp API credentials are missing.',
      );
    }

    const url = `https://graph.facebook.com/v18.0/${this.phoneId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      to,
      text: { body: message },
    };

    const headers = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };

    try {
      // Tipado seguro del Observable
      const observable: Observable<AxiosResponse<WhatsappResponse>> =
        this.http.post(url, payload, { headers });

      // Convertir a promesa con tipo seguro
      const response: AxiosResponse<WhatsappResponse> =
        await lastValueFrom(observable);

      // Retorno seguro (WhatsappResponse)
      return response.data satisfies WhatsappResponse;
    } catch (err: unknown) {
      // Manejo de error seguro: validación por tipo
      if (
        typeof err === 'object' &&
        err !== null &&
        'response' in err &&
        typeof (err as { response?: unknown })?.response === 'object'
      ) {
        const axiosError = err as {
          response?: { data?: unknown };
          message?: string;
        };

        console.error(
          'Error enviando WhatsApp:',
          axiosError.response?.data ?? axiosError.message ?? err,
        );
      } else {
        console.error('Error desconocido enviando WhatsApp:', err);
      }

      throw new InternalServerErrorException('No se pudo enviar el mensaje.');
    }
  }
}
