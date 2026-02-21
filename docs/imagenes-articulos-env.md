# Ver las imágenes de artículos en el chatbot

En **este proyecto (chatbot)** no pongas las claves de PrestaShop. Solo necesitas la URL base del servidor donde corre el **dashboard** (el que tiene la API de artículos).

## En el `.env` del chatbot

Añade o revisa:

```env
ARTICULOS_API_BASE=http://localhost:5001
```

- **Sin barra final.** Sin `/api` al final.
- Si el dashboard está en otro servidor: `https://tu-dashboard.com`
- El **servidor del dashboard debe estar levantado** (ej. `npm run server` en el proyecto del dashboard). Si no está en marcha, las imágenes no se cargarán.

## Cómo se construye la URL de cada imagen

El chatbot pide al dashboard:

1. `GET {ARTICULOS_API_BASE}/api/articulos/products` → lista de productos
2. `GET {ARTICULOS_API_BASE}/api/articulos/images` → relación producto → imagen

Con eso monta la URL de la imagen:

```
{ARTICULOS_API_BASE}/api/articulos/image/{productId}/{imageId}
```

Esa URL es la que usa el `<img src="...">` en la tarjeta del producto.

## Si no se ven las imágenes

1. **Servidor del dashboard en marcha** en el puerto que pongas en `ARTICULOS_API_BASE` (ej. 5001).
2. **En el `.env` del chatbot**, `ARTICULOS_API_BASE` debe ser exactamente esa URL (mismo host y puerto). Ejemplo: si el dashboard corre en `http://localhost:5001`, pon `ARTICULOS_API_BASE=http://localhost:5001`.
3. Reinicia el servidor del chatbot después de cambiar el `.env`.
4. En la consola del servidor del chatbot, al cargar productos deberías ver algo como: `Artículos API: X productos en cache, Y con imagen`. Si Y es 0, el dashboard no está devolviendo imágenes o la ruta `/api/articulos/images` no está disponible.

## Resumen

| Dónde        | Variable               | Qué poner                                      |
|-------------|------------------------|------------------------------------------------|
| **Dashboard** | ARTICULOS_API_URL, ARTICULOS_API_KEY | Claves de PrestaShop (solo en el proyecto del dashboard) |
| **Chatbot (este proyecto)** | ARTICULOS_API_BASE      | URL base del dashboard, ej. `http://localhost:5001` |
