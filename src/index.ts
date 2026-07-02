import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Client } from '@notionhq/client';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ quiet: true });

const notionToken = process.env.NOTION_TOKEN;
const databaseId = process.env.NOTION_DATABASE_ID;

if (!notionToken || !databaseId) {
  console.error("Error: NOTION_TOKEN and NOTION_DATABASE_ID environment variables must be defined in the .env file.");
  process.exit(1);
}

// Initialize Notion client
const notion = new Client({ auth: notionToken });

// Initialize MCP Server
const server = new Server(
  {
    name: 'notion-sprint-manager',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register list of tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_active_tasks',
        description: 'Get all active tasks from the Notion database (tasks that are NOT in a Done or completed state).',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'add_task_to_backlog',
        description: 'Add a new task to the backlog in the Notion database.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'The name/title of the task.',
            },
            status: {
              type: 'string',
              description: 'The status of the task (e.g. Backlog, Todo, In Progress, Done).',
            },
            priority: {
              type: 'string',
              description: 'The priority of the task (e.g. High, Medium, Low).',
            },
            due_date: {
              type: 'string',
              description: 'The due date in YYYY-MM-DD format.',
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'update_task_status',
        description: 'Update the status of an existing task in the Notion database.',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description: 'The ID of the task/page in Notion.',
            },
            status: {
              type: 'string',
              description: 'The new status name (e.g. Backlog, Todo, In Progress, Done, Not started).',
            },
          },
          required: ['task_id', 'status'],
        },
      },
    ],
  };
});

// Helper function to resolve dynamic property keys and types
async function resolveDatabaseProperties(dbId: string) {
  try {
    const db = await notion.databases.retrieve({ database_id: dbId }) as any;
    
    // In this SDK version, database properties are nested under dataSources.
    // We retrieve the first data source ID linked to this database.
    const dataSourceId = db.data_sources?.[0]?.id || dbId;
    
    const dataSource = await notion.dataSources.retrieve({ data_source_id: dataSourceId }) as any;
    const props = dataSource.properties || db.properties || {};

    // Find the title property (type === 'title')
    const nameKey = Object.keys(props).find(
      key => props[key].type === 'title'
    ) || 'Name';

    // Find Status property (type === 'status' first, or select named status/estado)
    const statusKey = Object.keys(props).find(
      key => props[key].type === 'status'
    ) || Object.keys(props).find(
      key => (key.toLowerCase() === 'status' || key.toLowerCase() === 'estado') && props[key].type === 'select'
    ) || 'Status';
    const statusType = props[statusKey]?.type || 'status';

    // Find Priority property (select/status named priority/prioridad, or select with priority options)
    const priorityKey = Object.keys(props).find(
      key => (key.toLowerCase() === 'priority' || key.toLowerCase() === 'prioridad') && (props[key].type === 'select' || props[key].type === 'status')
    ) || Object.keys(props).find(
      key => props[key].type === 'select' && 
        Array.isArray(props[key].select?.options) && 
        props[key].select.options.some((opt: any) => 
          ['high', 'medium', 'low', 'alta', 'media', 'baja'].includes(opt.name.toLowerCase())
        )
    ) || 'Priority';
    const priorityType = props[priorityKey]?.type || 'select';

    // Find Due Date property (date with terms in name or just any date property)
    const dueDateKey = Object.keys(props).find(
      key => props[key].type === 'date' && 
        ['due date', 'due_date', 'fecha', 'vencimiento', 'entrega', 'fecha de entrega', 'fecha de vencimiento', 'due'].some(term => key.toLowerCase().includes(term))
    ) || Object.keys(props).find(
      key => props[key].type === 'date'
    ) || 'Due Date';

    return { nameKey, statusKey, statusType, priorityKey, priorityType, dueDateKey, dataSourceId };
  } catch (error) {
    console.error('Error retrieving database schema from Notion:', error);
    // Return sensible defaults if database retrieval fails
    return {
      nameKey: 'Name',
      statusKey: 'Status',
      statusType: 'status' as const,
      priorityKey: 'Priority',
      priorityType: 'select' as const,
      dueDateKey: 'Due Date',
      dataSourceId: dbId,
    };
  }
}

