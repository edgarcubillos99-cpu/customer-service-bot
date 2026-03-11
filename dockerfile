# --- Etapa 1: Construcción (Builder) ---
    FROM node:20-alpine

    WORKDIR /app
    
    # Copiamos los archivos de dependencias
    COPY package*.json ./
    
    # Instalamos TODAS las dependencias (incluyendo devDependencies para poder compilar)
    RUN npm install
    
    # Copiamos el resto del código fuente
    COPY . .
    
    # Compilamos la aplicación NestJS
    RUN npm run build
    
    # Exponemos el puerto que usa la aplicación
    EXPOSE 3000
    
    # Comando para iniciar la aplicación
    CMD ["npm", "run", "start:prod"]