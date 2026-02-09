export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  whatsappToken: process.env.WHATSAPP_TOKEN,
  whatsappPhoneId: process.env.WHATSAPP_PHONE_ID,
  teamsBotName: process.env.TEAMS_BOT_NAME ?? 'botito',
  teamsTenantId: process.env.TEAMS_TENANT_ID,
  teamsClientId: process.env.TEAMS_CLIENT_ID,
  teamsClientSecret: process.env.TEAMS_CLIENT_SECRET,
  teamsTeamId: process.env.TEAMS_TEAM_ID,
  teamsChannelId: process.env.TEAMS_CHANNEL_ID,
  // Webhook URL de Teams (Incoming Webhook) - para ENVIAR mensajes
  // Obtén este URL desde Teams: Canal > Conectores > Incoming Webhook
  teamsWebhookUrl: process.env.TEAMS_WEBHOOK_URL,
  // URL pública de tu aplicación (necesaria para recibir eventos de Graph API)
  // Ejemplo: https://tu-dominio.com o https://tu-ngrok-url.ngrok.io
  publicUrl: process.env.PUBLIC_URL || process.env.TEAMS_PUBLIC_URL,
});
