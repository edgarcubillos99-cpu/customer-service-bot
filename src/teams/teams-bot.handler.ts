import { ActivityHandler, TurnContext } from 'botbuilder';
import { Injectable } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { BlockedNumber } from '../common/entities/blocked-number.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { CardFactory } from 'botbuilder';

@Injectable()
export class TeamsBotHandler extends ActivityHandler {
  constructor(private readonly teamsService: TeamsService, @InjectRepository(BlockedNumber)private readonly blockedRepo: Repository<BlockedNumber>) {
    super();

    // Escuchar mensajes (cuando alguien escribe en Teams)
    this.onMessage(async (context, next) => {
      const value = context.activity.value;
      // Normalizar texto: quitar menciones <at>...</at> y espacios extra (para que "@bot !herramientas" y "!herramientas" funcionen)
      const rawText = context.activity.text?.trim() || '';
      const text = rawText.replace(/<at[^>]*>.*?<\/at>/gi, '').replace(/\s+/g, ' ').trim();
    
      // ==========================================
      // 1. MANEJAR CLIC EN "BLOQUEAR"
      // ==========================================
      if (value && value.action === 'block_user') {
        const phoneToBlock = value.phoneNumber;
    
        try {
          await this.blockedRepo.save({ phoneNumber: phoneToBlock });
          
          // En lugar de texto simple, enviamos una tarjeta con botón de "Deshacer"
          const confirmCard = CardFactory.adaptiveCard({
            type: 'AdaptiveCard',
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            version: '1.4',
            body: [
              {
                type: 'TextBlock',
                text: `☑️ **El número +${phoneToBlock} ha sido bloqueado.**`,
                color: 'Accent',
                weight: 'Bolder'
              }
            ],
            actions: [
              {
                type: 'Action.Submit',
                title: '🔓 Deshacer (Desbloquear)',
                data: {
                  action: 'unblock_user',
                  phoneNumber: phoneToBlock // Pasamos el número oculto
                }
              }
            ]
          });
    
          await context.sendActivity({ attachments: [confirmCard] });
        } catch (error) {
          await context.sendActivity(`⚠️ El número +${phoneToBlock} ya estaba bloqueado.`);
        }
        
        await next();
        return; // Detenemos la ejecución
      }
    
      // ==========================================
      // 2. MANEJAR CLIC EN "DESBLOQUEAR" (Botón)
      // ==========================================
      if (value && value.action === 'unblock_user') {
        const phoneToUnblock = value.phoneNumber;
        
        // El método .delete() de TypeORM borra el registro basado en la condición
        await this.blockedRepo.delete({ phoneNumber: phoneToUnblock });
        
        await context.sendActivity(`🔓 **El número +${phoneToUnblock} ha sido desbloqueado exitosamente.** El cliente ya puede enviar mensajes de nuevo.`);
        await next();
        return;
      }
    
      // ==========================================
      // 3. MANEJAR COMANDO MANUAL DE TEXTO
      // ==========================================
      // Si un operador escribe "!desbloquear 573103296471" en el chat:
      if (text.toLowerCase().startsWith('!desbloquear ')) {
        // Extraemos el número, quitando el comando y posibles espacios/signos +
        const phoneToUnblock = text.substring(13).replace('+', '').trim(); 
        
        if (phoneToUnblock) {
          await this.blockedRepo.delete({ phoneNumber: phoneToUnblock });
          await context.sendActivity(`🔓 **Lista Negra Actualizada:** El número +${phoneToUnblock} fue desbloqueado.`);
        } else {
          await context.sendActivity(`⚠️ **Formato incorrecto.** Usa: !desbloquear NUMERO`);
        }
        
        await next();
        return;
      }

      // ==========================================
      // 4. MANEJAR COMANDO "!HERRAMIENTAS"
      // ==========================================
      if (text.toLowerCase() === '!herramientas') {
        const toolsCard = CardFactory.adaptiveCard({
          type: 'AdaptiveCard',
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: '🛠️ Panel de Herramientas',
              weight: 'Bolder',
              size: 'Large',
              color: 'Accent'
            },
            {
              type: 'TextBlock',
              text: 'Ingresa los datos para contactar a un cliente potencial:',
              wrap: true
            },
            {
              type: 'Input.Text',
              id: 'leadPhone',
              placeholder: 'Ej: 573001234567 (Sin el +)',
              label: 'Número de WhatsApp:'
            },
            {
              type: 'Input.Text',
              id: 'leadName',
              placeholder: 'Ej: Juan Pérez',
              label: 'Nombre del Cliente:'
            }
          ],
          actions: [
            {
              type: 'Action.Submit',
              title: '📲 Contactar Cliente Potencial',
              data: {
                action: 'contact_lead'
              }
            }
          ]
        });

        await context.sendActivity({ attachments: [toolsCard] });
        await next();
        return;
      }

      // ==========================================
      // 5. MANEJAR CLIC EN "CONTACTAR CLIENTE"
      // ==========================================
      if (value && value.action === 'contact_lead') {
        const { leadPhone, leadName } = value;

        if (!leadPhone) {
          await context.sendActivity('⚠️ Error: Debes ingresar un número de teléfono válido.');
          await next();
          return;
        }

        await context.sendActivity(`⏳ Iniciando protocolo de contacto para +${leadPhone}...`);
        
        // AQUÍ LLAMAREMOS AL SERVICIO ORQUESTADOR
        await this.teamsService.iniciarContactoProactivo(leadPhone, leadName || 'Cliente');
        
        await context.sendActivity(`✅ Hilo creado y template enviado a +${leadPhone}.`);
        await next();
        return;
      }

      // Pasamos el contexto completo al servicio
      await this.teamsService.handleIncomingBotMessage(context);
      await next();
    });

    this.onMembersAdded(async (context, next) => {
        // Aquí se podría saludar si  se quisiera, por ahora lo ignoramos
        await next();
    });
  }
}
