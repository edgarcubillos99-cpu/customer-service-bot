// aqui se definen las interfaces de respuesta de whatsappque se van a usar en la aplicación
export interface WhatsappResponse {
  messaging_product: string;
  contacts?: Array<{
    input: string;
    wa_id: string;
  }>;
  messages?: Array<{
    id: string;
  }>;
  error?: any;
}
