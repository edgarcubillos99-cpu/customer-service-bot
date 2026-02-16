export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  whatsappToken: process.env.WHATSAPP_TOKEN,
  whatsappPhoneId: process.env.WHATSAPP_PHONE_ID,
  whatsappverifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
  MICROSOFT_APP_ID: process.env.MICROSOFT_APP_ID,
  MICROSOFT_APP_PASSWORD: process.env.MICROSOFT_APP_PASSWORD,
  MICROSOFT_APP_TENANT_ID: process.env.MICROSOFT_APP_TENANT_ID,
  teamsChannelId: process.env.TEAMS_CHANNEL_ID,
  teamsTeamId: process.env.TEAMS_TEAM_ID,
  teamsBotName: process.env.TEAMS_BOT_NAME ?? 'botito',
  publicUrl: process.env.PUBLIC_URL,
});