// Handle tool executions
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const keys = await resolveDatabaseProperties(databaseId);

    if (name === 'get_active_tasks') {
      let filter: any;

      // Define standard filter based on detected Status property type
      if (keys.statusType === 'status') {
        filter = {
          property: keys.statusKey,
          status: {
            does_not_equal: 'Done',
          },
        };
      } else {
        filter = {
          property: keys.statusKey,
          select: {
            does_not_equal: 'Done',
          },
        };
      }

      // Query the associated data source with pagination
      const results: any[] = [];
      let hasMore = true;
      let startCursor: string | undefined = undefined;

      while (hasMore) {
        const response = await notion.dataSources.query({
          data_source_id: keys.dataSourceId,
          filter,
          result_type: 'page',
          start_cursor: startCursor,
        }) as any;

        results.push(...response.results);
        hasMore = response.has_more;
        startCursor = response.next_cursor || undefined;
      }

      const tasks = results.map((page: any) => {
        const props = page.properties;
        
        let taskName = 'Untitled';
        const titleProp = props[keys.nameKey];
        if (titleProp && titleProp.type === 'title' && Array.isArray(titleProp.title)) {
          taskName = titleProp.title.map((t: any) => t.plain_text).join('');
        }

        let status = 'None';
        const statusProp = props[keys.statusKey];
        if (statusProp) {
          if (statusProp.type === 'status' && statusProp.status) {
            status = statusProp.status.name;
          } else if (statusProp.type === 'select' && statusProp.select) {
            status = statusProp.select.name;
          }
        }

        let priority = 'None';
        const priorityProp = props[keys.priorityKey];
        if (priorityProp) {
          if (priorityProp.type === 'select' && priorityProp.select) {
            priority = priorityProp.select.name;
          } else if (priorityProp.type === 'status' && priorityProp.status) {
            priority = priorityProp.status.name;
          }
        }

        let dueDate = 'None';
        const dateProp = props[keys.dueDateKey];
        if (dateProp && dateProp.type === 'date' && dateProp.date) {
          dueDate = dateProp.date.start;
        }

        return {
          id: page.id,
          name: taskName,
          status,
          priority,
          dueDate,
          url: page.url,
        };
      });

      if (tasks.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No active tasks found in the database.',
            },
          ],
        };
      }

      const formattedTasks = tasks
        .map(
          (t: any, i: number) =>
            `${i + 1}. **${t.name}**\n   - ID: ${t.id}\n   - Status: ${t.status}\n   - Priority: ${t.priority}\n   - Due Date: ${t.dueDate}\n   - URL: ${t.url}`
        )
        .join('\n\n');

      return {
        content: [
          {
            type: 'text',
            text: `Active Tasks:\n\n${formattedTasks}`,
          },
        ],
      };
    }

    if (name === 'add_task_to_backlog') {
      const taskArgs = args as { name: string; status?: string; priority?: string; due_date?: string };
      if (!taskArgs || typeof taskArgs.name !== 'string') {
        throw new Error('Missing or invalid required argument: name');
      }

      const properties: Record<string, any> = {
        [keys.nameKey]: {
          title: [
            {
              text: {
                content: taskArgs.name,
              },
            },
          ],
        },
      };

      // Add status if provided
      if (taskArgs.status) {
        if (keys.statusType === 'status') {
          properties[keys.statusKey] = {
            status: {
              name: taskArgs.status,
            },
          };
        } else {
          properties[keys.statusKey] = {
            select: {
              name: taskArgs.status,
            },
          };
        }
      }

      // Add priority if provided
      if (taskArgs.priority) {
        if (keys.priorityType === 'status') {
          properties[keys.priorityKey] = {
            status: {
              name: taskArgs.priority,
            },
          };
        } else {
          properties[keys.priorityKey] = {
            select: {
              name: taskArgs.priority,
            },
          };
        }
      }

      // Add due date if provided
      if (taskArgs.due_date) {
        properties[keys.dueDateKey] = {
          date: {
            start: taskArgs.due_date,
          },
        };
      }

      const newPage = await notion.pages.create({
        parent: {
          database_id: databaseId,
        },
        properties,
      } as any);

      return {
        content: [
          {
            type: 'text',
            text: `Successfully created task "${taskArgs.name}" with ID: ${newPage.id}\nURL: ${(newPage as any).url || 'N/A'}`,
          },
        ],
      };
    }

    if (name === 'update_task_status') {
      const taskArgs = args as { task_id: string; status: string };
      if (!taskArgs || typeof taskArgs.task_id !== 'string' || typeof taskArgs.status !== 'string') {
        throw new Error('Missing or invalid required arguments: task_id and status');
      }

      const properties: Record<string, any> = {};

      if (keys.statusType === 'status') {
        properties[keys.statusKey] = {
          status: {
            name: taskArgs.status,
          },
        };
      } else {
        properties[keys.statusKey] = {
          select: {
            name: taskArgs.status,
          },
        };
      }

      const updatedPage = await notion.pages.update({
        page_id: taskArgs.task_id,
        properties,
      } as any);

      return {
        content: [
          {
            type: 'text',
            text: `Successfully updated task status to "${taskArgs.status}" for task ID: ${updatedPage.id}\nURL: ${(updatedPage as any).url || 'N/A'}`,
          },
        ],
      };
    }

    throw new Error(`Tool not found: ${name}`);
  } catch (error: any) {
    console.error('Error handling tool call:', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server using stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Notion Sprint Manager MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in server:', error);
  process.exit(1);
});
