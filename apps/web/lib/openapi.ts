/**
 * The OpenAPI 3.1 description of the public API.
 *
 * Kept as a typed object in the repository — rather than generated from
 * decorators or inferred from route files — so it can be reviewed as a
 * contract. The reference implementation ships no machine-readable spec at
 * all, which is why its developer experience depends entirely on hand-written
 * prose docs.
 *
 * Served at /api/v1/openapi.json.
 */

const errorSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: {},
      },
      required: ['code', 'message'],
    },
  },
  required: ['error'],
} as const;

const wordSummary = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    language: { type: 'string', description: 'ISO 639-3 language code' },
    headword: { type: 'string' },
    exactForm: { type: 'string', description: 'Tone-stripped spelling; letter diacritics retained' },
    slug: { type: 'string' },
    pronunciation: { type: ['string', 'null'] },
    isCommon: { type: 'boolean' },
    isVerified: { type: 'boolean' },
    frequencyRank: { type: ['integer', 'null'] },
    glosses: { type: 'array', items: { type: 'string' } },
    partOfSpeech: { type: ['string', 'null'] },
    matchType: {
      type: 'string',
      enum: ['headword', 'variant', 'dialect', 'definition', 'fuzzy'],
    },
    score: { type: 'number' },
  },
} as const;

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Ozituma API',
    version: '1.0.0',
    description:
      'A dictionary API for African languages. Igbo is available now; further languages are added as they are prepared.',
    // The terms a developer building on this API is accepting. They point at the
    // docs page rather than the about page: the about page is about the project,
    // and a machine-readable licence URL has to resolve to the terms themselves.
    // The terms a developer accepts by taking a key, stated without naming the
    // licences of the material behind the dictionary. The owner's rule is that
    // nothing public describes where the content came from or on what terms it
    // arrived; what a reuser needs to know is what they may do and what is asked
    // of them, and that is all this says.
    license: { name: 'Free to use; credit Ozituma', url: 'https://ozituma.com/docs#fair-use' },
    contact: { name: 'Ozikoro', url: 'https://ozikoro.com' },
  },
  servers: [
    { url: 'https://ozituma.com/api/v1', description: 'Production' },
    { url: 'http://localhost:3000/api/v1', description: 'Local development' },
  ],
  security: [{ ApiKeyHeader: [] }],
  components: {
    securitySchemes: {
      ApiKeyHeader: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'Your Ozituma API key. Create one free at /developers.',
      },
    },
    schemas: {
      Error: errorSchema,
      WordSummary: wordSummary,
      PaginatedWords: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/WordSummary' } },
          total: { type: 'integer' },
          page: { type: 'integer' },
          perPage: { type: 'integer' },
          hasMore: { type: 'boolean' },
          diagnostics: { type: 'object' },
        },
      },
      WordDetail: {
        allOf: [
          { $ref: '#/components/schemas/WordSummary' },
          {
            type: 'object',
            properties: {
              definitions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    text: { type: 'string' },
                    label: { type: ['string', 'null'] },
                    position: { type: 'integer' },
                    partOfSpeech: {
                      type: ['object', 'null'],
                      properties: {
                        code: { type: 'string' },
                        name: { type: 'string' },
                      },
                    },
                  },
                },
              },
              dialects: { type: 'array', items: { type: 'object' } },
              forms: { type: 'array', items: { type: 'object' } },
              scripts: {
                type: 'array',
                description:
                  'The headword written in an alternative script, e.g. Ndebe. `value` is a ' +
                  'string of Private Use Area codepoints and needs the script\'s font to ' +
                  'render, so a client that will not ship the font should show `code` and ' +
                  'leave the value alone.',
                items: {
                  type: 'object',
                  properties: {
                    code: { type: 'string' },
                    value: { type: 'string' },
                    note: { type: ['string', 'null'] },
                  },
                },
              },
              examples: { type: 'array', items: { type: 'object' } },
              related: { type: 'array', items: { type: 'object' } },
              audio: { type: 'array', items: { type: 'object' } },
              attribution: {
                type: ['object', 'null'],
                properties: {
                  sourceName: { type: 'string' },
                  sourceUrl: { type: ['string', 'null'] },
                  license: { type: 'string' },
                  licenseUrl: { type: ['string', 'null'] },
                  citation: { type: ['string', 'null'] },
                },
              },
            },
          },
        ],
      },
    },
    responses: {
      Unauthorized: {
        description: 'Missing or invalid API key',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      QuotaExceeded: {
        description: 'Daily quota exceeded for your plan',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
  },
  paths: {
    '/words': {
      get: {
        operationId: 'searchWords',
        summary: 'Search the dictionary',
        description:
          'Matches headwords, alternate spellings, dialect spellings and English definitions in a single call. ' +
          'An empty keyword browses high-frequency words instead of erroring.',
        parameters: [
          { name: 'keyword', in: 'query', schema: { type: 'string' }, description: 'Search text' },
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Alias for keyword' },
          { name: 'language', in: 'query', schema: { type: 'string', default: 'ibo' } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { name: 'strict', in: 'query', schema: { type: 'boolean' } },
          { name: 'dialect', in: 'query', schema: { type: 'string' } },
          { name: 'wordClasses', in: 'query', schema: { type: 'string' }, description: 'Comma-separated grammar codes' },
          { name: 'tags', in: 'query', schema: { type: 'string' } },
          { name: 'common', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: {
          '200': {
            description: 'Matching entries',
            headers: {
              'Content-Range': { schema: { type: 'string' }, description: 'e.g. items 0-19/93' },
              'X-RateLimit-Limit': { schema: { type: 'integer' } },
              'X-RateLimit-Remaining': { schema: { type: 'integer' } },
            },
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/PaginatedWords' } },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '429': { $ref: '#/components/responses/QuotaExceeded' },
        },
      },
    },
    '/words/{id}': {
      get: {
        operationId: 'getWord',
        summary: 'Fetch one entry',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Numeric id or slug' },
          { name: 'language', in: 'query', schema: { type: 'string', default: 'ibo' } },
        ],
        responses: {
          '200': {
            description: 'The entry',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/WordDetail' } } },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': {
            description: 'No such entry',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '429': { $ref: '#/components/responses/QuotaExceeded' },
        },
      },
    },
    '/word-of-the-day': {
      get: {
        operationId: 'wordOfTheDay',
        summary: 'Deterministic daily entry',
        parameters: [{ name: 'language', in: 'query', schema: { type: 'string', default: 'ibo' } }],
        responses: {
          '200': {
            description: 'The day\u2019s entry',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/WordDetail' } } },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/languages': {
      get: {
        operationId: 'listLanguages',
        summary: 'List languages with real word counts',
        responses: {
          '200': {
            description: 'Languages',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { type: 'object' } },
                    length: { type: 'integer' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/stats': {
      get: {
        operationId: 'getStats',
        summary: 'Corpus statistics',
        responses: {
          '200': { description: 'Counts', content: { 'application/json': { schema: { type: 'object' } } } },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/developers': {
      post: {
        operationId: 'createDeveloper',
        summary: 'Create an API key',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  organization: { type: 'string' },
                  useCase: { type: 'string' },
                },
                required: ['name', 'email'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Key created. The plaintext key is returned once and never again.',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          '400': {
            description: 'Invalid body',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '429': { $ref: '#/components/responses/QuotaExceeded' },
        },
      },
    },
  },
} as const;

export type OpenApiDocument = typeof openApiDocument;
