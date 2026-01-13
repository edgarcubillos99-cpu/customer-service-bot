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
});
