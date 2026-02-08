# Chatbot Widget con OpenAI

Widget de chatbot embebible que se integra en cualquier web PHP con **una sola línea de código**.

## Estructura del Proyecto

```
chatbot-ia-garden-web/
├── server.js           # Backend Node.js (API + servidor)
├── package.json        # Dependencias
├── .env.example        # Variables de entorno
├── railway.json        # Config para Railway
├── public/
│   ├── index.html      # Página demo para probar
│   ├── widget.html     # HTML del chatbot
│   ├── widget.css      # Estilos del chatbot
│   ├── widget.js       # Lógica del chatbot
│   └── embed.js        # Script de integración
```

---

## 1. Probar en Local

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar API Key de OpenAI
cp .env.example .env
# Edita .env y pon tu OPENAI_API_KEY

# 3. Iniciar servidor
npm start

# 4. Abrir en navegador
# http://localhost:3000
```

---

## 2. Desplegar en Railway

### Paso 1: Subir a GitHub

```bash
git init
git add .
git commit -m "Chatbot widget"
git remote add origin https://github.com/TU-USUARIO/chatbot-widget.git
git push -u origin main
```

### Paso 2: Crear proyecto en Railway

1. Ve a [railway.app](https://railway.app)
2. Click en **New Project** → **Deploy from GitHub**
3. Selecciona tu repositorio
4. Railway detectará automáticamente que es Node.js

### Paso 3: Configurar variables de entorno

En Railway, ve a tu proyecto → **Variables** y añade:

| Variable | Valor |
|----------|-------|
| `OPENAI_API_KEY` | `sk-tu-api-key-de-openai` |
| `BOT_NAME` | `Asistente Garden` (opcional) |
| `BOT_WELCOME_MESSAGE` | `¡Hola! ¿En qué puedo ayudarte?` (opcional) |
| `SYSTEM_PROMPT` | `Eres un asistente amable...` (opcional) |

### Paso 4: Obtener URL

Railway te dará una URL tipo: `https://chatbot-widget-production.up.railway.app`

---

## 3. Integrar en tu Web PHP

### Opción Simple (una línea)

Añade esto antes de `</body>` en tu archivo PHP:

```html
<script src="https://TU-APP.railway.app/embed.js"></script>
```

### Opción con Personalización

```html
<script 
  src="https://TU-APP.railway.app/embed.js"
  data-position="right"
  data-primary-color="#4F46E5"
  data-theme="light"
></script>
```

### Opciones Disponibles

| Atributo | Valores | Default |
|----------|---------|---------|
| `data-position` | `right`, `left` | `right` |
| `data-primary-color` | Color HEX | `#4F46E5` |
| `data-theme` | `light`, `dark` | `light` |

---

## 4. Ejemplo Completo en PHP

```php
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Mi Sitio Web</title>
</head>
<body>
    <h1>Bienvenido a mi sitio</h1>
    <p>Contenido de la página...</p>
    
    <!-- Solo esta línea para el chatbot -->
    <script src="https://TU-APP.railway.app/embed.js"></script>
</body>
</html>
```

---

## 5. Control Programático (Opcional)

Puedes controlar el widget desde JavaScript:

```javascript
// Abrir el chat
ChatbotWidget.open();

// Cerrar el chat
ChatbotWidget.close();

// Alternar
ChatbotWidget.toggle();

// Eliminar completamente
ChatbotWidget.destroy();
```

---

## 6. Personalizar el Bot

Configura estas variables de entorno en Railway:

```env
# Nombre que aparece en el header
BOT_NAME=Garden Assistant

# Mensaje de bienvenida
BOT_WELCOME_MESSAGE=¡Hola! Soy el asistente de Garden. ¿En qué puedo ayudarte?

# Prompt del sistema (comportamiento del bot)
SYSTEM_PROMPT=Eres un asistente de una tienda de jardinería. Ayudas a los clientes con consultas sobre plantas, herramientas y servicios. Responde siempre en español de forma amable y profesional.
```

---

## Soporte

Si tienes problemas, verifica:
1. La API Key de OpenAI es válida
2. El servidor de Railway está corriendo (revisa los logs)
3. La URL del script está correcta
