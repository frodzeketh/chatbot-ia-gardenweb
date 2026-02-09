# Subir Artículos a Pinecone

Script para subir artículos a la base de datos vectorial.

## Uso

1. Crea tu archivo de artículos con el formato:

```
Codigo_Referencia: 00000018
Denominacion_Grupo: HORTALIZAS
Denominacion_Familia: LECHUGA
Precio_Fisico: 0.08000
Denominacion_Web: Lechuga Escarola
Precio_Web: 0.10000
Articulo_subido_en_la_web: Si
Se_encuentra_disponible_en_la_web: Si
Plantas_por_bandeja: 245
Precio_de_venta_bandeja: 8.10000
Descripcion_Bandeja: Bandeja LECHUGA ESCAROLA alv260
Stock_Web: 50
Stock_Fisico: 120
Descripcion_de_cada_articulo: Descripción del producto...

Codigo_Referencia: 00000025
Denominacion_Grupo: HORTALIZAS
...
```

**Importante:** Separa cada artículo con una línea en blanco.

2. Ejecuta el script:

```bash
cd pinecone
node upload.js articulos.txt
```

## Campos

| Campo | Descripción |
|-------|-------------|
| `Codigo_Referencia` | ID único del producto |
| `Denominacion_Grupo` | Categoría principal (HORTALIZAS, AROMATICAS, ARBOLES...) |
| `Denominacion_Familia` | Subcategoría (LECHUGA, TOMATE, CIPRES...) |
| `Precio_Fisico` | Precio en tienda física |
| `Denominacion_Web` | Nombre para mostrar en web |
| `Precio_Web` | Precio en web |
| `Articulo_subido_en_la_web` | Si/No |
| `Se_encuentra_disponible_en_la_web` | Si/No |
| `Plantas_por_bandeja` | Cantidad por bandeja |
| `Precio_de_venta_bandeja` | Precio por bandeja completa |
| `Descripcion_Bandeja` | Descripción corta |
| `Stock_Web` | Stock disponible online |
| `Stock_Fisico` | Stock en tienda |
| `Descripcion_de_cada_articulo` | Descripción detallada |

## Ejemplo

```bash
node upload.js articulos_ejemplo.txt
```

Verás:
```
📂 Leyendo archivo: articulos_ejemplo.txt
📦 Bloques encontrados: 4
✅ Artículos parseados: 4
📋 Ejemplo de artículo parseado:
{
  "codigo_referencia": "00000018",
  "denominacion_grupo": "HORTALIZAS",
  ...
}
🔗 Conectando a Pinecone index: products
📤 Subidos: 4/4
✅ ¡Subida completada!
```
