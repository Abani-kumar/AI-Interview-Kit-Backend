const swaggerUi = require('swagger-ui-express');

// Swagger UI is served by app.js at /api/docs. Authentication uses the same
// httpOnly session cookie as the browser app, so log in with the UI first and
// then try the protected kit endpoints.
const swaggerDocument = {
  openapi: '3.0.3',
  info: {
    title: 'AI Interview Prep Kit API',
    version: '1.0.0',
    description: 'Interactive API documentation. Register or log in first to test protected endpoints.',
  },
  servers: [{ url: '/api', description: 'Current server' }],
  tags: [
    { name: 'Health' },
    { name: 'Authentication' },
    { name: 'Kits' },
    { name: 'Practice' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Check API health',
        responses: { 200: { description: 'API is available', content: { 'application/json': { schema: { $ref: '#/components/schemas/Health' } } } } },
      },
    },
    '/auth/register': {
      post: {
        tags: ['Authentication'], summary: 'Create an account and start a session',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/RegisterRequest' } } } },
        responses: {
          201: { description: 'Account created', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } } },
          400: { $ref: '#/components/responses/BadRequest' }, 409: { description: 'Email already registered' },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Authentication'], summary: 'Log in and start a session',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } } },
        responses: {
          200: { description: 'Logged in', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } } },
          400: { $ref: '#/components/responses/BadRequest' }, 401: { description: 'Invalid email or password' },
        },
      },
    },
    '/auth/logout': {
      post: { tags: ['Authentication'], summary: 'End the current session', responses: { 204: { description: 'Logged out' } } },
    },
    '/auth/me': {
      get: {
        tags: ['Authentication'], summary: 'Get the signed-in user', security: [{ cookieAuth: [] }],
        responses: { 200: { description: 'Current user', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } } }, 401: { $ref: '#/components/responses/Unauthorized' } },
      },
    },
    '/kits': {
      post: {
        tags: ['Kits'],
        summary: 'Create a kit and start the generation pipeline',
        security: [{ cookieAuth: [] }],
        description: 'Requires login. Queues extract-requirements and runs all stages asynchronously.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateKitRequest' },
            },
          },
        },
        responses: {
          201: {
            description: 'Kit created and queued',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateKitResponse' },
              },
            },
          },
          202: { description: 'Kit created but Redis enqueue failed (stalled)' },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      get: {
        tags: ['Kits'], summary: 'List the current user\'s kits', security: [{ cookieAuth: [] }],
        responses: { 200: { description: 'Kits', content: { 'application/json': { schema: { type: 'object', required: ['kits'], properties: { kits: { type: 'array', items: { $ref: '#/components/schemas/KitSummary' } } } } } } }, 401: { $ref: '#/components/responses/Unauthorized' } },
      },
    },
    '/kits/{id}': {
      get: {
        tags: ['Kits'], summary: 'Get one of the current user\'s kits', security: [{ cookieAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/KitId' }],
        responses: { 200: { description: 'Kit', content: { 'application/json': { schema: { type: 'object', properties: { kit: { $ref: '#/components/schemas/Kit' } } } } } }, 401: { $ref: '#/components/responses/Unauthorized' }, 403: { description: 'Kit does not belong to the current user' }, 404: { description: 'Kit not found' } },
      },
    },
    '/kits/{id}/practice': {
      get: {
        tags: ['Practice'],
        summary: 'Get practice summary for a kit',
        security: [{ cookieAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/KitId' }],
        responses: {
          200: { description: 'Practice summary', content: { 'application/json': { schema: { $ref: '#/components/schemas/PracticeSummary' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Kit does not belong to the current user' },
          404: { description: 'Kit not found' },
          409: { description: 'Kit is not ready for practice yet' },
        },
      },
    },
    '/kits/{id}/practice/flashcards/{flashcardId}': {
      post: {
        tags: ['Practice'],
        summary: 'Record a confidence rating for a flashcard practice attempt',
        security: [{ cookieAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/KitId' },
          { name: 'flashcardId', in: 'path', required: true, schema: { type: 'string' }, example: 'f1' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['confidence'],
                properties: {
                  confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Duplicate retry within idempotency window' },
          201: { description: 'Attempt recorded', content: { 'application/json': { schema: { $ref: '#/components/schemas/PracticeAttemptResponse' } } } },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Kit does not belong to the current user' },
          404: { description: 'Kit or flashcard not found' },
          409: { description: 'Kit is not ready for practice yet' },
        },
      },
    },
  },
  components: {
    securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'token', description: 'Set automatically after using register or login in this Swagger UI.' } },
    parameters: { KitId: { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'MongoDB kit ID' } },
    responses: { BadRequest: { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }, Unauthorized: { description: 'Not authenticated or session has expired', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
    schemas: {
      Health: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean', example: true } } },
      RegisterRequest: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email', example: 'ada@example.com' }, password: { type: 'string', format: 'password', minLength: 8, example: 'secure-password' }, name: { type: 'string', example: 'Ada Lovelace' } } },
      LoginRequest: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email', example: 'ada@example.com' }, password: { type: 'string', format: 'password', example: 'secure-password' } } },
      User: { type: 'object', properties: { _id: { type: 'string', example: '665000000000000000000000' }, email: { type: 'string', format: 'email' }, name: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } } },
      AuthResponse: { type: 'object', required: ['user'], properties: { user: { $ref: '#/components/schemas/User' } } },
      CreateKitRequest: {
        type: 'object',
        required: ['jd', 'days'],
        properties: {
          jd: { type: 'string', description: 'Full job description text', example: 'Senior Backend Engineer. Must have Node.js, AWS...' },
          companyUrl: { type: 'string', format: 'uri', example: 'https://www.google.com' },
          company_url: { type: 'string', format: 'uri', description: 'Snake_case alias for companyUrl', example: 'https://www.google.com' },
          days: { type: 'integer', minimum: 1, example: 5, description: 'Study days available before interview' },
        },
      },
      CreateKitResponse: {
        type: 'object',
        required: ['kitId', 'status'],
        properties: {
          kitId: { type: 'string', example: '665000000000000000000000' },
          status: { type: 'string', enum: ['queued', 'stalled'], example: 'queued' },
        },
      },
      KitSummary: { type: 'object', properties: { _id: { type: 'string' }, userId: { type: 'string' }, status: { type: 'string', enum: ['queued', 'generating', 'ready', 'failed', 'stalled'] }, currentStage: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } } },
      Kit: { allOf: [{ $ref: '#/components/schemas/KitSummary' }, { type: 'object', properties: { data: { type: 'object', additionalProperties: true } } }] },
      PracticeSummary: {
        type: 'object',
        properties: {
          totalFlashcards: { type: 'integer', example: 12 },
          practicedFlashcards: { type: 'integer', example: 8 },
          coveragePercent: { type: 'integer', example: 67 },
          lowConfidenceCount: { type: 'integer', example: 3 },
          mediumConfidenceCount: { type: 'integer', example: 2 },
          highConfidenceCount: { type: 'integer', example: 3 },
          weakRequirementIds: { type: 'array', items: { type: 'string' }, example: ['r4', 'r7'] },
          requirements: {
            type: 'array',
            items: { $ref: '#/components/schemas/PracticeRequirementAnalytics' },
          },
        },
      },
      PracticeRequirementAnalytics: {
        type: 'object',
        properties: {
          requirementId: { type: 'string', example: 'r4' },
          flashcardCount: { type: 'integer', example: 3 },
          practicedFlashcardCount: { type: 'integer', example: 2 },
          lowCount: { type: 'integer', example: 1 },
          mediumCount: { type: 'integer', example: 1 },
          highCount: { type: 'integer', example: 0 },
          strengthPercent: { type: 'integer', example: 25 },
          weaknessPercent: { type: 'integer', example: 75 },
        },
      },
      PracticeAttemptResponse: {
        type: 'object',
        properties: {
          attempt: {
            type: 'object',
            properties: {
              flashcardId: { type: 'string', example: 'f1' },
              confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
              practicedAt: { type: 'string', format: 'date-time' },
            },
          },
          summary: { $ref: '#/components/schemas/PracticeSummary' },
          idempotent: { type: 'boolean' },
        },
      },
      Error: { type: 'object', properties: { error: { type: 'string', example: 'Not authenticated' } } },
    },
  },
};

function mountSwagger(app) {
  app.get('/api/openapi.json', (req, res) => res.json(swaggerDocument));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, { swaggerOptions: { withCredentials: true } }));
}

module.exports = { mountSwagger, swaggerDocument };
