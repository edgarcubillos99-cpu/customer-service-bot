import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead } from '../common/entities/leads.entity';
import axios from 'axios';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    @InjectRepository(Lead)
    private leadsRepository: Repository<Lead>,
  ) {}

  async processLeadEvent(body: any) {
    try {
      if (!body.entry || !Array.isArray(body.entry)) {
        this.logger.warn('Payload de Meta sin entry válido');
        return;
      }
      for (const entry of body.entry) {
        if (!entry.changes || !Array.isArray(entry.changes)) continue;
        for (const change of entry.changes) {
          if (change.field === 'leadgen') {
            const leadgenId = change.value?.leadgen_id;
            if (leadgenId) {
              this.logger.log(`Nuevo lead recibido. ID: ${leadgenId}`);
              await this.fetchAndSaveLeadData(leadgenId);
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('Error procesando el payload de Meta', error);
    }
  }

  private async fetchAndSaveLeadData(leadgenId: string) {
    try {
      const accessToken = process.env.META_PAGE_ACCESS_TOKEN;
      
      // 1. Consultar la Graph API para obtener los datos reales
      const response = await axios.get(
        `https://graph.facebook.com/v19.0/${leadgenId}?access_token=${accessToken}`
      );

      const fieldData = response.data.field_data;
      
      // 2. Extraer campos (ajusta los nombres según tu formulario de Meta)
      const nombreField = fieldData.find((f: any) => f.name === 'full_name');
      const telefonoField = fieldData.find((f: any) => f.name === 'phone_number');
      const ciudadField = fieldData.find((f: any) => f.name === 'city');

      let nombre = nombreField ? nombreField.values[0] : 'Cliente Desconocido';
      let telefono = telefonoField ? telefonoField.values[0] : null;

      if (!telefono) {
        this.logger.warn(`El lead ${leadgenId} no tiene número de teléfono. Omitiendo.`);
        return;
      }

      // 3. Normalizar el teléfono (Limpiar espacios, guiones, símbolos raros)
      // Idealmente, aquí aseguras que tenga el código de país correcto (ej: 57 para Colombia)
      const telefonoNormalizado = telefono.replace(/\D/g, '');

      // 4. Evitar duplicados (Meta puede reenviar el webhook)
      const existente = await this.leadsRepository.findOne({ where: { leadgen_id: leadgenId } });
      if (existente) {
        this.logger.log(`Lead ya existente (leadgen_id: ${leadgenId}). Se actualiza.`);
        existente.nombre = nombre;
        existente.telefono = telefonoNormalizado;
        await this.leadsRepository.save(existente);
        return;
      }

      // 5. Guardar en Base de Datos
      const nuevoLead = this.leadsRepository.create({
        nombre: nombre,
        telefono: telefonoNormalizado,
        origen: 'meta_ads',
        estado: 'por contactar',
        leadgen_id: leadgenId
      });

      await this.leadsRepository.save(nuevoLead);
      this.logger.log(`Lead guardado en DB exitosamente: ${nombre}`);

    } catch (error) {
      this.logger.error(`Error obteniendo datos del lead ${leadgenId} desde Meta API`, error);
    }
  }
}