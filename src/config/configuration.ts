export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  whatsappToken: process.env.WHATSAPP_TOKEN,
  whatsappPhoneId: process.env.WHATSAPP_PHONE_ID,
  teamsBotName: process.env.TEAMS_BOT_NAME ?? 'botito',
});
