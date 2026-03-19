import { ActivityHandler, TurnContext } from 'botbuilder';
import { Injectable, Logger } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { BlockedNumber } from '../common/entities/blocked-number.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { CardFactory } from 'botbuilder';

@Injectable()
export class TeamsBotHandler extends ActivityHandler {
  private readonly logger = new Logger(TeamsBotHandler.name);

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
        const templates = await this.teamsService.getWhatsappTemplates();

        const templateButtons = templates.map((t) => ({
          type: 'Action.Submit',
          title: `📋 ${t.name} (${t.language})`,
          data: {
            action: 'select_template',
            templateName: t.name,
            templateLanguage: t.language,
            templateBodyText: t.bodyText,
            templateVariables: t.variables,
          },
        }));

        if (templateButtons.length === 0) {
          templateButtons.push({
            type: 'Action.Submit',
            title: '📋 hello_world (en_US)  — fallback',
            data: {
              action: 'select_template',
              templateName: 'hello_world',
              templateLanguage: 'en_US',
              templateBodyText: '',
              templateVariables: [],
            },
          });
        }

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
              color: 'Accent',
            },
            {
              type: 'TextBlock',
              text: `Se encontraron **${templates.length}** template(s) aprobado(s). Completa los datos y elige el template a enviar:`,
              wrap: true,
            },
            {
              type: 'Input.Text',
              id: 'leadPhone',
              placeholder: 'Ej: 573001234567 (Sin el +)',
              label: 'Número de WhatsApp:',
              isRequired: true,
            },
            {
              type: 'Input.Text',
              id: 'leadName',
              placeholder: 'Ej: Juan Pérez',
              label: 'Nombre del Cliente:',
            },
          ],
          actions: templateButtons,
        });

        await context.sendActivity({ attachments: [toolsCard] });
        await next();
        return;
      }

      // ==========================================
      // 5. MANEJAR SELECCIÓN DE TEMPLATE
      // ==========================================
      if (value && value.action === 'select_template') {
        const { leadPhone, leadName, templateName, templateLanguage, templateBodyText, templateVariables } = value;
        const variables: string[] = Array.isArray(templateVariables) ? templateVariables : [];

        if (!leadPhone) {
          await context.sendActivity('⚠️ Debes ingresar un número de teléfono antes de seleccionar el template.');
          await next();
          return;
        }

        // Si el template no tiene variables, enviamos directamente
        if (variables.length === 0) {
          await context.sendActivity(`⏳ Enviando template **${templateName}** a +${leadPhone}...`);
          await this.teamsService.iniciarContactoProactivo(leadPhone, leadName || 'Cliente', templateName, templateLanguage, [], []);
          await next();
          return;
        }

        // Si tiene variables, mostramos un formulario para rellenarlas
        const preview = (templateBodyText as string)
          .replace(/\{\{([^}]+)\}\}/g, (_: string, n: string) => `[ ${n} ]`);

        const variableInputs = variables.map((varTag: string) => {
          // Obtener el contenido de la variable: "nombre", "ciudad", "1", etc.
          const varKey = varTag.replace(/^\{\{|\}\}$/g, '').trim();
          const inputId = `var_${varKey}`;
          return {
            type: 'Input.Text',
            id: inputId,
            label: `${varTag}:`,
            placeholder: `Valor para ${varTag}`,
            value: '',
          };
        });

        const varCard = CardFactory.adaptiveCard({
          type: 'AdaptiveCard',
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: `📋 Variables del template: **${templateName}**`,
              weight: 'Bolder',
              size: 'Medium',
              color: 'Accent',
            },
            {
              type: 'TextBlock',
              text: `Vista previa: _${preview}_`,
              wrap: true,
              isSubtle: true,
            },
            ...variableInputs,
          ],
          actions: [
            {
              type: 'Action.Submit',
              title: '📲 Enviar Template',
              data: {
                action: 'contact_lead',
                leadPhone,
                leadName: leadName || 'Cliente',
                templateName,
                templateLanguage,
                templateVariables: variables,
              },
            },
          ],
        });

        await context.sendActivity({ attachments: [varCard] });
        await next();
        return;
      }

      // ==========================================
      // 6. MANEJAR ENVÍO FINAL DEL TEMPLATE
      // ==========================================
      if (value && value.action === 'contact_lead') {
        const { leadPhone, leadName, templateName, templateLanguage, templateVariables } = value;

        this.logger.debug(`📥 contact_lead recibido: ${JSON.stringify(value)}`);

        if (!leadPhone) {
          await context.sendActivity('⚠️ Error: Debes ingresar un número de teléfono válido.');
          await next();
          return;
        }

        // Teams puede serializar el array como string al pasar por Action.Submit data.
        // Se normalizan ambos casos.
        const variables: string[] = this.parseTemplateVariables(templateVariables);

        // Recolectar los valores de las variables desde los inputs del formulario.
        // El ID de cada input es var_<contenido>, ej: var_nombre, var_ciudad, var_1
        const bodyVariables: string[] = variables.map((varTag: string) => {
          const varKey = varTag.replace(/^\{\{|\}\}$/g, '').trim();
          const val = (value[`var_${varKey}`] as string) ?? '';
          return val;
        });

        this.logger.log(`📤 Template: ${templateName} | Variables: ${JSON.stringify(variables)} | Valores: ${JSON.stringify(bodyVariables)}`);

        await context.sendActivity(`⏳ Enviando template **${templateName}** a +${leadPhone}...`);
        await this.teamsService.iniciarContactoProactivo(
          leadPhone,
          leadName || 'Cliente',
          templateName,
          templateLanguage,
          bodyVariables,
          variables, // tags para detectar parameter_name en Meta
        );
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

  /**
   * Normaliza templateVariables que puede llegar como array real o como
   * string serializado por Teams (ej: '["{{nombre}}","{{ciudad}}"]' o
   * '{{nombre}},{{ciudad}}').
   */
  private parseTemplateVariables(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw as string[];

    if (typeof raw === 'string' && raw.trim().length > 0) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as string[];
      } catch {
        // Puede venir como string separado por comas: "{{nombre}},{{ciudad}}"
        return raw.split(',').map((v) => v.trim()).filter(Boolean);
      }
    }

    return [];
  }
}
