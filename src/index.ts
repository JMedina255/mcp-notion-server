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

    // Find the title property
    const nameKey = Object.keys(props).find(
      key => props[key].type === 'title'
    ) || 'Name';

    // Find Status property (Status or Select)
    const statusKey = Object.keys(props).find(
      key => key.toLowerCase() === 'status' && (props[key].type === 'status' || props[key].type === 'select')
    ) || 'Status';
    const statusType = props[statusKey]?.type || 'status';

    // Find Priority property (Select or Status)
    const priorityKey = Object.keys(props).find(
      key => key.toLowerCase() === 'priority' && (props[key].type === 'select' || props[key].type === 'status')
    ) || 'Priority';
    const priorityType = props[priorityKey]?.type || 'select';

    // Find Due Date property (Date)
    const dueDateKey = Object.keys(props).find(
      key => (key.toLowerCase() === 'due date' || key.toLowerCase() === 'due_date') && props[key].type === 'date'
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

      // Query the associated data source
      const response = await notion.dataSources.query({
        data_source_id: keys.dataSourceId,
        filter,
        result_type: 'page',
      }) as any;

      const tasks = response.results.map((page: any) => {
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
