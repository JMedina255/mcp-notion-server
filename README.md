# Notion Sprint Manager - MCP Server 🚀

Un servidor basado en el **Model Context Protocol (MCP)** que permite a cualquier cliente de IA (como Claude Desktop, Cursor o VSCode) gestionar un backlog de desarrollo de sprints directamente en **Notion**.

El servidor se comunica de manera eficiente mediante `stdio` y se adapta dinámicamente a tu base de datos de Notion sin importar si usas propiedades de tipo "Status" o "Select" para tus campos de control.

---

## ✨ Características

- 📋 `get_active_tasks`: Recupera automáticamente todas las tareas pendientes de tu base de datos (excluyendo aquellas en estado `'Done'`).
- ➕ `add_task_to_backlog`: Crea nuevas tareas en la base de datos mapeando de forma segura propiedades de Título (`Name`), Estado (`Status`), Prioridad (`Priority`) y fecha de entrega (`Due Date`).
- ⚙️ **Mapeo Dinámico**: Inspecciona la base de datos en tiempo de ejecución para resolver las propiedades y evitar errores de validación de esquemas de la API de Notion.
- 🔒 **Logs Seguros**: Toda la salida de diagnóstico se redirige a `console.error` para mantener el canal `stdout` totalmente limpio para el protocolo JSON-RPC de MCP.

---

## 🛠️ Requisitos Previos

- **Node.js** (v18 o superior instalado).
- **TypeScript** (instalado globalmente o mediante dependencias del proyecto).
- Un token de integración interna de Notion (consíguelo en [Notion Integrations](https://www.notion.so/my-integrations)).
- Una base de datos de Notion compartida con tu integración.

---

## 🚀 Configuración Local

### 1. Clonar el proyecto y acceder a la carpeta
```bash
git clone https://github.com/JMedina255/mcp-notion-server.git
cd mcp-notion-server
```

### 2. Instalar dependencias
```bash
npm install
```

### 3. Configurar variables de entorno
Crea un archivo `.env` en la raíz del proyecto y define tus credenciales:
```env
NOTION_TOKEN=tu_token_de_integracion_aqui
NOTION_DATABASE_ID=id_de_tu_base_de_datos_aqui
```

### 4. Compilar el proyecto
Para compilar el código TypeScript a JavaScript de forma limpia:
```bash
npm run build
```
Esto generará el archivo ejecutable optimizado en `dist/index.js`.

---

## 🔌 Integración con Claude Desktop

Para habilitar este servidor en Claude Desktop, debes agregar la configuración en el archivo `claude_desktop_config.json`. Dependiendo de cómo hayas instalado Claude, el archivo estará en una ruta u otra:

### Ruta del archivo de configuración de Claude:
* **Versión Estándar (Instalación clásica):**
  `%APPDATA%\Claude\claude_desktop_config.json`
* **Versión Empaquetada (Microsoft Store / MSIX):**
  `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json`

### Contenido a agregar:
Inserta la siguiente estructura dentro del objeto `"mcpServers"` (asegúrate de ajustar las rutas absolutas según tu máquina y usar barras inclinadas `/` para evitar errores de escape de JSON en Windows):

```json
{
  "mcpServers": {
    "notion-sprint-manager": {
      "command": "node",
      "args": [
        "/ruta/absoluta/a/mcp-notion-server/dist/index.js"
      ],
      "env": {
        "NOTION_TOKEN": "ntn_tu_token_aqui",
        "NOTION_DATABASE_ID": "id_de_tu_base_de_datos_aqui"
      }
    }
  }
}
```

> 💡 **Nota de Windows**: Especificar la ruta absoluta a `node.exe` (ej. `C:/Program Files/nodejs/node.exe`) previene problemas de resolución de PATH cuando Claude se ejecuta en su entorno de Sandbox.

---

## 🎯 Instrucciones de Uso en Claude

Una vez configurado y tras **reiniciar completamente Claude Desktop** (asegúrate de cerrarlo desde el System Tray), ya puedes interactuar de forma conversacional con tu Notion.

### Ejemplos de prompts en el chat:
* *¿Cuáles son mis tareas activas actuales en Notion?*
* *Agrega una nueva tarea al backlog llamada 'Escribir artículo sobre servidores MCP' con prioridad 'High'*
* *Crea una tarea 'Revisar documentación de API' y asígnale fecha de entrega 2026-07-15*

---

## 🛡️ Estructura del Código

- `src/index.ts`: Punto de entrada del servidor. Contiene la lógica del protocolo MCP, la consulta dinámica al esquema de Notion a través de origenes de datos (`notion.dataSources`) y la creación/edición de registros.
- `tsconfig.json`: Configurado con soporte moderno para ESM (`NodeNext`).
- `package.json`: Scripts y dependencias necesarias.