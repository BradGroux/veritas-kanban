import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Veritas Kanban API',
      version: '1.0.0',
      description:
        'Task management API for Veritas Kanban board. Supports task CRUD, time tracking, comments, subtasks, sprints, projects, and more.',
      contact: {
        name: 'Brad Groux',
      },
      license: {
        name: 'MIT',
      },
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Local development server',
      },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'Admin API key passed in the X-API-Key header',
        },
        CookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'veritas_session',
          description: 'JWT session cookie set after login',
        },
      },
      schemas: {
        Task: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'task_20260128_abc123' },
            title: { type: 'string', example: 'Implement dark mode' },
            description: { type: 'string', example: 'Add dark mode toggle to the UI' },
            type: { type: 'string', example: 'feature' },
            status: {
              type: 'string',
              enum: ['todo', 'in-progress', 'blocked', 'done'],
              example: 'todo',
            },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high'],
              example: 'medium',
            },
            project: { type: 'string', example: 'veritas-kanban' },
            sprint: { type: 'string', example: 'Sprint 3' },
            created: { type: 'string', format: 'date-time' },
            updated: { type: 'string', format: 'date-time' },
            revision: { type: 'number', example: 3 },
            createdBy: { type: 'string', example: 'user:local-user' },
            updatedBy: { type: 'string', example: 'agent:planner' },
            subtasks: {
              type: 'array',
              items: { $ref: '#/components/schemas/Subtask' },
            },
            comments: {
              type: 'array',
              items: { $ref: '#/components/schemas/Comment' },
            },
            blockedBy: {
              type: 'array',
              items: { type: 'string' },
            },
            blockedReason: {
              $ref: '#/components/schemas/BlockedReason',
            },
            timeTracking: {
              $ref: '#/components/schemas/TimeTracking',
            },
            reviewComments: {
              type: 'array',
              items: { $ref: '#/components/schemas/ReviewComment' },
            },
            reviewScores: {
              type: 'array',
              items: { type: 'number' },
              minItems: 4,
              maxItems: 4,
            },
            position: { type: 'number' },
          },
          required: ['id', 'title', 'status', 'priority', 'type', 'created'],
        },
        TaskSummary: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            status: {
              type: 'string',
              enum: ['todo', 'in-progress', 'blocked', 'done'],
            },
            priority: { type: 'string', enum: ['low', 'medium', 'high'] },
            type: { type: 'string' },
            project: { type: 'string' },
            sprint: { type: 'string' },
            created: { type: 'string', format: 'date-time' },
            updated: { type: 'string', format: 'date-time' },
            position: { type: 'number' },
            attachmentCount: { type: 'number' },
          },
        },
        CreateTaskInput: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200, example: 'New task title' },
            description: { type: 'string', example: 'Task description' },
            type: { type: 'string', default: 'code', example: 'feature' },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high'],
              default: 'medium',
            },
            project: { type: 'string', example: 'veritas-kanban' },
            sprint: { type: 'string', example: 'Sprint 3' },
            reviewScores: {
              type: 'array',
              items: { type: 'number' },
              minItems: 4,
              maxItems: 4,
            },
            reviewComments: {
              type: 'array',
              items: { $ref: '#/components/schemas/ReviewComment' },
            },
          },
          required: ['title'],
        },
        UpdateTaskInput: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: 'string' },
            type: { type: 'string' },
            status: {
              type: 'string',
              enum: ['todo', 'in-progress', 'blocked', 'done'],
            },
            priority: { type: 'string', enum: ['low', 'medium', 'high'] },
            project: { type: 'string' },
            sprint: { type: 'string' },
            expectedRevision: { type: 'number' },
            blockedBy: { type: 'array', items: { type: 'string' } },
            blockedReason: { $ref: '#/components/schemas/BlockedReason' },
            reviewScores: {
              type: 'array',
              items: { type: 'number' },
              minItems: 4,
              maxItems: 4,
            },
            reviewComments: {
              type: 'array',
              items: { $ref: '#/components/schemas/ReviewComment' },
            },
            position: { type: 'number' },
          },
        },
        Subtask: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            completed: { type: 'boolean' },
            created: { type: 'string', format: 'date-time' },
          },
        },
        BlockedReason: {
          type: 'object',
          nullable: true,
          properties: {
            category: {
              type: 'string',
              enum: ['waiting-on-feedback', 'technical-snag', 'prerequisite', 'other'],
            },
            note: { type: 'string' },
          },
        },
        TimeTracking: {
          type: 'object',
          properties: {
            entries: { type: 'array', items: { $ref: '#/components/schemas/TimeEntry' } },
            totalSeconds: { type: 'number' },
            isRunning: { type: 'boolean' },
            activeEntryId: { type: 'string' },
          },
        },
        TimeEntry: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            startTime: { type: 'string', format: 'date-time' },
            endTime: { type: 'string', format: 'date-time' },
            duration: { type: 'number', description: 'Duration in seconds' },
            description: { type: 'string' },
          },
        },
        ReviewComment: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            file: { type: 'string' },
            line: { type: 'number' },
            content: { type: 'string' },
            created: { type: 'string', format: 'date-time' },
          },
        },
        Comment: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            author: { type: 'string' },
            text: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
            revision: { type: 'number' },
            createdBy: { type: 'string' },
            updatedBy: { type: 'string' },
            updated: { type: 'string', format: 'date-time' },
          },
        },
        PaginatedResponse: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/Task' } },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'number' },
                limit: { type: 'number' },
                total: { type: 'number' },
                totalPages: { type: 'number' },
              },
            },
          },
        },
        AuthSetupInput: {
          type: 'object',
          properties: {
            password: {
              type: 'string',
              minLength: 8,
              description: 'Initial admin password (min 8 characters)',
            },
          },
          required: ['password'],
        },
        LoginInput: {
          type: 'object',
          properties: {
            password: { type: 'string', description: 'Admin password' },
            rememberMe: {
              type: 'boolean',
              description: 'If true, session lasts 30 days instead of 24 hours',
            },
          },
          required: ['password'],
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
          },
        },
        TaskTimeline: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            project: { type: 'string' },
            sprint: { type: 'string' },
            agent: { type: 'string' },
            status: { type: 'string' },
            startTime: { type: 'string', format: 'date-time' },
            endTime: { type: 'string', format: 'date-time' },
            durationSeconds: { type: 'number' },
            timeEntries: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  startTime: { type: 'string', format: 'date-time' },
                  endTime: { type: 'string', format: 'date-time' },
                  duration: { type: 'number' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
        ParallelismSnapshot: {
          type: 'object',
          properties: {
            timestamp: { type: 'string', format: 'date-time' },
            concurrentTaskCount: { type: 'number' },
            taskIds: { type: 'array', items: { type: 'string' } },
          },
        },
        TimelineResponse: {
          type: 'object',
          properties: {
            period: {
              type: 'object',
              properties: {
                from: { type: 'string', format: 'date-time' },
                to: { type: 'string', format: 'date-time' },
              },
            },
            tasks: {
              type: 'array',
              items: { $ref: '#/components/schemas/TaskTimeline' },
            },
            parallelism: {
              type: 'array',
              items: { $ref: '#/components/schemas/ParallelismSnapshot' },
            },
            summary: {
              type: 'object',
              properties: {
                totalTasks: { type: 'number' },
                maxConcurrency: { type: 'number' },
                averageConcurrency: { type: 'number' },
                timelineStartTime: { type: 'string', format: 'date-time' },
                timelineEndTime: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
        AgentPeriod: {
          type: 'object',
          properties: {
            agent: { type: 'string' },
            startTime: { type: 'string', format: 'date-time' },
            endTime: { type: 'string', format: 'date-time' },
            durationSeconds: { type: 'number' },
            tasksCompleted: { type: 'number' },
            totalTaskDurationSeconds: { type: 'number' },
          },
        },
        MetricsResponse: {
          type: 'object',
          properties: {
            period: {
              type: 'object',
              properties: {
                from: { type: 'string', format: 'date-time' },
                to: { type: 'string', format: 'date-time' },
                sprint: { type: 'string' },
              },
            },
            parallelism: {
              type: 'object',
              properties: {
                averageConcurrency: { type: 'number' },
                maxConcurrency: { type: 'number' },
                minConcurrency: { type: 'number' },
              },
            },
            throughput: {
              type: 'object',
              properties: {
                tasksCompleted: { type: 'number' },
                tasksCreated: { type: 'number' },
                averageCompletionTime: { type: 'number' },
              },
            },
            leadTime: {
              type: 'object',
              properties: {
                fromTodoToDone: { type: 'number' },
                fromCreatedToStarted: { type: 'number' },
                fromStartedToDone: { type: 'number' },
              },
            },
            agentUtilization: {
              type: 'array',
              items: { $ref: '#/components/schemas/AgentPeriod' },
            },
            efficiency: {
              type: 'object',
              properties: {
                totalTrackedTime: { type: 'number' },
                totalTaskCount: { type: 'number' },
                averageTimePerTask: { type: 'number' },
                utilizationRate: { type: 'number' },
              },
            },
          },
        },
      },
    },
    security: [{ ApiKeyAuth: [] }, { CookieAuth: [] }],
  },
  apis: [
    './src/routes/tasks.ts',
    './src/routes/auth.ts',
    './src/routes/task-comments.ts',
    './src/routes/task-time.ts',
    './src/routes/analytics.ts',
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
