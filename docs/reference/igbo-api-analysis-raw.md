# Architecture Spec: Igbo API (`nkowaokwu/igbo_api`) — Reimplementation Blueprint

**Source of truth:** `/tmp/igbo_api_ref` (read-only reference; never modified).
**Repo version:** `package.json` → `"name": "igbo-api"`, `"version": "1.64.2"`, `"main": "server.js"`, `engines: { node: ">=20", npm: ">=8" }`.
**Scope note (important):** this repo is *the API + the `igboapi.com` marketing site + a developer dashboard*. The dictionary web app **nkowaokwu.com is a separate application** that consumes this API. Evidence inside this repo:

| Evidence | File |
| --- | --- |
| `export const DICTIONARY_APP_URL = 'https://nkowaokwu.com';` | `src/siteConstants.ts:6` |
| `"The Igbo API hosts and serves all word and example sentence data that is shown on Nkọwa okwu, our official online Igbo-English dictionary app."` | `src/public/locales/en/about.json` |
| `// Matches the SuggestionSourceEnum in Igbo API Editor Platform` | `src/shared/constants/SuggestionSourceEnum.ts:1` |
| Footer/CTA link out to nkowaokwu.com rather than rendering a dictionary | `src/pages/components/Footer/Footer.tsx`, `src/pages/components/CallToAction/CallToAction.tsx` |

Consequences are called out explicitly in §7 so a reimplementer does not look for games/leaderboards here.

---

## 1. MONOREPO / PROJECT LAYOUT

### 1.1 Top-level tree (verified)

```
/
├── @types/                 # hand-written ambient module declarations (14 files)
├── __mocks__/              # 17 Jest manual mocks (mongoose, stripe, firebase-admin, ...)
├── __tests__/              # backend integration tests (supertest) + shared/ helpers
├── .github/workflows/      # deploy.yml, dockerize.yml, integration.yml, lint.yml, release.yml
├── cypress/                # e2e/ client.cy.js, support/, plugins/, fixtures/
├── functions/              # Firebase Functions package (built artifact target)
│   ├── index.js            # the ONLY hand-written file in functions/
│   ├── package.json        # duplicate dependency list, engines.node = "20"
│   ├── next.config.js      # copies of the root Next configs
│   ├── next-i18next.config.js
│   ├── postcss.config.js
│   ├── tailwind.config.js
│   └── .gitignore          # node_modules/, .env*
├── migrations/             # 63 migrate-mongo migration files (2020-11-06 → 2025-04-17)
├── public/                 # Firebase Hosting "public" dir
├── src/
│   ├── APIs/               # FlagsAPI.ts (response shaping), RedisAPI.ts (cache read/write)
│   ├── controllers/        # express controllers + controllers/utils/* + controllers/stripe/*
│   ├── dictionaries/       # ig-en/, en-ig/, nsibidi/, buildDictionaries.ts, seed.ts
│   ├── lib/gtag.js
│   ├── middleware/         # auth, cache, rate limit, validators, helpers/
│   ├── models/             # Word, Example, Developer, DeveloperUsage, NsibidiCharacter, Stat
│   │   └── plugins/index.ts
│   ├── pages/              # Next.js frontend (see §7)
│   ├── public/             # fonts/Akagu2020.ttf, locales/{en,ig}/*
│   ├── routers/            # router.ts (v1), routerV2.ts, siteRouter.ts, stripeRouter.ts, testRouter.ts
│   ├── services/           # database.ts, firebase.ts, firebase-admin.ts, firebaseConfigs.ts, stripe.ts, words.ts
│   ├── shared/             # constants/ (~35 files), utils/
│   ├── types/              # TS interfaces (word, example, developer, developerUsage, nsibidiCharacter, stat, express)
│   ├── app.ts              # express app assembly (exports `api`)
│   ├── server.ts           # standalone listen() for docker/local
│   ├── config.ts           # every env var + derived constants
│   └── functions.ts        # Firebase callable `onDemo`
├── Dockerfile
├── docker-compose.yml
├── firebase.json
├── .firebaserc
├── next.config.js
├── next-i18next.config.js
├── tailwind.config.js / postcss.config.js
├── jest.backend.config.ts / jest.backend.database.config.ts / jest.frontend.config.ts
├── migrate-mongo-config.js
├── testSetup.ts
└── tsconfig.json / tsconfig.test.json / env.d.ts
```

294 files under `src/`.

### 1.2 How frontend and backend coexist

They share one repo, one `tsconfig.json`, one `package.json`, and one Next.js server that also mounts Express.

* **Express** lives in `src/app.ts` and is exported as `api`. It mounts API routers at `/api/v1` and `/api/v2`.
* **Next.js** is *mounted inside Express* via `src/routers/siteRouter.ts`:

```ts
// src/routers/siteRouter.ts
const nextApp = nextjs({});
const handle = nextApp.getRequestHandler();
const routes = compact([/^\/$/]);
const siteRouter = Router();
siteRouter.get('/docs', (_, res) => res.redirect(API_DOCS));
siteRouter.use(async (req, res, next) => { /* nextApp.render or handle(req,res,parsedUrl) */ });
```

`src/app.ts` mounts it last (before the error handler) with `app.use(siteRouter, cache())`.

* **Next page discovery** is narrowed to `*.page.tsx`:

```js
// next.config.js
module.exports = {
  distDir: 'dist',
  generateBuildId: async () => 'api-homepage',
  pageExtensions: ['page.tsx'],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  i18n,   // from ./next-i18next.config
};
```

So `src/pages/index.page.tsx` → `/`, `src/pages/dashboard/credentials.page.tsx` → `/dashboard/credentials`, while non-`.page.` files (`App.tsx`, `layout.tsx`, `login.tsx`, `error.tsx`) are ordinary modules.

### 1.3 `functions/` vs `build/` vs `dist/`

Three output directories with distinct roles:

| Dir | Producer | Contents | Consumer |
| --- | --- | --- | --- |
| `build/` | `tsc -p ./tsconfig.json` (`outDir: "./build"`) | compiled CommonJS of `src/**` incl. `build/src/app.js`, `build/src/dictionaries/*.js` | `npm start` (`node ./build/src/server.js`); copied into `functions/` |
| `dist/` | `next build` (`distDir: 'dist'`) | Next.js SSR build; also `dist/assets/`, `dist/fonts/`, `dist/dictionaries/ig-en` | static mounts `/_next`, `/assets`, `/fonts`; copied into `functions/` |
| `functions/` | `npm run build:functions` | `functions/src` (= copy of `build`), `functions/dist` (= copy of `dist`), `functions/dictionaries` (= copy of `build/src/dictionaries/ig-en`) | Firebase Functions `source: "functions"` |

Exact scripts:

```jsonc
"build":       "rm -rf dist/ && rm -rf build/ && npm run build:site && npm run build:src",
"build:src":   "tsc -p ./tsconfig.json && cross-env NODE_ENV=build npm run build:dictionaries && npm run build:functions",
"build:site":  "cross-env NEXT_PUBLIC_GA_ID=$GA_TRACKING_ID next build && npm run build:fonts && npm run build:assets",
"build:fonts": "shx cp -r ./src/public/fonts/ ./dist/fonts",
"build:assets":"shx cp -r ./src/pages/assets/ ./dist/assets",
"build:functions": "rm -rf functions/src && shx cp -r ./build ./functions && shx cp -r ./dist ./functions && shx cp -r ./build/src/dictionaries/ig-en ./functions/dictionaries"
```

`.gitignore` excludes `build/`, `dist`, `functions/src`, `functions/dictionaries` — they are pure artifacts.

**What runs on Firebase Functions vs Next.js:** everything runs in one Express app inside one Cloud Function. `functions/index.js` (the only hand-written file there):

```js
const { onRequest } = require('firebase-functions/v2/https');
const { api, demo } = require('./build/src/app');

exports.api_2 = onRequest({ cors: true, concurrency: 500, memory: '2GiB' }, api);
exports.demo = demo;   // firebase-functions/v1 https.onCall, defined in src/functions.ts
```

`firebase.json` rewrites *all* hosting traffic to that function, so Next.js SSR and the API are one deployment:

```json
{
  "functions": [{ "source": "functions", "ignore": ["node_modules", ".git", "firebase-debug.log", "firebase-debug.*.log"] }],
  "hosting": {
    "public": "public",
    "rewrites": [{ "source": "**", "function": "api_2", "region": "us-central1" }],
    "headers": [{ "source": "/", "headers": [{ "key": "Cache-Control", "value": "public, max-age=302400, s-maxage=604800" }] }]
  },
  "emulators": { "auth": { "port": 9709 }, "functions": { "port": 8848 }, "hosting": { "port": 5061 }, "ui": { "enabled": false }, "pubsub": { "port": 8088 } }
}
```

`.firebaserc`:

```json
{ "projects": { "default": "igbo-api-bb22d", "staging": "igbo-api-staging-99a67" } }
```

### 1.4 Express assembly (`src/app.ts`) — exact middleware order

```ts
const app = express();
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
if (process.env.NODE_ENV === 'development') { app.use(morgan('dev')); app.use('*', logger); }
app.options('*', cors());
app.use(cors(CORS_CONFIG));          // { origin: true, exposedHeaders: ['Content-Range', 'X-Content-Range'] }
app.set('trust proxy', 1);
app.use('/_next', express.static('./dist'));
app.use('/assets', cache(), express.static('./dist/assets'));
app.use('/fonts', cache(), express.static('./dist/fonts'));
app.use('/services', cache(), express.static('./services'));
app.use(`/api/${Version.VERSION_1}`, cache(86400, 172800), router);
app.use(`/api/${Version.VERSION_2}`, cache(86400, 172800), routerV2);
app.use('/stripe', stripeRouter);
app.use(siteRouter, cache());
app.use(errorHandler);               // must be last
export const api = app;
export const demo = onDemo;
```

`cache(maxAge=302400, smaxAge=604800)` sets `Cache-Control: public, max-age=…, s-maxage=…` only on GET. All handlers run on `trust proxy` so `express-rate-limit` sees real client IPs.

### 1.5 Standalone server (`src/server.ts`)

```ts
const server = app.listen(PORT, () => {
  if (process.env.NODE_ENV === 'build') {           // CI smoke test
    setTimeout(() => { console.green('✅ Build test passed'); process.exit(0); }, 5000);
  }
});
```

`PORT = process.env.PORT || 8080`. The `build` self-test is invoked by `npm run test:build` in CI.

### 1.6 Docker

`Dockerfile`:

```dockerfile
FROM node:18
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build
ENV PORT=8080
ENV CONTAINER_HOST=mongodb
EXPOSE 8080
CMD ["npm", "start"]
```

> Mismatch worth fixing in a reimplementation: image is `node:18`, but `engines.node >= 20`, `functions/package.json` requires node 20, and `src/config.ts` uses `fetch` in `fetchBase64Data`.

`docker-compose.yml`: three `mongo:4.2` nodes forming replica set `rs0` on ports 2717/2727/2737 (volumes into `/data/mongos/db{1,2,3}`), plus a `server` service built from `.`, `ports: 8080:8080`, `depends_on` all three, named container `igbo_api_server`.

`CONTAINER_HOST=mongodb` is load-bearing: `src/config.ts` uses it to select the Mongo host and to force the *test* database when not in dev/prod, and `seedDatabase` restarts the container when `CONTAINER_HOST === 'mongodb'` so text indexes get rebuilt.

### 1.7 Dev scripts (local topology)

| Script | Effect |
| --- | --- |
| `npm run dev` | `npm-run-all -p start:watch start:database dev:site` |
| `start:watch` | nodemon watches `./src`, `npm run build:src && npm run start`, exports `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9709` |
| `start:database` | `mongod --port 27017 --dbpath ./db` |
| `start:database:replica` | three mongods 2717/2727/2737 with `--replSet rs0` |
| `dev:site` / `dev:site:next` | `firebase functions:config:set runtime.env=development && next -p 3035` |
| `start:emulators` | `firebase emulators:start --only functions,hosting,auth` |
| `dev:backend` | `start:watch` + `start:emulators` + `start:database` |
| `dev:full:database` | sets `env.redis_url`, `env.replica_set=true`, `env.redis_status=true`, then watch + emulators + replica DB |
| `kill:project` | `fkill :5005 :8085 :8080 :8081 :8088 -fs` |
| `migrate-up` / `migrate-down` | `migrate-mongo up` / `down` |

---

## 2. DATA MODEL

Mongoose 6.7. Connections are opened per request via `src/services/database.ts`:

```ts
export const createDbConnection = (): mongoose.Connection => {
  if (isConnected()) return mongoose.connection;     // readyState !== 0
  const connection = mongoose.createConnection(MONGO_URI, {
    autoIndex: true,
    readPreference: isTest ? 'primary' : 'nearest',
  });
  connection.on('error', console.error.bind(console, 'connection error:'));
  return connection;
};
export const handleCloseConnection = async (connection) => {
  if (typeof connection?.readyState === 'number' && connection?.readyState !== DISCONNECTED)
    await connection.close();
};
```

Models are registered lazily on that connection in each consumer (`connection.model<X>('Name', schema)`), not imported as compiled models — except `src/models/Word.ts`, which calls `mongoose.model('Word', wordSchema)` and `WordModel.syncIndexes()` at import time.

### 2.1 `src/models/plugins/index.ts`

Only two plugins, applied per-schema.

```ts
/* Replaces the _id key with id */
export const toJSONPlugin = (schema: mongoose.Schema) => {
  const toJSON = schema.methods.toJSON || mongoose.Document.prototype.toJSON;
  schema.set('toJSON', { virtuals: true });
  schema.methods.toJSON = function () {
    const json = toJSON.apply(this);
    delete json._id; delete json.__t; delete json.__v;
    return json;
  };
};

export const toObjectPlugin = {
  transform: (doc: mongoose.Document, ret: mongoose.Document) => {
    ret.id = doc.id.toString();
    delete ret._id;
    delete ret.__v;
  },
};
```

* `toJSONPlugin` → public API output uses `id`, never `_id`/`__v`. Set as a schema *option* (`toObject: toObjectPlugin`) for subdocuments/aggregation, and as a *method override* via `toJSONPlugin(schema)`.
* `toObjectPlugin` is always passed as `{ toObject: toObjectPlugin }` in schema options, so `.$toObject` subdocuments also carry `id`.
* Every collection therefore has `id` (string) plus `createdAt`/`updatedAt` where `timestamps: true`.

### 2.2 `Word.ts` — complete field-by-field

#### 2.2.1 TypeScript interfaces (`src/types/word.ts`, verbatim)

```ts
type WordClass = string | WordDialect;

export interface Definition {
  definitions: string[];
  id?: string;
  igboDefinitions: { igbo: string, nsibidi: string }[];
  nsibidi: string;
  nsibidiCharacters: string[];
  wordClass: WordClass;
}

export interface WordDialect {
  dialects: DialectEnum[];
  editor?: string;
  id: string;
  pronunciation: string;
  variations: string[];
  word: string;
}

export interface LegacyWordDialect { [k: string]: WordDialect; }

type Attribute = { [key in WordAttributeEnum]: boolean };

interface WordBase {
  attributes: Attribute;
  conceptualWord: string;
  frequency: number;
  hypernyms: string[];
  hyponyms: string[];
  pronunciation: string;
  relatedTerms: string[] | { id: string, _id?: Types.ObjectId }[];
  stems: string[] | { id: string, _id?: Types.ObjectId }[];
  id: string;
  updatedAt: Date;
  variations: string[];
  word: string;
  wordPronunciation: string;
}

export interface IncomingWord extends WordBase {
  definitions: Definition[];
  dialects: WordDialect[];
  tags: string[];
  examples?: IncomingExample[];
}

export interface IncomingLegacyWord extends WordBase {
  definitions: string[];
  wordClass: WordClass;
  nsibidi: string;
  dialects: LegacyWordDialect;
  examples?: IncomingExample[];
}

export interface OutgoingWord extends IncomingWord {}
export interface OutgoingLegacyWord extends IncomingLegacyWord {}

export type WordType = OutgoingWord | Document<OutgoingWord> | Document<OutgoingLegacyWord>;
export type PartialWordType =
  | Partial<OutgoingWord> | Document<Partial<OutgoingWord>> | Document<Partial<OutgoingLegacyWord>>;
```

Note: `Definition` has no `label` field even though the schema declares one (see below).

#### 2.2.2 `definitionSchema`

```ts
const definitionSchema = new Schema(
  {
    wordClass: {
      type: String,
      default: WordClass.NNC.value,                 // 'NNC'
      enum: Object.values(WordClass).map(({ value }) => value),
    },
    label: { type: String, default: '', trim: true },
    definitions: { type: [{ type: String }], default: [] },
    nsibidi: { type: String, default: '', index: true },
    nsibidiCharacters: { type: [{ type: Types.ObjectId, ref: 'NsibidiCharacter' }], default: [] },
    igboDefinitions: {
      type: [{
        igbo: String,
        nsibidi: String,
        nsibidiCharacters: { type: [{ type: Types.ObjectId, ref: 'NsibidiCharacter' }], default: [] },
      }],
      default: [],
    },
  },
  { _id: true, toObject: toObjectPlugin }
);
```

| Field | Type | Default | Validation | Index |
| --- | --- | --- | --- | --- |
| `wordClass` | String | `'NNC'` | enum of all 21 `WordClass` values | — |
| `label` | String | `''` | trim | — |
| `definitions` | [String] | `[]` | — | `'definitions.definitions': 'text'` (collection-level) |
| `nsibidi` | String | `''` | — | `index: true` + explicit `'definitions.nsibidi': 1` |
| `nsibidiCharacters` | [ObjectId → NsibidiCharacter] | `[]` | ref | — |
| `igboDefinitions` | [{igbo, nsibidi, nsibidiCharacters}] | `[]` | — | — |

#### 2.2.3 `dialectSchema` (embedded subdocument, see §3)

```ts
const dialectSchema = new Schema(
  {
    word: { type: String, required: true, index: true, trim: true },
    variations: { type: [{ type: String }], default: [] },
    dialects: {
      type: [{ type: String }],
      validate: (v: DialectEnum[]) => every(v, (dialect) => Dialects[dialect].value),
      default: [],
    },
    pronunciation: { type: String, default: '' },
  },
  { toObject: toObjectPlugin }
);
```

#### 2.2.4 `wordSchema`

```ts
export const wordSchema = new Schema(
  {
    word: { type: String, required: true, trim: true },
    wordPronunciation: { type: String, default: '', trim: true },
    conceptualWord: { type: String, default: '', trim: true },
    definitions: [{
      type: definitionSchema,
      validate: (definitions: Definition[]) => Array.isArray(definitions) && definitions.length > 0,
    }],
    dialects: { type: [dialectSchema], default: [] },
    tags: {
      type: [String],
      default: [],
      validate: (v: WordTagEnum[]) =>
        v.every((tag) => Object.values(WordTags).map(({ value }) => value).includes(tag)),
    },
    tenses: Object.values(Tenses).reduce(
      (tenses, { value }) => ({ ...tenses, [value]: { type: String, default: '', trim: true } }), {}
    ),
    attributes: Object.values(WordAttributes).reduce(
      (finalAttributes, { value }) => ({ ...finalAttributes, [value]: { type: Boolean, default: false } }), {}
    ),
    pronunciation: { type: String, default: '' },
    variations: { type: [{ type: String }], default: [] },
    examples: { type: [{ type: String }], default: [] },
    frequency: { type: Number },
    relatedTerms: { type: [{ type: Types.ObjectId, ref: 'Word' }], default: [] },
    hypernyms:   { type: [{ type: Types.ObjectId, ref: 'Word' }], default: [] },
    hyponyms:    { type: [{ type: Types.ObjectId, ref: 'Word' }], default: [] },
    stems:       { type: [{ type: Types.ObjectId, ref: 'Word' }], default: [] },
  },
  { toObject: toObjectPlugin, timestamps: true, autoIndex: true }
);
```

Complete field table for `words`:

| Field | Type | Default | Required | Notes |
| --- | --- | --- | --- | --- |
| `word` | String (trim) | — | **yes** | headword |
| `wordPronunciation` | String (trim) | `''` | no | pronunciation of the headword itself |
| `conceptualWord` | String (trim) | `''` | no | concept grouping |
| `definitions` | [definitionSchema] | — | no | array validator requires length > 0 *if present* |
| `dialects` | [dialectSchema] | `[]` | no | dialectal spellings |
| `tags` | [String] | `[]` | no | validator restricts to the 24 `WordTagEnum` values |
| `tenses` | 7 × String (trim) | `''` each | no | `infinitive`, `imperative`, `simplePast`, `presentPassive`, `simplePresent`, `presentContinuous`, `future` |
| `attributes` | 8 × Boolean | `false` each | no | `isAccented`, `isBorrowedTerm`, `isCommon`, `isComplete`, `isConstructedTerm`, `isSlang`, `isStandardIgbo`, `isStem` |
| `pronunciation` | String | `''` | no | legacy/headword audio URL |
| `variations` | [String] | `[]` | no | non-dialect spelling variants |
| `examples` | [String] | `[]` | no | **declared as String but populated with Example ObjectIds** — see note |
| `frequency` | Number | *undefined* | no | no default; migration `20230314160556-convert-frequency-to-number` |
| `relatedTerms` | [ObjectId → Word] | `[]` | no | |
| `hypernyms` | [ObjectId → Word] | `[]` | no | |
| `hyponyms` | [ObjectId → Word] | `[]` | no | |
| `stems` | [ObjectId → Word] | `[]` | no | equals `relatedTerms`-style resolution in v2 |
| `createdAt`/`updatedAt` | Date | auto | — | `timestamps: true` |

**`examples` note:** the schema declares `[{ type: String }]`, but `src/controllers/words.ts#createWord` does `savedWord.examples = exampleIds` (ObjectIds) and `findWordsWithMatch` resolves examples through a `$lookup` on `examples.associatedWords`, not on `words.examples`. A reimplementation should pick one strategy: either a real `[ObjectId → Example]`, or drop the field and rely on `examples.associatedWords` (the `$lookup` is what actually serves the API).

#### 2.2.5 Indexes on `words` (verbatim, 12 explicit)

```ts
wordSchema.index({ word: 1 });
wordSchema.index({ 'definitions.definitions': 'text' });   // the only text index
wordSchema.index({ 'definitions.wordClass': 1 });
wordSchema.index({ variations: 1 });
wordSchema.index({ 'definitions.nsibidi': 1 });
wordSchema.index({ 'dialects.word': 1 });
wordSchema.index({ 'tenses.infinitive': 1 });
wordSchema.index({ 'tenses.imperative': 1 });
wordSchema.index({ 'tenses.simplePast': 1 });
wordSchema.index({ 'tenses.simplePresent': 1 });
wordSchema.index({ 'tenses.presentContinuous': 1 });
wordSchema.index({ 'tenses.future': 1 });

toJSONPlugin(wordSchema);
const WordModel = mongoose.model('Word', wordSchema);
WordModel.syncIndexes();
```

Plus implicit indexes: `dialectSchema.word` (`index: true`) and `definitionSchema.nsibidi` (`index: true`) → these appear as `dialects.word` and `definitions.nsibidi`. `frequency` and `attributes.*` are **not** indexed. Note also that `presentPassive` has no index even though it is a tense.

`schema.index({...}, { unique: true })` is used **nowhere** in this repo; uniqueness of `word` is not enforced. Duplicate-prevention is done in application code only (`uniqWith` by `id`, and `Developer` email checks).

### 2.3 `Example.ts`

```ts
const languageSuggestionSchema = new Schema({
  language: { type: String, enum: Object.values(LanguageEnum), default: LanguageEnum.UNSPECIFIED },
  text: { type: String, default: '', trim: true },
  pronunciations: {
    type: [{ audio: { type: String, default: '' }, speaker: { type: String, default: '' } }],
    default: [],
  },
});

export const exampleSchema = new Schema(
  {
    source: { type: languageSuggestionSchema, default: { language: LanguageEnum.UNSPECIFIED, text: '' } },
    translations: { type: [{ type: languageSuggestionSchema }], default: [] },
    meaning: { type: String, default: '' },
    nsibidi: { type: String, default: '' },
    type:  { type: String, enum: Object.values(SentenceTypes), default: SentenceTypes.DEFAULT },
    style: { type: String, enum: Object.values(ExampleStyles).map(({ value }) => value), default: ExampleStyles.NO_STYLE.value },
    associatedWords: { type: [{ type: Types.ObjectId, ref: 'Word' }], default: [] },
    associatedDefinitionsSchemas: { type: [{ type: Types.ObjectId }], default: [] },
  },
  { toObject: toObjectPlugin, timestamps: true }
);

exampleSchema.index({ associatedWords: 1 });
exampleSchema.index({ source: 1 });
exampleSchema.index({ translations: 1 });
toJSONPlugin(exampleSchema);
```

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `source` | languageSuggestionSchema | `{language:'UNSPECIFIED', text:''}` | the Igbo side |
| `translations` | [languageSuggestionSchema] | `[]` | English at `translations[0]` in practice |
| `meaning` | String | `''` | |
| `nsibidi` | String | `''` | |
| `type` | String enum `SentenceTypes` | `'default'` | `data_collection` \| `biblical` \| `default` |
| `style` | String enum | `'no_style'` | `no_style` \| `standard` \| `proverb` \| `biblical` |
| `associatedWords` | [ObjectId → Word] | `[]` | **the join used by `$lookup`** |
| `associatedDefinitionsSchemas` | [ObjectId] | `[]` | v2 only |
| `createdAt`/`updatedAt` | Date | auto | |

`languageSuggestionSchema.pronunciations` subdocs are `{ audio, speaker }`. The richer TS shape is in `src/types/example.ts`:

```ts
type ExampleBase = {
  associatedDefinitionsSchemas: string[],
  associatedWords: string[],
  meaning: string,
  nsibidi: string,
  nsibidiCharacters: string[],
  origin: SuggestionSourceEnum,
};

export type IncomingExample = ExampleBase & { source: Translation, translations: Translation[] };
export type OutgoingExample = IncomingExample & {};

export type OutgoingLegacyExample = ExampleBase & {
  igbo: string, english: string, pronunciation: string,
};

type Translation = { language: LanguageEnum, text: string, pronunciations: Pronunciation[] };

type Pronunciation = {
  _id: string, approvals: string[], audio: string,
  denials: string[], review: boolean, speaker: string,
};

export interface ExampleDocument extends IncomingExample, Document {
  _id: Types.ObjectId; __v: number; id: string;
}
```

`origin` and `nsibidiCharacters` are **not declared in the schema** but are read/written (seeding writes `origin`, `FlagsAPI` filters on it). `Pronunciation.approvals/denials/review` come from the (separate) editor platform; the API only ever reads `audio`.

**v1/v2 example projection** — `cleanExamples` in `buildDocs.ts`:

```ts
if (version === Version.VERSION_1) {
  cleanedExample.pronunciation = example.source.pronunciations?.[0]?.audio || '';
} else {
  cleanedExample.pronunciations = example.source.pronunciations.map(({ audio }) => audio);
}
cleanedExample.igbo = example.source.text;
cleanedExample.english = example.translations[0]?.text;
// source, translations, projectId are omitted
```

### 2.4 `Developer.ts`

```ts
export const developerSchema = new Schema(
  {
    name:     { type: String, default: '', required: true },
    apiKey:   { type: String, default: '', required: true, index: true },
    email:    { type: String, default: '', required: true },
    password: { type: String, default: '', required: true },
    usage: {
      date:  { type: Date,   default: new Date().toISOString() },
      count: { type: Number, default: 0 },
    }, // DEPRECATED: Please use DeveloperUsage
    firebaseId: { type: String, default: '' },
    stripeId:   { type: String, default: '' },
    plan:          { type: String, enum: Object.values(Plan),          default: Plan.STARTER },
    accountStatus: { type: String, enum: Object.values(AccountStatus), default: AccountStatus.UNPAID },
  },
  { toObject: toObjectPlugin, timestamps: true }
);
toJSONPlugin(developerSchema);
```

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `name` | String | `''` | required |
| `apiKey` | String | `''` | required, **indexed**, stored in cleartext (uuid v4) |
| `email` | String | `''` | required; used to link Firebase account → developer |
| `password` | String | `''` | required; bcrypt hash (10 rounds) or literal `'UNDEFINED_PASSWORD'` |
| `usage` | {date, count} | now / 0 | **deprecated**; superseded by `DeveloperUsage` |
| `firebaseId` | String | `''` | Firebase Auth uid |
| `stripeId` | String | `''` | Stripe customer id |
| `plan` | String enum | `'starter'` | `starter` \| `team` |
| `accountStatus` | String enum | `'unpaid'` | see §5.6 |

TS: `DeveloperClientData` (name, apiKey, email, password, stripeId, firebaseId, plan, accountStatus), `Developer extends DeveloperClientData` adds `usage`, `DeveloperDocument extends Developer, Document` (`id: Types.ObjectId`), `DeveloperResponse extends Developer` (`id: string`).

### 2.5 `DeveloperUsage.ts`

```ts
export const developerUsageSchema = new Schema(
  {
    developerId: { type: Types.ObjectId, ref: 'Developer', required: true },
    usageType: { type: String, enum: ApiType, default: ApiType.DICTIONARY },
    usage: {
      date:  { type: Date,   default: new Date().toISOString() },
      count: { type: Number, default: 0 },
    },
  },
  { toObject: toObjectPlugin, timestamps: true }
);
toJSONPlugin(developerUsageSchema);
```

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `developerId` | ObjectId → Developer | — | required |
| `usageType` | String enum `ApiType` | `'DICTIONARY'` | `DICTIONARY` \| `SPEECH_TO_TEXT` \| `TRANSLATE` |
| `usage.date` | Date | now | last request timestamp; compared by calendar day |
| `usage.count` | Number | 0 | requests used today |

No index is declared on `developerId`/`usageType` despite `findOne({developerId, usageType})` being the hot path — a reimplementation should add a compound unique index `{ developerId: 1, usageType: 1 }`.

TS (`src/types/developerUsage.ts`):

```ts
export interface DeveloperUsage {
  developerId: Types.ObjectId | string;
  usageType: ApiType;
  usage: { date: Date, count: number };
}
export interface DeveloperUsageDocument extends DeveloperUsage, Document { id: Types.ObjectId; }
```

### 2.6 `NsibidiCharacter.ts`

```ts
export const nsibidiCharacterSchema = new Schema({
  nsibidi: { type: String, required: true, index: true },
  definitions: { type: [{ text: String }], default: [] },
  pronunciation: { type: String, default: '' },
  radicals: { type: [{ id: { type: Types.ObjectId, ref: 'NsibidiCharacter' } }], default: [] },
  wordClass: {
    type: String,
    default: WordClass.NNC.nsibidiValue,                                  // '依名'
    enum: Object.values(WordClass).map(({ nsibidiValue }) => nsibidiValue),
  },
});
toJSONPlugin(nsibidiCharacterSchema);
mongoose.model('NsibidiCharacter', nsibidiCharacterSchema);
```

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `nsibidi` | String | — | **required**, indexed |
| `definitions` | [{text}] | `[]` | |
| `pronunciation` | String | `''` | |
| `radicals` | [{id: ObjectId → NsibidiCharacter}] | `[]` | self-referential; the `.id` wrapper is deliberate |
| `wordClass` | String enum (nsibidi values) | `'依名'` | CJK `nsibidiValue` from `WordClass` |

Differences from the other models: **no `toObject` plugin, no `timestamps`**, and the model is registered immediately at import (like `Word`). Only exposed on **v2** — `findNsibidiCharactersWithMatch` returns `{ nsibidiCharacters: [], contentLength: 0 }` when `version !== Version.VERSION_2`.

TS (`src/types/nsibidiCharacter.ts`) differs slightly (`radicals: Types.ObjectId[] | string[]`, `definitions: { text: string }[]`, no `id`-wrapper).

### 2.7 `Stat.ts`

```ts
export const statSchema = new Schema(
  {
    type: { type: String, required: true, enum: Object.values(StatTypes) },
    authorId: { type: String, default: 'SYSTEM' },
    value: { type: Schema.Types.Mixed, default: null },
  },
  { toObject: toObjectPlugin, timestamps: true }
);
toJSONPlugin(statSchema);
```

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `type` | String enum `StatTypes` | — | required; 13 values (see §2.9) |
| `authorId` | String | `'SYSTEM'` | |
| `value` | Mixed | `null` | counts are numbers in practice |

TS: `Stat { type: StatTypes; authorId: string; value: number }`.

### 2.8 Aggregation projection (`src/controllers/utils/buildDocs.ts`)

Every read path uses `Model.aggregate<T>().match(match)` with this projection — the authoritative list of publicly returned Word fields:

```ts
words = words
  .lookup({ from: 'examples', localField: '_id', foreignField: 'associatedWords', as: 'examples' })
  // v2 only:
  .lookup({ from: 'words', localField: 'stems',        foreignField: '_id', as: 'stems' })
  .lookup({ from: 'words', localField: 'relatedTerms', foreignField: '_id', as: 'relatedTerms' })
  .project({
    id: '$_id', _id: 0,
    word: 1, definitions: 1, variations: 1, stems: 1, relatedTerms: 1,
    updatedAt: 1, pronunciation: 1, attributes: 1, tenses: 1,
    examples: 1, dialects: 1, tags: 1,
  })
  .append({ $unset: `attributes.${WordAttributeEnum.IS_COMPLETE}` });      // isComplete never leaves the API
```

`contentLength` is `cleanedWords.length` — i.e. the *post-match, pre-pagination* count, returned in the `Content-Range` header (and as `length` in v2).

`removeKeysInNestedDoc(docs, key)` rewrites each nested subdoc's `_id` → `id` and drops `__v` for `examples`, `definitions`, and `radicals`.

### 2.9 Enumerations referenced by the model layer

```ts
enum WordClassEnum { ADJ, ADV, AV, PV, MV, CJN, DEM, NM, NNC, ND, NNP, CD, PREP, PRN, FW, QTF, WH, INTJ, ISUF, ESUF, SYM }   // 21
enum WordAttributeEnum { IS_ACCENTED='isAccented', IS_BORROWED_TERM='isBorrowedTerm', IS_COMMON='isCommon',
  IS_COMPLETE='isComplete', IS_CONSTRUCTED_TERM='isConstructedTerm', IS_SLANG='isSlang',
  IS_STANDARD_IGBO='isStandardIgbo', IS_STEM='isStem' }                                                                    // 8
enum WordTagEnum { AGRICULTURE, ARTS, BOTANY, COMMERCE, EDUCATION, FASHION, FOOD, GEOGRAPHY, KINSHIP, MARINE,
  MATHEMATICS, MEDICINE, CULTURE, LANGUAGE, LAW, PERFORMING_ARTS='performing_arts', POLITICS, RELIGION, SPORTS,
  TECHNOLOGY, TRANSPORTATION, VISUAL_ARTS='visual_arts', WEATHER, ZOOLOGY }                                                // 24
enum StatTypes { SUFFICIENT_WORDS, COMPLETE_WORDS, SUFFICIENT_EXAMPLES, COMPLETE_EXAMPLES, PROVERB_EXAMPLES,
  BIBLICAL_EXAMPLES, DIALECTAL_VARIATIONS, HEADWORD_AUDIO_PRONUNCIATIONS, STANDARD_IGBO, IGBO_DEFINITIONS,
  NSIBIDI_WORDS, NSIBIDI_WORD_SUGGESTIONS, USER }                                                                          // 13
enum SentenceTypes { DATA_COLLECTION='data_collection', BIBLICAL='biblical', DEFAULT='default' }
enum ExampleStyleEnum { NO_STYLE='no_style', STANDARD='standard', PROVERB='proverb', BIBLICAL='biblical' }
enum LanguageEnum { UNSPECIFIED='UNSPECIFIED', ENGLISH='eng', HAUSA='hau', IGBO='ibo', YORUBA='yor' }  // ISO 639-3
enum ApiType { DICTIONARY='DICTIONARY', SPEECH_TO_TEXT='SPEECH_TO_TEXT', TRANSLATE='TRANSLATE' }
enum Plan { STARTER='starter', TEAM='team' }
enum Version { VERSION_1='v1', VERSION_2='v2' }
enum Endpoint { AUDIO='audio', PREDICT='predict' }
```

`WordClass.ts` maps each code to `{ value, label, nsibidiValue, description }`; `nsibidiValue` is a CJK string, e.g.

```ts
[WordClassEnum.NNC]: { value: WordClassEnum.NNC, label: 'Noun', nsibidiValue: '依名',
  description: 'Used to identify any people, place , or thing. Eg. ụlọ, iko, akwụkwọ.' },
[WordClassEnum.AV]:  { value: WordClassEnum.AV,  label: 'Active verb',  nsibidiValue: '動壊', description: '…' },
[WordClassEnum.ISUF]:{ value: WordClassEnum.ISUF,label: 'Inflectional suffix', nsibidiValue: '壊興動', description: '…' },
```

`AccountStatus`:

```ts
enum AccountStatus { ACTIVE='active', PAUSED='paused', INCOMPLETE='incomplete',
  INCOMPLETE_EXPIRED='incomplete_expired', TRIALING='trialing', PAST_DUE='past_due',
  CANCELED='canceled', UNPAID='unpaid' }
export type Status = AccountStatus | Stripe.Subscription.Status;
```

`SuggestionSourceEnum` (provenance of examples/words, mirrors the editor platform):

```ts
export enum SuggestionSourceEnum {
  INTERNAL = 'internal',        // Created by a user on the platform
  COMMUNITY = 'community',      // Created by a user from Nkọwa okwu
  IGBO_SPEECH = 'igbo_speech',  // Created by a user from IgboSpeech
  IGBO_WIKIMEDIANS = 'igbo_wikimedians',
  BBC = 'bbc',
}
```

---

## 3. DIALECT SYSTEM

### 3.1 Canonical list of dialects (46 codes)

`src/shared/constants/DialectEnum.ts` — a TS enum used as the stored value:

```ts
enum DialectEnum {
  ABI='ABI', ACH='ACH', AFI='AFI', AJA='AJA', AMA='AMA', ANA='ANA', ANI='ANI', ASA='ASA', AWK='AWK', BON='BON',
  ECH='ECH', EGB='EGB', EKP='EKP', EZA='EZA', EZE='EZE', EZM='EZM', IHU='IHU', IKK='IKK', IKW='IKW', IQW='IQW',
  ISU='ISU', IZZ='IZZ', MBA='MBA', NDL='NDL', NDO='NDO', NGW='NGW', NKA='NKA', NKP='NKP', NKR='NKR', NSA='NSA',
  NSU='NSU', OGA='OGA', OGK='OGK', OGU='OGU', OHU='OHU', OKA='OKA', ONI='ONI', ORL='ORL', OWE='OWE', OBO='OBO',
  OGI='OGI', UDI='UDI', UKW='UKW', UMU='UMU', UNW='UNW',
}
```

`src/shared/constants/Dialect.ts` — the display registry keyed by that enum. Every entry has `{ code: 'ibo-<lowercased>', value, label }`:

| Enum | `code` | `label` | | Enum | `code` | `label` |
| --- | --- | --- | --- | --- | --- | --- |
| ABI | `ibo-abi` | Abịrịba | | NDL | `ibo-ndl` | Ndele |
| ACH | `ibo-ach` | Achala | | NDO | `ibo-ndo` | Ndoki |
| AFI | `ibo-afi` | Afiikpo | | NGW | `ibo-ngw` | Ngwa |
| AJA | `ibo-aja` | Ajalị | | NKA | `ibo-nka` | Nkanụ |
| AMA | `ibo-ama` | Amaifeke | | NKP | `ibo-nkp` | Mkpọọ |
| ANA | `ibo-ana` | Anam | | NKR | `ibo-nkr` | Nkporo |
| ANI | `ibo-ani` | Anịọcha | | NSA | `ibo-nsa` | Nsa |
| ASA | `ibo-asa` | Asa | | NSU | `ibo-nsu` | Nsụka |
| AWK | `ibo-awk` | Ọkụzụ | | OGA | `ibo-oga` | Ọgba |
| BON | `ibo-bon` | Ụbanị | | OGK | `ibo-ogk` | Ọgbakịrị |
| ECH | `ibo-ech` | Echee | | OGU | `ibo-ogu` | Ugwuta |
| EGB | `ibo-egb` | Egbema | | OHU | `ibo-ohu` | Ọhụhụ |
| EKP | `ibo-ekp` | Ẹkpẹyẹ | | OKA | `ibo-oka` | Ọka |
| EZA | `ibo-eza` | Ezaa | | ONI | `ibo-oni` | Ọnịcha |
| EZE | `ibo-eze` | Ezeagu | | ORL | `ibo-orl` | Ọlụ |
| EZM | `ibo-ezm` | Ezzamgbo | | OWE | `ibo-owe` | Owere |
| IHU | `ibo-ihu` | Ihuoma | | OBO | `ibo-obo` | Obosi |
| IKK | `ibo-ikk` | Ika | | OGI | `ibo-ogi` | Ogidi |
| IKW | `ibo-ikw` | Ikwere | | UDI | `ibo-udi` | Udi |
| IQW | `ibo-iqw` | Ikwo | | UKW | `ibo-ukw` | Ụkwụanị |
| ISU | `ibo-isu` | Isuama | | UMU | `ibo-umu` | Ụmụahịa |
| IZZ | `ibo-izz` | Izii | | UNW | `ibo-unw` | Unwana; Ungwana Lordji |
| MBA | `ibo-mba` | Mbaise | | | | |

Two source-level quirks: `EZM` is written as the literal `'EZM'` instead of `DialectEnum.EZM` (same value), and the `ibo-` prefix hardcodes the ISO 639-3 code for Igbo (`ibo`, cf. `LanguageEnum.IGBO = 'ibo'`).

`"Nsịbịdị"` and the `nsibidiValue` CJK strings are per-dialect-agnostic; no dialect carries a script variant.

### 3.2 How a dialect variation attaches to a word

A dialectal spelling is an **embedded subdocument of `word.dialects`**, not a separate collection:

```jsonc
{
  "word": "biko",                       // canonical headword
  "variations": ["bikonu"],             // non-dialect spelling variants (Word-level)
  "dialects": [
    {
      "word": "biko-dialect",           // the dialectal spelling (required, indexed)
      "variations": ["biko-ọzọ"],
      "dialects": ["NSA", "OWE"],       // DialectEnum codes, validated against Dialect.ts
      "pronunciation": "https://…/biko.mp3"
    }
  ]
}
```

Field roles:

| Field | Where | Meaning |
| --- | --- | --- |
| `word.dialects[]` | Word | one entry per dialectal spelling |
| `word.dialects[].word` | WordDialect | the dialectal form itself; **required**, `trim`, indexed (`dialects.word`) |
| `word.dialects[].dialects` | WordDialect | which dialect(s) that form belongs to — array of `DialectEnum` codes |
| `word.dialects[].variations` | WordDialect | further spelling variants *of that dialectal form* |
| `word.dialects[].pronunciation` | WordDialect | audio for that dialectal form |
| `word.dialects[].editor` | WordDialect (TS only, `editor?`) | who contributed it (not in the schema) |
| `word.dialects[].id` | WordDialect (TS) | virtual from `toObject: toObjectPlugin` |
| `word.variations` | Word | spelling variants that are *not* dialect-scoped |
| `word.attributes.isAccented` | Word | whether the headword carries diacritics |
| `word.attributes.isStandardIgbo` | Word | whether the headword is Standard Igbo |
| `word.pronunciation` / `word.wordPronunciation` | Word | headword audio |

The validator (`validate: (v) => every(v, (dialect) => Dialects[dialect].value)`) runs on **writes** only and does not prevent an empty array.

### 3.3 Filtering and grouping by dialect

**Query side:**

```ts
// src/controllers/utils/queries.ts
const generateMultipleDialectsWordRegex = (keywords: Keywords) => {
  const { regex } = keywords[0];
  return { 'dialects.word': { $regex: regex.wordReg.source, $options: 'i' } };
};
```

That clause is OR-ed with `word`, `variations`, and all seven `tenses.*` clauses inside `fullTextSearchQuery`, so a bare dialectal spelling finds the canonical entry. The dialect *code* (e.g. `NSA`) is **not queryable** — there is no `?dialect=NSA` filter parameter anywhere.

**Response side**, driven by `?dialects=true` → `flags.dialects`:

```ts
// src/APIs/FlagsAPI.ts
if (!dialects) { updatedWord = omit(updatedWord, ['dialects']); }
```

`?dialects` defaults to **false**: dialects are opt-in on every response. Minimization differs by version (`minimizeWords.ts`):

```ts
if (version === Version.VERSION_2 && minimizedWord.dialects?.length) {
  if (Array.isArray(minimizedWord.dialects))
    minimizedWord.dialects = minimizedWord.dialects.map((dialect) => {
      let minimizedDialect = omit(dialect, ['variations', 'id', '_id']);
      if (!minimizedDialect.pronunciation) minimizedDialect = omit(minimizedDialect, ['pronunciation']);
      return minimizedDialect;
    });
} else if (version === Version.VERSION_2 && !minimizedWord.dialects?.length) {
  minimizedWord = omit(minimizedWord, ['dialects']);
}
```

So **v2** returns `dialects: [{ word, dialects: ['NSA','OWE'], pronunciation? }]`; **v1** returns a *keyed object* (legacy shape) built in `buildDocs.ts`, which also translates enum codes into human labels:

```ts
word.dialects = (cleanedWord.dialects || []).reduce(
  (finalDialects, dialect) => ({
    ...finalDialects,
    [dialect.word]: { ...dialect, dialects: dialect.dialects.map((d) => Dialects[d].label) },
  }),
  {}
);
```

i.e. v1: `dialects: { "biko-dialect": { word, variations, dialects: ["Nsa","Owere"], pronunciation } }` — keyed by the dialectal spelling and labeled. (`getWord`/`getWords` v1 always include the `dialects` key because the v1 assembler sets `dialects: {}` before filling it; the `FlagsAPI` omit then removes it again unless `?dialects=true`.)

### 3.4 Frontend dialect grouping

The only dialect UI in this repo is a checkbox in the API demo (`src/pages/components/Demo/components/IgboAPI.tsx`):

```tsx
const handleDialects = ({ target }) => {
  if (target.checked) setQueries({ ...queries, dialects: target.checked });
  else setQueries(omit(queries, ['dialects']));
};
…
<Checkbox defaultChecked={!!initialQueries.dialects} onChange={handleDialects} data-test="dialects-flag">Dialects</Checkbox>
```

`queries` is forwarded as the callable's `params` and from there to `/api/v2/words?dialects=true`. Initial state is read from the URL (`queryString.parse(window.location.search)`), so `/?word=biko&dialects=true` is a shareable link. The dedicated dictionary app that renders per-dialect tabs is **not** in this repo.

### 3.5 Dialect-related migration history (design intent)

`migrations/` documents the evolution, useful when choosing a schema:

* `20210225022115-create-dialects.js`
* `20210225235148-update-variations-to-array.js`
* `20210306224633-add-dialects-for-word-suggestions-and-generic-words.js`
* `20210325194345-add-central-igbo.js` → `20210822145619-change-central-to-standard.js` (Central Igbo → Standard Igbo; today the boolean `attributes.isStandardIgbo`)
* `20210820170937-merge-accented-and-word.js`, `20210820175620-merge-accented-and-example.js` → `20220308132126-add-is-accented.js` (accented variants merged into `word`, tracked by `attributes.isAccented`)
* `20210814210437-pre-populate-dialects.js`, `20220125175808-restructure-dialects.js`, `20221107022314-resturcture-dialects-as-arrays.js` (final array form)
* `20221014123241-add-is-stem.js`, `20221030034746-restructure-definitions.js`, `20230118013604-convert-stems-to-object-id.js`

---

## 4. PUBLIC API SURFACE

Base paths derive from `Version`:

```ts
enum Version { VERSION_1 = 'v1', VERSION_2 = 'v2' }
// src/app.ts
app.use(`/api/${Version.VERSION_1}`, cache(86400, 172800), router);
app.use(`/api/${Version.VERSION_2}`, cache(86400, 172800), routerV2);
```

### 4.1 v1 — `src/routers/router.ts` (verbatim)

```ts
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const REQUESTS_PER_MS = 20;
const developerRateLimiter: MiddleWare = rateLimit({ windowMs: FIFTEEN_MINUTES, max: REQUESTS_PER_MS });

router.use(analytics);                                        // Google Analytics on every v1 route

router.get('/words',        validateApiKey, attachRedisClient, getWords);
router.get('/words/:id',    validateApiKey, validId, attachRedisClient, getWord);
router.get('/examples',     validateApiKey, attachRedisClient, getExamples);
router.get('/examples/:id', validateApiKey, validId, attachRedisClient, getExample);

router.get('/developers/:id', developerAuthorization, getDeveloper);
router.post('/developers',    developerRateLimiter, validateDeveloperBody, postDeveloper);
router.put('/developers',     developerRateLimiter, validateUpdateDeveloperBody, putDeveloper);

router.get('/stats', validateAdminApiKey, attachRedisClient, getStats);

/* Grabs data from JSON dictionary */
if (process.env.NODE_ENV !== 'production') { router.use('/test', testRouter); }
```

### 4.2 v2 — `src/routers/routerV2.ts` (verbatim)

```ts
routerV2.get('/words',         analytics, validateApiKey, attachRedisClient, getWords);
routerV2.get('/words/:id',     analytics, validateApiKey, validId, attachRedisClient, getWord);
routerV2.get('/examples',      analytics, validateApiKey, attachRedisClient, getExamples);
routerV2.get('/examples/:id',  analytics, validateApiKey, validId, attachRedisClient, getExample);
routerV2.get('/nsibidi',       analytics, validateApiKey, attachRedisClient, getNsibidiCharacters);
routerV2.get('/nsibidi/:id',   analytics, validateApiKey, validId, attachRedisClient, getNsibidiCharacter);

// Speech-to-Text
routerV2.post('/speech-to-text', analytics, validateApiKey, getTranscription);
routerV2.post('/translate',      analytics, validateApiKey, getTranslation);

// Redirects to V1
routerV2.post('/developers', (_, res) => res.redirect('/api/v1/developers'));
routerV2.get('/stats',       (_, res) => res.redirect('/api/v1/stats'));
```

Note ordering difference: **v2 puts `analytics` first on each route**, v1 uses `router.use(analytics)`. The two are functionally equivalent here.

### 4.3 Full route table

| # | Method | Path | Middleware chain | Auth | Controller |
| --- | --- | --- | --- | --- | --- |
| 1 | GET | `/api/v1/words` | analytics, validateApiKey, attachRedisClient | **API key** | `getWords` |
| 2 | GET | `/api/v1/words/:id` | analytics, validateApiKey, validId, attachRedisClient | **API key** | `getWord` |
| 3 | GET | `/api/v1/examples` | analytics, validateApiKey, attachRedisClient | **API key** | `getExamples` |
| 4 | GET | `/api/v1/examples/:id` | analytics, validateApiKey, validId, attachRedisClient | **API key** | `getExample` |
| 5 | GET | `/api/v1/developers/:id` | developerAuthorization | **Firebase Bearer token**, `uid === :id` | `getDeveloper` |
| 6 | POST | `/api/v1/developers` | developerRateLimiter, validateDeveloperBody | **public** → returns `apiKey` | `postDeveloper` |
| 7 | PUT | `/api/v1/developers` | developerRateLimiter, validateUpdateDeveloperBody | **public** (Joi requires `firebaseId`) | `putDeveloper` |
| 8 | GET | `/api/v1/stats` | validateAdminApiKey, attachRedisClient | **admin** (MAIN_KEY, enforced only in production) | `getStats` |
| 9 | GET | `/api/v1/test` | — | none (non-production only) | inline welcome string |
| 10 | POST | `/api/v1/test/populate` | — | none (non-production only) | `seedDatabase` |
| 11 | GET | `/api/v1/test/words` | — | none (non-production only) | `getWordData` (JSON dictionary) |
| 12 | GET | `/api/v2/words` | analytics, validateApiKey, attachRedisClient | **API key** | `getWords` |
| 13 | GET | `/api/v2/words/:id` | analytics, validateApiKey, validId, attachRedisClient | **API key** | `getWord` |
| 14 | GET | `/api/v2/examples` | analytics, validateApiKey, attachRedisClient | **API key** | `getExamples` |
| 15 | GET | `/api/v2/examples/:id` | analytics, validateApiKey, validId, attachRedisClient | **API key** | `getExample` |
| 16 | GET | `/api/v2/nsibidi` | analytics, validateApiKey, attachRedisClient | **API key** | `getNsibidiCharacters` |
| 17 | GET | `/api/v2/nsibidi/:id` | analytics, validateApiKey, validId, attachRedisClient | **API key** | `getNsibidiCharacter` |
| 18 | POST | `/api/v2/speech-to-text` | analytics, validateApiKey | **API key** | `getTranscription` |
| 19 | POST | `/api/v2/translate` | analytics, validateApiKey | **API key** | `getTranslation` |
| 20 | POST | `/api/v2/developers` | — | none | `302` → `/api/v1/developers` |
| 21 | GET | `/api/v2/stats` | — | none | redirect → `/api/v1/stats` |
| 22 | POST | `/stripe/checkout` | authorizeCheckoutSession (Joi) | public (form POST) | `postCheckoutSession` |
| 23 | POST | `/stripe/portal` | authorizePortalSession (Joi) | public | `postPortalSession` |
| 24 | POST | `/stripe/webhook` | validateStripeSignature | Stripe signature | `postWebhook` |
| 25 | GET | `/docs` | siteRouter | none | `302` → `https://docs.igboapi.com` |
| 26 | GET | `/**` | siteRouter → Next.js SSR | none | pages from `src/pages/**/*.page.tsx` |

There is **no** public `/health`, no CORS-preflight handler beyond `app.options('*', cors())`, and no request-id/tracing middleware.

### 4.4 Query parameters (`src/types/express.ts` + `handleQueries`)

```ts
export type Query = {
  dialects: string, examples: string, style: ExampleStyleEnum, filter: string,
  keyword: string, page: string, range: string, resolve: string,
  strict: string, tags: string, wordClasses: string, apiLimit: string,
};
```

| Param | Parsed as | Semantics |
| --- | --- | --- |
| `keyword` | string | the search term; quotes (`/["'].*["']/`) force the English path; stripped of `"`/`'` |
| `page` | `parseInt(page,10)` | `skip = page * 10` (DEFAULT_RESPONSE_LIMIT) |
| `range` | `JSON.parse` → `[start, end]` | inclusive-end array; `isValidRange` requires `range[0] < range[1]` and `end+1-start <= 25` (MAX_RESPONSE_LIMIT) |
| `filter` | `JSON.parse` | first key's value becomes the keyword, e.g. `{"word":"biko"}` |
| `strict` | `=== 'true'` | switches Igbo search to `strictSearchIgboQuery` (word field only, no tone-folding) |
| `dialects` | `=== 'true'` | include `dialects` in the response |
| `examples` | `=== 'true'` | include `examples` in the response |
| `style` | `ExampleStyles[q.toUpperCase()].value` | filter examples by style; **throws** on an unknown value |
| `tags` | CSV, brackets stripped | `{ tags: { $in: [...] } }` |
| `wordClasses` | CSV, brackets stripped, `.sort()` | `{ 'definitions.wordClass': { $in: [...] } }` |
| `resolve` | `=== 'true'` | when false (default), `stems`/`relatedTerms` are returned as id strings rather than resolved docs |
| `apiLimit` | — | **declared in the type and used in a skipped test, but never read by `handleQueries`** — dead parameter |

`skip`/`limit` defaults: `convertToSkipAndLimit` returns `{ skip: 0, limit: 10 }`; invalid `page` throws `'Page is not a number.'`; negative skip throws `'Page must be a positive number.'`; invalid `range`/`filter` throw explicit messages.

`handleQueries` also applies one Igbo-specific rewrite: `removePrefix(keyword || filter || '').replace(/[Aa]na m /, 'm ')`.

### 4.5 Response shapes and versioning

`packageResponse` is the single serializer:

```ts
export const packageResponse = ({ res, docs, contentLength, version }) => {
  res.set({ 'Content-Range': contentLength });
  const response = version === Version.VERSION_2 ? { data: docs, length: contentLength } : docs;
  return res.send(response);
};
```

| | v1 | v2 |
| --- | --- | --- |
| List response | bare array | `{ data: [...], length: N }` |
| Single response | bare object | `{ data: {...}, length: 1 }` |
| Total count | `Content-Range` response header | `Content-Range` header **and** `length` |
| `definitions` | `string[]` (flattened from all definition schemas) | `Definition[]` objects |
| `wordClass` / `nsibidi` | promoted to the **top level** (from `definitions[0]`) | inside each definition |
| `dialects` | keyed object, labels instead of codes | array, enum codes |
| `tags` | **stripped** | present |
| `hypernyms`/`hyponyms`/`updatedAt`/`createdAt` | removed by `minimizeWords` | removed too (same function) |
| `definitions[].label`, `.igboDefinitions`, `.id` | — | stripped |
| examples | `{ igbo, english, pronunciation, meaning, nsibidi, style, associatedWords, id, updatedAt, createdAt }` | `{ igbo, english, meaning, style, type, associatedWords, associatedDefinitionsSchemas, id, nsibidi, pronunciations: string[], updatedAt, createdAt }` |
| `nsibidi` endpoints | not available | available |
| `?resolve=true` | n/a | resolves `stems`/`relatedTerms` into `{ word, id }` |

The v1 legacy conversion in `buildDocs.ts`:

```ts
if (version === Version.VERSION_1) {
  const word: OutgoingLegacyWord = assign(omit(cleanedWord, ['tags', 'dialects']), {
    wordClass: '', nsibidi: '', definitions: [], dialects: {},
  });
  word.wordClass = cleanedWord.definitions[0].wordClass;
  word.nsibidi    = cleanedWord.definitions[0].nsibidi;
  word.definitions= flatten(cleanedWord.definitions.map(({ definitions }) => definitions));
  word.dialects   = (cleanedWord.dialects || []).reduce(/* key by dialect.word, label codes */);
  return word;
}
```

Version is derived from the request, not from the router module: `const version = baseUrl.endsWith(Version.VERSION_2) ? Version.VERSION_2 : Version.VERSION_1;` — so `/api/v2` → v2, everything else → v1.

### 4.6 The `/api/v2` auth model

**There is no separate v2 authentication scheme.** v2 uses the identical `X-API-Key` middleware as v1. What v2 adds is *entitlement surface*:

* `?resolve=true` (resolvable `stems`/`relatedTerms`) — advertised as a Team-plan feature in `pricingFeatures.tsx`
* natively array-shaped dialects (the "consistent dialects data structure" bullet)
* multiple `pronunciations[]` per example rather than a single `pronunciation`
* `tags`, `nsibidi` endpoints
* `definitions` as objects with `wordClass` per definition

`/api/v2/stats` and `/api/v2/developers` are pure redirects to v1, so v2 has **no** admin or account surface of its own.

### 4.7 Error handling

```ts
const errorHandler: ErrorMiddleWare = (err, _, res, __) => {
  res.status(400);
  if (err.message.match(/No .{1,} exist(s)?/) || err.message.match(/doesn't exist(s)?/)) res.status(404);
  console.error(err?.stack);
  return res.send({ error: err.message });
};
```

Default error status is **400**, upgraded to 404 when the message matches `No … exist(s)` / `doesn't exist(s)`. Every error body is `{ error: string }`. Middleware-authored statuses: 401 (invalid API key), 403 (admin key / malformed auth header / uid mismatch), 400 (bad id, bad `filter`, bad `range`, Joi validation, usage-limit exceeded). Notable detail: exceeding the daily limit throws `'You have exceeded your limit for this API for the day.'`, which does **not** match the 404 pattern, so the real status is **400** even though the (skipped) test at `__tests__/developers.test.ts:111` asserts 403.

Notable error messages worth reusing verbatim: `"X-API-Key Header doesn't exist"`, `'Your API key is invalid'`, `'Provided an invalid id'`, `'No word exists with the provided id.'`, `'No example exists with the provided id.'`, `'No associated developer found.'`, `'This email is already used.'`, `'Invalid filter query syntax. Expected: {"word":"filter"}, Received: …'`, `'Invalid range query syntax. Expected: [x,y], Received: …'`, `NO_PROVIDED_TERM = 'No search term provided. Use the keyword query to search.'`.

---

## 5. DEVELOPER API-KEY SYSTEM

### 5.1 Signup and key issuance

Two independent paths exist.

**Path A — modern, Firebase-first (used by the dashboard).** `src/pages/signup/login.tsx`:

```tsx
const googleProvider = new GoogleAuthProvider();
const gitHubProvider  = new GithubAuthProvider();

const handleSignIn = (signInMethod) => async () => {
  const user = await signInMethod();
  try   { await putDeveloper(user); }        // PUT /api/v1/developers
  catch { await getDeveloper(user.uid); }    // fallback: already registered
  finally { router.push('/dashboard'); }
};
```

`putDeveloper` (`src/pages/APIs/DevelopersAPI.ts`) sends `{ firebaseId: user.uid, email: user.email, name: user.displayName }` with an `Authorization: Bearer <getIdToken()>` header. On the server, `putDeveloperHelper` creates the account if absent:

```ts
let developer = await Developer.findOne(query);
if (!developer && data.email && data.name) {
  developer = await postDeveloperHelper({ data: { email: data.email, name: data.name, password: DEFAULT_PASSWORD } });
}
```

with `const DEFAULT_PASSWORD = 'UNDEFINED_PASSWORD';` and, crucially, `generateApiKey = uuid` — the API key is a plain **uuid v4**, stored unhashed in `Developer.apiKey`, and returned to the client by the dashboard's credentials page. `postDeveloperHelper` also refuses duplicate emails (`'This email is already used.'`) with a `developer@example.com` carve-out for tests.

**Path B — legacy email/password signup.** `POST /api/v1/developers` with Joi-validated `{ name, email, password }`:

```ts
const apiKey = generateApiKey();
const hashedPassword = await hash(password, 10);
const developer = new Developer({ name, email, apiKey, password: hashedPassword });
…
return res.send({ message: `Success email sent to ${email}`, apiKey: developer.apiKey, id: developer.id });
```

The key is emailed through SendGrid (`sendNewDeveloper` → template `SENDGRID_NEW_DEVELOPER_ACCOUNT_TEMPLATE`, from `API_FROM_EMAIL = 'kedu@nkowaokwu.com'`). `i18n` copy for this flow lives in `src/public/locales/*/signup.json` (`"Custom Igbo API Key:"`, `"Please save this key in a secure location. This key will disappear once you leave this page"`).

There is **no key rotation, no multiple-keys-per-developer, no scopes, and no expiry**. One developer = one `apiKey`.

### 5.2 Dashboard pages

| Page path | File | Content |
| --- | --- | --- |
| `/dashboard` | `src/pages/dashboard/dashboard.tsx` (entry `index.page.tsx`) | `Daily IgboAPI Usage` stat card, hardcoded `Daily limit: 500`, `Last date used: <MMMM DD, YYYY>` from `developer.usage.date` |
| `/dashboard/credentials` | `credentials.page.tsx` | masked `Input` with `developer.apiKey`, eye toggle (`FiEye`/`FiEyeOff`), copy button with 3s "Copied" tooltip |
| `/dashboard/profile` | `profile.page.tsx` | avatar, `developer.name`, `developer.email`; Stripe-connected badge is commented out |
| `/dashboard/plans` | `plans.page.tsx` | plan copy, plus a plain HTML form: `<form action={`${SERVER_DOMAIN}/stripe/checkout`} method="POST">` with hidden `lookupKey=igbo_api_team` and `developerId={developer.id}`; the Upgrade button is commented out (`{/* TODO: uncomment this when ready to use Stripe */}`) |
| — | `layout.tsx` | shared chrome: `DashboardMenu`, `DashboardNavigationMenu`, `AuthManager`, `SlideFade` |
| — | `error.tsx` | "An error occurred. Unable to load the page." |
| — | `components/DashboardNavigationMenu.tsx` | nav routes: `/dashboard`, `/dashboard/credentials`, `/dashboard/profile`, `/dashboard/plans` |

Data flow: `layout.tsx` uses `useAuthState(auth)` (react-firebase-hooks) → `getDeveloper(user.uid)` → sets the Jotai atom `developerAtom` (`src/pages/atoms/dashboardAtoms.ts`). `AuthManager` bounces unauthenticated users to `/signup`.

`/stripe/checkout` is a form POST (not XHR), and it responds `res.redirect(303, session.url)` — so the browser lands on Stripe Checkout directly.

### 5.3 Request authentication middleware — exact header

Header name: **`X-API-Key`** (read case-insensitively as both `X-API-Key` and `x-api-key`).

```ts
const FALLBACK_API_KEY = 'fallback_api_key';

const validateApiKey: MiddleWare = async (req, res, next) => {
  try {
    let apiKey = (req.headers['X-API-Key'] || req.headers['x-api-key']) as string;

    /* Official sites can bypass validation */
    if (apiKey === MAIN_KEY) { req.isUsingMainKey = true; return next(); }
    req.isUsingMainKey = false;

    if (!apiKey && isDevelopment) apiKey = FALLBACK_API_KEY;
    if (!apiKey) throw new Error("X-API-Key Header doesn't exist");

    /* While in development or testing, using the FALLBACK_API_KEY will grant access */
    if (apiKey === FALLBACK_API_KEY && !isProduction) return next();

    const developer = await findDeveloper(apiKey);
    if (!developer) return res.status(401).send({ error: 'Your API key is invalid' });

    await authorizeDeveloperUsage({ path: req.route.path, developer });
    return next();
  } catch (err: any) { res.status(400); return res.send({ error: err.message }); }
};
```

Four authentication classes, in order of precedence:

1. **`MAIN_KEY`** (from `ENV_MAIN_KEY`, default `'main_key'`) — complete bypass, and *widens results*: `isUsingMainKey` disables the empty-keyword guard and enables the unbounded regex path. Used by first-party sites and by `src/functions.ts` (the demo callable calls `/api/v2/words`, `/api/v2/speech-to-text`, `/api/v2/translate` with `'X-API-Key': MAIN_KEY`).
2. **`FALLBACK_API_KEY = 'fallback_api_key'`** — accepted whenever `!isProduction` (development *and* test), so local dev needs no account.
3. **A real developer key** — looked up, then metered.
4. **Absent/invalid** — `400 "X-API-Key Header doesn't exist"` or `401 { error: 'Your API key is invalid' }`.

`findDeveloper` has a legacy-compatibility fallback:

```ts
export const findDeveloper = async (apiKey: string) => {
  let developer = await Developer.findOne({ apiKey });
  if (developer) return developer;
  // Legacy implementation: hashed API tokens can't be indexed
  const developers = await Developer.find({});
  developer = developers.find((dev) => compareSync(apiKey, dev.apiKey)) || null;
  if (developer) { developer.apiKey = apiKey; return await developer.save(); }   // migrate to cleartext
  return developer;
};
```

That full-collection `find({})` + bcrypt scan is the reason cleartext `apiKey` is the modern representation; a reimplementation should index a **hash** of the key instead and drop this path.

`validateAdminApiKey` (only `/api/v1/stats`):

```ts
const apiKey = req.headers['X-API-Key'] || req.headers['x-api-key'];
if (isProduction && apiKey !== MAIN_KEY) {
  return res.status(403).send({ error: 'You do not have permission to view this resource' });
}
return next();
```

In non-production it lets everything through.

`developerAuthorization` (only `GET /api/v1/developers/:id`) is the **only** Bearer-token route:

```ts
const authorizationHeader = req.get('authorization') || '';
if (!authorizationHeader.startsWith('Bearer ')) return res.status(403).send({ error: 'Incorrectly formatted authorization header.' });
const token = authorizationHeader.split(' ')[1] || '';
const decoded = await admin.auth().verifyIdToken(token);
req.user = decoded;
if (!req.user.email) return res.status(404).send({ error: 'No user email associated with Firebase.' });
const developer = await getDeveloperByEmail(req.user.email);
req.developer = developer;
if (req.user.uid !== id) return res.status(404).send({ error: 'Unable to access this resource.' });
```

So: Firebase ID token verified by `firebase-admin`, then the Developer is looked up **by email** (not by `firebaseId`), and the path param must equal the token's `uid`. `getDeveloper` (the controller) separately looks up by `firebaseId`.

### 5.4 Usage metering — `DeveloperUsage`

Path → API-type mapping (`src/controllers/utils/…/authorizeDeveloperUsage.ts`):

```ts
const getApiTypeFromRoute = (route: string): ApiType => {
  switch (route) {
    case ApiTypeToRoute.SPEECH_TO_TEXT: return ApiType.SPEECH_TO_TEXT;   // 'speech-to-text'
    case ApiTypeToRoute.TRANSLATE:      return ApiType.TRANSLATE;        // 'translate'
    default:                            return ApiType.DICTIONARY;
  }
};
const getPath = (path: string) => path.split(/[\/\?]/)[0];   // 'speech-to-text/params=x' -> 'speech-to-text'
```

`req.route.path` is passed in, so `/words/:id` and `/words` both map to `DICTIONARY` (anything that is not `speech-to-text` or `translate` is DICTIONARY).

Daily counters (`ApiUsageLimit`):

```ts
const ApiUsageLimit = {
  [ApiType.DICTIONARY]: 2500,
  [ApiType.SPEECH_TO_TEXT]: 20,
  [ApiType.TRANSLATE]: 5,
};
```

Increment algorithm:

```ts
const isSameDate = (first, second) =>
  first.getFullYear() === second.getFullYear() &&
  first.getMonth()    === second.getMonth() &&
  first.getDate()     === second.getDate();

const handleDeveloperUsage = async ({ developer, apiType }) => {
  const currentDate = new Date();
  let developerUsage = await findDeveloperUsage({ developerId: developer.id.toString(), usageType: apiType });

  if (!developerUsage && apiType === ApiType.DICTIONARY) {
    developerUsage = await createDeveloperUsage({ developerId: new Types.ObjectId(developer.id.toString()) });
  }
  if (!developerUsage) throw new Error('No developer usage found');
  if (developerUsage.usage.count >= ApiUsageLimit[apiType]) {
    throw new Error('You have exceeded your limit for this API for the day.');
  }
  const isNewDay = !isSameDate(developerUsage.usage.date, currentDate);
  developerUsage.usage.count = isNewDay ? 0 : developerUsage.usage.count + 1;
  developerUsage.usage.date = currentDate;
  developerUsage.markModified('usage');
  return developerUsage.save();
};
```

Behaviours to preserve (or deliberately redesign):
* the counter is stored **per (developer, API type)**, so one document per developer per API;
* lazily created for `DICTIONARY` only — a `SPEECH_TO_TEXT` / `TRANSLATE` call for a developer without such a row throws `'No developer usage found'`;
* the limit is checked **before** incrementing, i.e. `count >= limit` blocks, so the allowed count is exactly `limit`;
* reset is calendar-day-based on the stored date, so it is timezone-dependent (server local time).

`PROD_LIMIT = 500` is exported from `src/config.ts` but **never imported anywhere**; the dashboard's "Daily limit: 500" string and the first `pricingFeatures` row (Starter `'500'`) are hardcoded, and the most recent commit on the repo is `chore: limit free sandbox requests to 500 requests`. A reimplementation must pick one source of truth: the enforced `ApiUsageLimit` (2500/20/5) currently contradicts the advertised Starter limit (500).

### 5.5 Rate limiting and Redis

`express-rate-limit@5` is applied **only** to the account-creation routes:

```ts
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const REQUESTS_PER_MS = 20;              // misnomer: this is a max count, not a rate
const developerRateLimiter: MiddleWare = rateLimit({ windowMs: FIFTEEN_MINUTES, max: REQUESTS_PER_MS });
```

→ 20 requests / 15 minutes per IP on `POST`/`PUT /api/v1/developers`. **No rate limiting exists on `/words`, `/examples`, `/nsibidi`, `/speech-to-text`, or `/translate`** — those are bounded only by the daily per-developer quota. Any reimplementation should add burst protection.

Redis is used for **response caching**, not rate limiting. `src/middleware/attachRedisClient.ts`:

```ts
export const redisClient =
  REDIS_HOST && REDIS_PORT && REDIS_USERNAME && REDIS_PASSWORD
    ? createClient({ socket: { host: REDIS_HOST, port: REDIS_PORT }, username: REDIS_USERNAME, password: REDIS_PASSWORD })
    : REDIS_URL && process.env.FIREBASE_FUNCTIONS
      ? createClient({ url: 'redis://localhost:6379' })
      : { set: () => null, get: () => null, on: () => console.log('\nFake Redis client'),
          connect: () => console.log('Connected to fake Redis client'), isFake: true, isReady: true };

const attachRedisClient: MiddleWare = async (req, res, next) => {
  if (!redisClient.isReady) redisClient.connect();
  redisClient.on('error', (err) => console.log('Redis Client Error', err));
  res.on('finish', () => afterResponse(redisClient));   // quit()
  res.on('close',  () => afterResponse(redisClient));
  req.redisClient = redisClient as RedisClientType;
  return next();
};
```

Key facts: a module-level singleton client; a **fake client** fallback when unconfigured (so the API works without Redis); and `afterResponse` calls `redisClient.quit()` on every response while the same client is reused next request (relying on `isReady` flipping false to reconnect). Cache TTL is `REDIS_CACHE_EXPIRATION = 604800` (7 days), set via `{ EX: REDIS_CACHE_EXPIRATION }`.

Cache keys (`src/controllers/utils/searchWordUsingIgbo.ts`, `searchWordUsingEnglish.ts`, `src/controllers/examples.ts`):

```
`${searchWord}-${JSON.stringify(filters)}-${version}`      // Igbo search
`"${searchWord}"-${JSON.stringify(filters)}-${version}`    // English search (quoted keyword)
`example-${searchWord}-${version}`                          // examples
`verbs-and-suffixes-${key}`                                 // bulk verb/suffix list
```

Cached payloads are run through `minimizeWords(items, version)` before `JSON.stringify`, and the cached `contentLength` is the **full** count while `words` is the **full** result set (pagination is applied after cache retrieval). `setCachedWords` returns the minimized data even when Redis is fake, so the code path is identical with or without Redis.

### 5.6 Stripe tiers, plans, and gating

`src/shared/constants/Plan.ts`:

```ts
enum Plan { STARTER = 'starter', TEAM = 'team' }
```

`src/pages/pricing/_index.page.tsx` prices: Starter **$0** ("Built for small teams and independent developers looking to get started developing."), Team **$10 / month** ("Built for startups and larger organizations looking to scale their services.") with features `['Igbo API v2', 'Resolvable data', 'Beta access to IgboSpeech', 'Beta access to Igbo OCR']`.

The full advertised tier matrix — `src/pages/dashboard/shared/pricingFeatures.tsx`:

| Category | Feature | Starter | Team |
| --- | --- | --- | --- |
| Data | Daily requests | **500** | **2,500** |
| Data | 25,000+ words | ✅ | ✅ |
| Data | 50,000+ sentences | ✅ | ✅ |
| Data | 100+ hours of audio data | ❌ | ✅ |
| Data | Cached verbs and suffixes | ❌ | ✅ |
| Data | Multiple audio recordings for sentences | ❌ | ✅ |
| Data | Consistent dialects data structure | ❌ | ✅ |
| Data | Resolve attached word stems and related terms | ❌ | ✅ |
| Features | Access to the IgboSpeech API | ❌ | ✅ |
| Features | Access to the Igbo OCR API | ❌ | ✅ |

Checkout wiring (`src/controllers/stripe/index.ts`):

```ts
const productPlans: { [key: string]: Plan } = { igbo_api_team: Plan.TEAM };

const prices = await stripe.prices.list({ lookup_keys: [req.body.lookupKey], expand: ['data.product'] });
const session = await stripe.checkout.sessions.create({
  billing_address_collection: 'auto',
  line_items: [{ price: prices.data[0].id, quantity: 1 }],
  metadata: { developerId: req.body.developerId, plan: productPlans[req.body.lookupKey] },
  mode: 'subscription',
  success_url: `${API_ROUTE}/?success=true&session_id={CHECKOUT_SESSION_ID}`,
  cancel_url:  `${API_ROUTE}/?canceled=true`,
});
return res.redirect(303, session.url || '/');
```

Stripe lookup keys are therefore the external contract (`igbo_api_team`). The billing portal is created from an existing checkout session's customer. Webhook events handled (`controllers/stripe/webhooks.ts`) and the mutations applied:

| Stripe event | Effect on Developer |
| --- | --- |
| `customer.subscription.created` | `stripeId = customer`, `plan = metadata.plan`, `accountStatus = 'active'` |
| `customer.subscription.deleted` | `plan = 'starter'`, `accountStatus = status` |
| `customer.subscription.paused` | `accountStatus = status` |
| `customer.subscription.resumed` | `accountStatus = status` |
| `customer.subscription.updated` | `accountStatus = status` (plan **not** changed) |

Signature verification is mandatory (`validateStripeSignature` → `stripe.webhooks.constructEvent(req.body, signature, STRIPE_ENDPOINT_SECRET)`; returns 400 `'Stripe signature verification failed'` on failure).

**Critical gap for a reimplementation:** `plan` and `accountStatus` are recorded but **never consulted by `authorizeDeveloperUsage`**. The enforced limit is always `ApiUsageLimit[apiType]` (2500/20/5) regardless of tier; a `starter` account and a `team` account get identical quotas. Likewise there is no gate on the v2-only features despite the pricing table claiming them. Tier enforcement is the main thing that must be *built*, not ported.

---

## 6. SEARCH IMPLEMENTATION

### 6.1 Diacritics and tone-insensitive matching

Two cooperating pieces.

**(a) `src/shared/utils/removeAccents.ts`** — two modes, because Igbo underdots are *phonemic* (ị/ọ/ụ are distinct letters) while tone marks are not:

```ts
const accents = {
  // Remove all diacritic marks including underdots
  remove: (string = '') => string.normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
  // Remove all diacritic marks excluding underdots
  removeExcluding: (string = '') => string.normalize('NFD').replace(/(?!\u0323)[\u0300-\u036f]/g, ''),
};
```

`remove` folds ị→i (used to compare loosely, e.g. similarity scoring); `removeExcluding` keeps ị but drops the tone mark (used to build the search regex).

**(b) `src/shared/constants/diacriticCodes.ts`** — a per-letter map from a base letter to a character-class alternation. Every vowel gets a tone-tolerant class, plus dedicated classes for the underdot letters:

```ts
const ALL_DIACRITICS = '\u00B4\u0301\u0060\u00AF\u0304\u0323\u0300';
const caseInsensitiveA = `${'[aA\u0061\u00e0\u0101\u00c0\u00c1\u0100]'.normalize('NFC')}+[${ALL_DIACRITICS}]{0,}`;
const caseInsensitiveI = `${'[iI\u00ec\u00ed\u012b\u1ecb\u00cc\u00cd\u012a\u1eca]'.normalize('NFC')}+[${ALL_DIACRITICS}]{0,}`;
const caseInsensitiveỊ = `(([iI\u00ec\u00ed\u012b\u1ecb\u00cc\u00cd\u012a\u1eca]+[${ALL_DIACRITICS}]{0,})|[\u1ECB\u1ECA])+[${ALL_DIACRITICS}]{0,}`;
const caseInsensitiveN = `${'[n\u1e44\u01f9\u0144N\u1e45\u01f8\u0143'.normalize('NFD')}${'\u1e44\u01f9\u0144\u1e45\u01f8\u0143]'.normalize('NFC')}+[${ALL_DIACRITICS}]{0,}`;
// …m, e, o, ọ, u, ụ identically

export const cjkRange = '[\u4E00-\u9FFF]';       // used to detect nsibidi search terms

export default {
  n: caseInsensitiveN, N: caseInsensitiveN, m: caseInsensitiveM, M: caseInsensitiveM,
  a: caseInsensitiveA, A: caseInsensitiveA, e: caseInsensitiveE, E: caseInsensitiveE,
  i: caseInsensitiveI, I: caseInsensitiveI, ị: caseInsensitiveỊ, Ị: caseInsensitiveỊ,
  o: caseInsensitiveO, O: caseInsensitiveO, ọ: caseInsensitiveỌ, Ọ: caseInsensitiveỌ,
  u: caseInsensitiveU, U: caseInsensitiveU, ụ: caseInsensitiveỤ, Ụ: caseInsensitiveỤ,
  ' ': '[\\s\u0027]', '?': '\\?',
};
```

**(c) `src/shared/utils/createRegExp.ts`** — assembles four regexes from the map:

```ts
const front = '(?:^|[^a-zA-Z\u00c0-\u1ee5])';
const back  = '(?![a-zA-Z\u00c0-\u1ee5]+|,|s[a-zA-Z\u00c0-\u1ee5]+)';
const searchWord = removeAccents.removeExcluding(removeSpecialCharacters(rawSearchWord)).normalize('NFC');
const requirePluralAndGerundMatch = searchWord.endsWith('ing') && searchWord.replace('ing','').length <= 1 ? '' : '?';
const regexStringBase = [...searchWord.replace(/(?:es|[s]|ing)$/, '')];
const regexWordString = `${regexStringBase.reduce((re, letter, index) =>
  `${re}(${diacriticCodes[letter] || letter})${isLastLetterDuplicated ? '{0,}' : ''}`, '')}(?:es|[sx]|ing)${requirePluralAndGerundMatch}`;
```

Resulting `SearchRegExp { wordReg, exampleReg, definitionsReg, hardDefinitionsReg }`:

| Member | Pattern | Used by |
| --- | --- | --- |
| `wordReg` | `(\W|^)((?:^|[^a-zA-Z\u00c0-\u1ee5])<word>)(\W|$)` (`i`) — or, with `hardMatch=true`, `(\W|^)(^<front><word><back>$)(\W|$)` | `word`, `variations`, `dialects.word`, `tenses.*` |
| `exampleReg` | `(\W|^)(<word>)(\W|$)` | `examples.source.text` |
| `definitionsReg` | `(\W|^)(<word>)(\W|$)` | `definitions.definitions` ($in) |
| `hardDefinitionsReg` | built from the **un-trimmed** word (no plural/gerund suffix) | match-index ranking in `sortDocsBy` |

`removeSpecialCharacters` strips `[()!~@#$%&*=\+[\]{},<>?|\\_\/]` (note: not `'`, `"`, or `-`). `isLastLetterDuplicated` appends `{0,}` so a doubled final letter matches one-or-more (handles "ndi"/"ndii"-style spelling variance). `createQueryRegex.ts` wraps this with a `/./` fallback for an empty search word.

### 6.2 Route selection: English vs Igbo path

```ts
const isEnglish = isWord('american-english');        // the `is-word` package
const IGNORE_ENGLISH_WORDS = ['Ego','ego','La','la','Mu','mu','One','one','No','no','Nu','nu','Chi','chi','Ge','ge','We','we'];

const isSearchWordEnglish =
  isEnglish.check(searchWord) && Boolean(searchWord) && !IGNORE_ENGLISH_WORDS.includes(searchWord);

if (hasQuotes || isSearchWordEnglish) { … searchWordUsingEnglish(…) }
else                                  { … searchWordUsingIgbo(…) }
```

with `const hasQuotes = keywordQuery && keywordQuery.match(/["'].*["']/) !== null;`. So a **quoted** keyword is an explicit "English, please" signal, and 20 Igbo words that collide with English words are whitelisted out of the dictionary check.

### 6.3 Igbo-side search

```ts
const [igboResults, englishResults] = await Promise.all([
  findWordsWithMatch({ match: igboQuery,               version, queryLabel: 'igbo' }),
  findWordsWithMatch({ match: definitionsWithinIgboQuery, version, queryLabel: 'definitions' }),
]);
const words = searchWord
  ? uniqWith(igboResults.words.concat(englishResults.words),
             (a, b) => a.id.toString() === b.id.toString())
  : igboResults.words;
const contentLength = words.length;
responseData = await setCachedWords({ key: redisWordsCacheKey, data: { words, contentLength }, redisClient, version });
…
let sortedWords = sortDocsBy(searchWord, responseData.words, 'word', version, regex);
sortedWords = sortedWords.slice(skip, skip + limit);
return handleWordFlags({ data: { words: sortedWords, contentLength: responseData.contentLength }, flags });
```

Two aggregations run concurrently and are de-duplicated by `id` — the word is found whether the query matched the Igbo field or an English definition.

The queries (`src/controllers/utils/queries.ts`):

```ts
const fullTextSearchQuery = ({ keywords, isUsingMainKey, filters = {} }) => {
  const hasNsibidi = keywords.some(({ text }) => text.match(new RegExp(cjkRange)));
  return isUsingMainKey && !keywords?.length
    ? filters
    : !isUsingMainKey && !keywords?.length
      ? { _id: { $exists: false }, id: { $exists: false } }        // main-key-only: return nothing
      : hasNsibidi
        ? { $and: [{ $or: generateMultipleNsibidi(keywords) }, filters] }
        : {
            $and: [{
              $or: compact([
                ...generateMultipleWordRegex(keywords),       // { word: { $regex, $options:'i' } }
                generateMultipleVariationsRegex(keywords),    // { variations: { $in: [regex.source] } }
                generateMultipleDialectsWordRegex(keywords),  // { 'dialects.word': { $regex, $options:'i' } }
                ...generateMultipleTensesWordRegex(keywords), // one clause per Tenses value
              ]),
            }],
            ...filters,
          };
};
```

`filters` is built in `handleQueries` as `{ tags: {$in}, 'definitions.wordClass': {$in} }` (either/or).

`strict=true` replaces the whole thing with `strictSearchIgboQuery`, a comment-documented workaround:

```ts
/* Since the word field is not non-accented yet,
 * a strict regex search for words has to be used as a workaround */
export const strictSearchIgboQuery = (keywords) => ({ $or: keywords.map(({ regex }) => ({ word: { $regex: regex.wordReg } })) });
```

The two-aggregation join requires the **`word` + `variations` + `dialects.word` + 7 `tenses.*` + `definitions.nsibidi` + `definitions.wordClass`** indexes listed in §2.2.5 — a reimplementation should build the same set or the regex scans will be collection scans.

### 6.4 English-side (reverse-lookup) search

```ts
const definitionsQuery = ({ regex, searchWord = '', filters }) => ({
  $and: [
    filters,
    StopWords.includes(searchWord.toLowerCase()) ? {} : { $text: { $search: searchWord } },
    { 'definitions.definitions': { $in: [regex.definitionsReg] } },
  ],
});
```

Combining a `$text` index query with a regex `$in` on the same field: `$text` gives a fast candidate set, the regex confirms the tone-folded match. `StopWords` is the 178-entry MongoDB English stopword list (`src/shared/constants/StopWords.ts`, credited to `igorbrigadir/stopwords`); for those terms the `$text` clause is dropped entirely.

Sort key differs by version:

```ts
const sortKey = version === Version.VERSION_1 ? 'definitions[0]' : 'definitions[0].definitions[0]';
```

### 6.5 Fuzzy ranking — `sortDocsBy`

`src/controllers/utils/sortDocsBy.ts` is a hand-tuned scoring function using `string-similarity`'s Dice coefficient. Constants (all at the top of the file):

```ts
const MATCHING_DEFINITION_INDEX = 1000;
const MATCHING_DEFINITION_INDEX_FACTOR = 100;
const WORD_LENGTH_FACTOR = 100;
const WORD_LENGTH_DIFFERENCE_FACTOR = 15;
const IS_COMMON = 1000;
const IS_COMMON_THRESHOLD = -700;
const SIMILARITY_FACTOR = 100;
const EXACT_MATCH_FACTOR = 2000;
const SIMILAR_WORD_THRESHOLD = 1.5;
const NO_FACTOR = 0;
```

For each pair of documents it computes, for both a tone-stripped and an underdot-preserving normalization:

* `stringSimilarity.compareTwoStrings(normalizedSearchWord, cleanedValue)` — Dice similarity in `[0,1]`, computed **four** times per document (tone-stripped and `removeExcluding` variants of each doc value);
* an **exact-match bonus** of `EXACT_MATCH_FACTOR = 2000` when similarity === 1;
* a **word-length proximity bonus**: `WORD_LENGTH_FACTOR - |len(search) - len(doc)| * WORD_LENGTH_DIFFERENCE_FACTOR`, applied only when combined similarity ≥ `SIMILAR_WORD_THRESHOLD = 1.5`;
* a **definition-position bonus** from `hardDefinitionsReg` found via `String.prototype.search` on `definitions[0]…`: `MATCHING_DEFINITION_INDEX - index * MATCHING_DEFINITION_INDEX_FACTOR`, with `index = 11` when not found;
* a **commonness bonus**: `+1000` when the partial score is ≤ `IS_COMMON_THRESHOLD (-700)` and `attributes.isCommon` is true.

Final score:

```ts
const finalPrevDocDiff = prevDocSimilarityFactor + prevDocIsCommonFactor + prevDefinitionMatchIndexFactor;
if (finalPrevDocDiff === finalNextDocDiff) return NO_FACTOR;
return finalPrevDocDiff > finalNextDocDiff ? -1 : 1;
```

The `isCommon` bonus only fires for otherwise-poor matches, which is the mechanism that makes a genuinely common word surface ahead of a long obscure compound. This is the single most valuable algorithm to port for a different language — but note it depends on Igbo-specific normalizers (`removePrefix` for the leading `-` on verb stems, `removeAccents.remove` vs `.removeExcluding`, `normalize('NFC')`).

### 6.6 The JSON dictionary artifacts and `buildDictionaries.ts`

`src/dictionaries/ig-en/`:

| File | Size | Shape | Role |
| --- | --- | --- | --- |
| `ig-en.json` | 1.5 MB | `{ "<headword>": [ { word, wordClass, definitions[], examples[], variations[], stems } ] }`, compact JSON | seed source (`src/dictionaries/seed.ts` imports it) |
| `ig-en_expanded.json` | 3.1 MB | same, pretty-printed 4-space | full dictionary; imported by `buildDictionaries.ts` and by `src/services/words.ts` |
| `ig-en_normalized_expanded.json` | 6.1 MB | same, diacritic-normalized keys | imported by `buildDictionaries.ts` |
| `ig-en_1000_common.json` | 158 KB | same, 1000 most common | imported by `buildDictionaries.ts` |

`src/dictionaries/en-ig/`: `en-ig_normalized_expanded.json` (6.7 MB) — a flat `{ "<english-word>": "<igbo-string>" }` map (e.g. `"aback": "nwee obi"`).

`src/dictionaries/buildDictionaries.ts` (complete file semantics):

```ts
import commonDictionary     from './ig-en/ig-en_1000_common.json';
import normalizedDictionary from './ig-en/ig-en_normalized_expanded.json';
import dictionary           from './ig-en/ig-en_expanded.json';

const updateJSONDictionary = () => {
  if (!fs.existsSync(DICTIONARIES_DIR)) shell.mkdir('-p', DICTIONARIES_DIR);
  if (process.env.NODE_ENV !== 'test' && !fs.existsSync(BUILD_DICTIONARIES_DIR)) shell.mkdir('-p', BUILD_DICTIONARIES_DIR);

  const dictionaryFilePaths = [
    [`${DICTIONARIES_DIR}/ig-en_1000_common.json`,          JSON.stringify(commonDictionary,     null, 4)],
    [`${DICTIONARIES_DIR}/ig-en_expanded.json`,              JSON.stringify(dictionary,           null, 4)],
    [`${DICTIONARIES_DIR}/ig-en_normalized_expanded.json`,   JSON.stringify(normalizedDictionary, null, 4)],
    [`${DICTIONARIES_DIR}/ig-en.json`,                       JSON.stringify(dictionary)],   // compact
  ];
  const buildDictionaryFilePaths = process.env.NODE_ENV === 'build'
    ? [ /* the same four files, written into BUILD_DICTIONARIES_DIR */ ]
    : [];
  flatten([dictionaryFilePaths, buildDictionaryFilePaths]).forEach((config) => { fs.writeFileSync(...config, () => {…}); });
};
updateJSONDictionary();
```

Locations (`src/shared/constants/parseFileLocations.ts`):

```ts
const mainPath = `${__dirname}/../..`;
export const READ_FILE_FORMAT = 'utf8';
export const DICTIONARIES_DIR =
  process.env.NODE_ENV === 'test'
    ? `${mainPath}/../__tests__/__mocks__/dictionaries`
    : `${mainPath}/dictionaries/ig-en`;
export const BUILD_DICTIONARIES_DIR = `${mainPath}/../dist/dictionaries/ig-en`;
```

So the build **regenerates the source JSON files in place** (guarded to the mocks dir under test) and, only when `NODE_ENV=build`, also emits `dist/dictionaries/ig-en/*`. The `prebuild:dictionaries` npm script creates the directories and copies `src/dictionaries/ig-en` **and** `src/dictionaries/en-ig` into `./build/dictionaries`; `build:functions` then ships `build/src/dictionaries/ig-en` as `functions/dictionaries`.

**Two honest caveats for a reimplementer:**

1. The `en-ig` file is generated/copied but **never imported by runtime code** — a repo-wide grep finds `en-ig` only in `package.json` build scripts. English→Igbo reverse lookup at runtime is served instead by §6.4 (a `$text` + regex query over `definitions.definitions`), and the *wordlist-style* reverse lookup only exists on the `testRouter` JSON path.
2. The `diacriticless` package is a declared dependency with `@types/diacriticless.d.ts`, but it is used **only in a test** (`__tests__/api-mongo.test.ts:466,468`); production code uses the in-repo `removeAccents`. `string-similarity` is used in exactly one production file (`sortDocsBy.ts`).

### 6.7 Serving the dictionary JSON at runtime

Three serving mechanisms:

1. **`GET /api/v1/test/words`** (non-production only) → `getWordData` → `removePrefix(keyword)` + `createRegExp` + `findSearchWord(regexWord, searchWord)` → `services/words.ts`:

```ts
export const resultsFromDictionarySearch = (regexWord, word, dictionary) =>
  keys(dictionary).reduce((matchedResults, key) => {
    const termInformation = dictionary[key];
    const trimmedKey = removePrefix(key);
    const isTrimmedKeyAndWordSameLength = trimmedKey.match(regexWord);
    if (isTrimmedKeyAndWordSameLength || doesVariationMatch(termInformation, regexWord)) {
      matchedResults[key] = termInformation;
    }
    return matchedResults;
  }, {});
export const findSearchWord = (regexWord, word) => resultsFromDictionarySearch(regexWord, word, databaseDictionary);
```

It returns the raw dictionary object (no pagination, no versioning, no `Content-Range`) and throws `NO_PROVIDED_TERM` (400) when no keyword is given.

2. **`/services`** — `app.use('/services', cache(), express.static('./services'))`. The `./services` directory does not exist in the repo, so this is a deployment-time static mount for prebuilt JSON.

3. **`/assets`** and **`/fonts`** — `express.static('./dist/assets')` and `./dist/fonts`, populated by `build:assets` / `build:fonts`.

MongoDB is the authoritative searchable copy; the JSON dictionaries are the seeding + fallback source.

### 6.8 Seeding (`src/dictionaries/seed.ts`)

`POST /api/v1/test/populate` (non-production) → `seedDatabase` → `connection.dropDatabase()`, then for each dictionary key it creates words, nsibidi characters, and examples:

```ts
const word = {
  word: key,
  definitions: [{ wordClass: term.wordClass || WordClass.NNC.value, definitions: term.definitions,
                  igboDefinitions: [], nsibidi: '', nsibidiCharacters: [] }],
  dialects: [{ id: '', dialects: [Dialects.NSA.value], variations: [], pronunciation: '',
               word: `${key.replace(/\./g, '')}-dialect` }],
  tags: [],
  attributes: { isAccented: false, isBorrowedTerm: false, isCommon: false, isComplete: false,
                isConstructedTerm: false, isSlang: false, isStandardIgbo: false, isStem: false },
  conceptualWord: '', frequency: 0, hypernyms: [], hyponyms: [], pronunciation: '',
  relatedTerms: [], stems: [], id: '', updatedAt: new Date(), variations: term.variations, wordPronunciation: '',
};
```

nsibidi characters come from `nsibidiDictionary` (`{sym, pro, form, defs}` → `{ nsibidi, definitions:[{text: defs}], pronunciation: pro, wordClass: <matching nsibidiValue> || WordClass.ADJ.nsibidiValue, radicals: [] }`), and examples get `style: index % 3 ? ExampleStyleEnum.PROVERB : ExampleStyleEnum.NO_STYLE` and `origin: SuggestionSourceEnum.INTERNAL`. It then sleeps `WRITE_DB_DELAY = 15000` ms to let writes flush, and if `CONTAINER_HOST === 'mongodb'` it redirects and `process.exit(0)`s so the container restarts with fresh text indexes.

`src/dictionaries/nsibidi/nsibidi_dictionary.ts` is 31,504 lines / 5,250 `sym:` entries — a `{ sym, pro, form, defs }[]` array of nsibidi glyphs where `form` is a `WordClass.nsibidiValue` CJK string.

---

## 7. FRONTEND FEATURE INVENTORY

### 7.1 Scope correction (read this before building)

This repo's frontend is **`igboapi.com`**: a marketing/landing site, an interactive API demo, a signup/login flow, a developer dashboard, legal pages, and a `/docs` redirect. The **dictionary UI with word-of-the-day, tenses display, flashcards, games, leaderboards, and crowdsourced suggestions is nkowaokwu.com, a different codebase.** Proof:

* `DICTIONARY_APP_URL = 'https://nkowaokwu.com'`, `NKOWAOKWU_CHROME = 'https://nkowaokwu.com/chrome'`, `VOLUNTEER_PAGE_URL = 'https://nkowaokwu.com/volunteer'` (`src/siteConstants.ts`).
* The landing page renders `CallToAction / Demo / MentionedIn / UseCases / Products / Donate / LastCall` — no dictionary (`src/pages/App.tsx`).
* `Products.tsx` is literally `const Products = () => null;` — the dictionary product card was removed from igboapi.com.
* `cypress/e2e/client.cy.js` asserts navigation *away* to `https://nkowaokwu.com/home`.
* No `leaderboard`, `wordOfTheDay`, `flashcard`, or `game` symbol exists anywhere in `src/` (verified by grep; matches are only nsibidi dictionary glosses for "game").
* `migrations/20241206235108-remove-crowdsourcing.js` *unsets* `crowdsourcing` from `wordsuggestions` and `examplesuggestions` — crowdsourcing was removed from the data model.

What *does* remain here as evidence of the crowdsourced pipeline (useful for schema design, since the shared enums are duplicated): `SuggestionSourceEnum` (`internal` / `community` / `igbo_speech` / `igbo_wikimedians` / `bbc`), `Pronunciation` with `approvals`/`denials`/`review`/`speaker`, `StatTypes.USER`, `StatTypes.NSIBIDI_WORD_SUGGESTIONS`, and the 49 migrations that touch `wordsuggestions` / `examplesuggestions` / `genericwords`. Live collections implied by migrations include `corpus`, `corpussuggestions`, `examples`, `examplesuggestions`, `exampletranscriptionfeedbacks`, `nsibidicharacters`, `projects`, `stats`, `textimages`, `words`, `wordsuggestions`, `genericwords`, `paywalls`, `changelog`.

### 7.2 Feature inventory of what is actually implemented here

| Feature | Page path | File | Components involved |
| --- | --- | --- | --- |
| Landing / hero | `/` | `src/pages/index.page.tsx` → `src/pages/App.tsx` | `Navbar`, `CallToAction`, `Demo`, `MentionedIn`, `UseCases`, `Products` (null), `Donate`, `LastCall`, `Footer` |
| Navbar (desktop dropdown + mobile menu) | all pages | `components/Navbar/Navbar.tsx` | `NavigationMenu` (mobile, `data-test="drop-down-button"`), `NavigationOptions` (desktop, `data-test="sub-menu"`), driven by `src/shared/constants/navigationLinks.ts` (`Resources` dropdown → Hugging Face / Kaggle / GitHub; `/docs`; `/about`) |
| Speech-to-text demo | `/` (tab) | `components/Demo/Demo.tsx` → `IgboSpeech/index.tsx` | `ResultText`, `ConvertToTextButton`, `AudioPlayer` (`AudioPlayerBase`, `RecordButton`, `UploadButton`), `AudioOptions` (`AudioOption`), `DragState`; state via Jotai atoms `predictionTextAtom`, `mediaBlobUrlAtom`, `audioDataAtom`, `selectedDefaultAudioAtom`, `feedbackAtom`, `isFeedbackSubmittedAtom`, `humanTranscriptionAtom`, `predictionLoadingAtom` |
| Dictionary demo (try-it-out) | `/` (tab) | `components/Demo/components/IgboAPI.tsx` | `JSONPretty` response viewer, `Input`, `Checkbox` for `dialects` / `examples` flags (`data-test="dialects-flag"`, `"examples-flag"`, `"try-it-out-input"`); reads initial `?word=` / `?dialects=` / `?examples=` from the URL via `query-string` |
| Translation demo (Igbo → English) | `/` (tab) | `components/Demo/components/Translate.tsx` | side-by-side `Textarea`/`Text`, spinner, calls `postTranslationEndpoint` |
| "Start building" CTA | `/` | `components/Demo/components/StartBuilding.tsx` | "Try for Free" → `/signup`, "Watch a Demo" |
| Featured-in / press | `/` | `components/MentionedIn/MentionedIn.tsx` | Nasdaq, Nigerian Tribune, Umu Igbo Unite, Built in Africa, Nuesroom, WeDeyCode, Techpoint logos |
| Use cases | `/` | `components/UseCases/UseCases.tsx` | `UseCaseCard` × 3 (subtitles, conversation transcription, language-learning) from `src/pages/shared/useCases.ts` |
| Donate | `/` and `/about` | `components/Donate/Donate.tsx` | $15 tier → `DONATE_URL` (`https://donate.stripe.com/dR62aP6UlcmE3kIfYY`) |
| Final CTA | `/` | `components/LastCall/LastCall.tsx` | Sign Up / Watch a Demo → `/signup` |
| Footer | all pages | `components/Footer/Footer.tsx` | 3 link groups (Company: Igbo API / Nkọwa okwu / Chrome Extension; Resources: Documentation / Hugging Face / Kaggle / GitHub; Legal: Terms / Privacy) + 6 social icons |
| Sign in / sign up | `/signup` | `signup/index.page.tsx` + `signup/login.tsx` | Google and GitHub `signInWithPopup`; on success `PUT /api/v1/developers` then redirect to `/dashboard` |
| Developer dashboard home (usage) | `/dashboard` | `dashboard/index.page.tsx` → `dashboard.tsx` | `DashboardLayout` + Chakra `Stat`; hardcoded "Daily limit: 500" |
| API key view/copy | `/dashboard/credentials` | `credentials.page.tsx` | masked `Input`, eye toggle, clipboard copy with 3s "Copied" tooltip |
| Profile | `/dashboard/profile` | `profile.page.tsx` | avatar, name, email (Stripe badge commented out) |
| Plans / upgrade | `/dashboard/plans` | `plans.page.tsx` | form POST to `/stripe/checkout` with `lookupKey=igbo_api_team`; upgrade button commented out |
| Dashboard chrome | all `/dashboard/*` | `layout.tsx` | `DashboardMenu` (logo + avatar menu → Log out), `DashboardNavigationMenu` (Home / Credentials / Profile / Plans with a hover slider), `AuthManager` (redirect to `/signup` when signed out), `Error` |
| Pricing page | `/pricing` | `pricing/_index.page.tsx` | `PricingCard` × 2 (Starter $0, Team $10) from `pricing/types.ts`; **not linked** from the navbar (`// TODO: uncomment when pricing is available` in `navigationLinks.ts`) |
| About | `/about` | `about/index.page.tsx` | mission copy + FAQ (4 Q&As: available features, training data, how to use, how to contribute), contact CTA |
| Privacy policy | `/privacy` | `privacy/index.page.tsx` (546 lines) | legal text |
| Terms of service | `/terms` | `terms/index.page.tsx` (482 lines) | legal text |
| 404 | any unmatched | `404/index.page.tsx` | "Something went wrong" + back to homepage |
| Docs | `/docs` | `src/routers/siteRouter.ts` | `302` → `API_DOCS = 'https://docs.igboapi.com'` (docs live in a separate repo, `nkowaokwu/igbo_api_docs`) |
| Statistics widgets | **not mounted on any live route** | `components/Statistics/Statistics.tsx`, `Stat.tsx`, `components/GitHubStars/GitHubStars.tsx` | present and unit-tested; `getServerSideProps` in `index.page.tsx` returns `databaseStats: {}` and the GitHub fetchers are commented out |

**Definitionally absent from this repo** (so nothing to port, but the schema supports them): word-of-the-day, word detail page with audio playback, tenses display, related-terms navigation, dialect tabs, flashcards/games, leaderboard/community, crowdsourced word suggestions & edits, user accounts for learners. Those live in nkowaokwu.com and the Igbo API Editor Platform, consuming this API's `/api/v2/words?examples=true&dialects=true&resolve=true`, `/api/v2/nsibidi`, and using `SuggestionSourceEnum` + `Pronunciation.approvals/denials` for the review workflow.

### 7.3 Frontend architecture conventions

* **Next.js** 13.4.5 pages router (`pageExtensions: ['page.tsx']`), `distDir: 'dist'`, `getServerSideProps` used only on `index.page.tsx` (and it returns empty props — the page is effectively static).
* **Chakra UI** 2.8 for components + theme in `src/shared/constants/ChakraTheme.ts` (`extendTheme({ components: { Heading, Link, Menu } })`, Inter via `next/font/google`, no custom Igbo font in the theme) and **Tailwind 3** for utility classes on the same elements. The Igbo font `Akagu2020.ttf` is shipped at `src/public/fonts/Akagu2020.ttf` and copied to `dist/fonts` but is not referenced from `ChakraTheme`.
* **Jotai** for client state (`src/pages/atoms/*`), **react-hook-form** (available, used sparingly), **react-firebase-hooks** for auth state, **axios** for HTTP, **query-string** for URL state, **react-json-pretty** for the raw-response viewer, **framer-motion** for transitions, **react-icons** + FontAwesome.
* **i18n**: `next-i18next` 10 + `i18next`/`react-i18next`, locales `['en', 'ig']`, `defaultLocale: 'en'`, namespaces `about`/`common`/`signup` in `src/public/locales/{en,ig}/`. Initialized manually in `_app.page.tsx` (`lng: 'en'`, `fallbackLng: 'en'`, `defaultNS: 'common'`) *in addition to* `appWithTranslation`. All strings in the repo are English/`ig`-translated marketing and signup copy only — there is no word-level UI translation.
* **Analytics**: GA4 via `next/script` in `_app.page.tsx` with `GA_TRACKING_ID = process.env.NEXT_PUBLIC_GA_ID`, `gtag.pageview` on `routeChangeComplete`, plus server-side GA4 Measurement Protocol events in `src/middleware/analytics.ts`.
* **SEO**: `<Head>` in `_app.page.tsx`/`_document.page.tsx` with `"Igbo API - The First African Language API"` title, OG/Twitter cards, favicons and images hosted on `https://nkowaokwu.s3.us-west-1.amazonaws.com/assets/…` (`src/pages/utils/getAWSAsset.ts`).

---

## 8. AUDIO / PRONUNCIATION

### 8.1 Where pronunciation data lives

| Location | Field | Meaning |
| --- | --- | --- |
| `words.pronunciation` | String, default `''` | legacy/headword audio URL |
| `words.wordPronunciation` | String, default `''`, trim | pronunciation of the headword (distinct from the above) |
| `words.dialects[].pronunciation` | String, default `''` | audio for that dialectal form |
| `examples.source.pronunciations[]` | `[{audio, speaker}]` | recordings of the Igbo sentence |
| `examples.translations[].pronunciations[]` | `[{audio, speaker}]` | recordings of the translation |
| `NsibidiCharacter.pronunciation` | String | pronunciation of the glyph |

TS `Pronunciation` (`src/types/example.ts`) is richer than the schema — `{ _id, approvals: string[], audio: string, denials: string[], review: boolean, speaker: string }` — i.e. the crowdsourced review model (`approvals`/`denials`/`review`) is part of the type contract even though the API only reads `audio`.

`StatTypes.HEADWORD_AUDIO_PRONUNCIATIONS = 'headword_audio_pronunciations'` is the `Stat` row tracking how many words have audio, surfaced as `totalAudioPronunciations` by `getStats`.

Migrations tracing this area: `20220208140327-example-pronunciations.js`, `20230522011130-pronunciation-to-pronunciations.js`, `20240913215339-move-example-pronunciations-to-translations.js`, `20241116014146-add-bit-rate-audio-pronunciation.js` (the last one corresponds to `MicRecorder({ bitRate: 30000 })`).

### 8.2 Storage and serving

* Origin: **AWS S3**, bucket `igbo-api`, region `us-east-2`, prefix `audio-pronunciations/`, key pattern `<id>.mp3`:

```ts
// src/controllers/utils/parseAWS.ts
const AWS_AUDIO_PRONUNCIATIONS_DELIMITER = '/audio-pronunciations/';
export const parseAWSIdFromKey = (awsId: string) => awsId.split('.')[0].split('/')[1];
export const parseAWSIdFromUri = (awsUri: string) =>
  awsUri.split(AWS_AUDIO_PRONUNCIATIONS_DELIMITER)[1].split('.')[0];
```

Full URL shape: `https://igbo-api.s3.us-east-2.amazonaws.com/audio-pronunciations/<audioId>.mp3`. Static assets (logos, images, banners) live in a *different* bucket: `https://nkowaokwu.s3.us-west-1.amazonaws.com/assets` (`src/pages/utils/getAWSAsset.ts`).

* The API stores **only the URL string**. It never streams, proxies, transcodes, or uploads audio — there is no S3 client, no `multer`, and no upload route in this repo. Upload is the editor platform's job.
* The `AWS_*` env vars set by `deploy.yml` (`AWS_BUCKET`, `AWS_ACCESS_KEY`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`) are **not read by `src/config.ts`** — they are leftovers from when uploads lived here.
* Serving to clients: verbatim URLs in JSON, so the browser hits S3 directly; the `DefaultAudios` constant shows the exact shape:

```ts
export const DEFAULT_AUDIOS = [
  { title: 'Speaker 1', audioUrl: 'https://igbo-api.s3.us-east-2.amazonaws.com/audio-pronunciations/600dd825179a9f9eb0195651.mp3', audioId: '600dd825179a9f9eb0195651' },
  { title: 'Speaker 2', audioUrl: '…/664d4b0fc7fc8b5c9acdfe69.mp3', audioId: '664d4b0fc7fc8b5c9acdfe69' },
  { title: 'Speaker 3', audioUrl: '…/6643f3230363cedbf228b7fb.mp3', audioId: '6643f3230363cedbf228b7fb' },
];
```

`speechToText.ts` hardcodes the bucket check as a fast path: `if (!audio.includes('igbo-api.s3.us-east-2')) { /* upload to IgboSpeech first */ }`.

### 8.3 Browser recording (`mic-recorder-to-mp3`)

`src/pages/hooks/useRecorder.ts` (138 lines) is the whole client-side recorder:

```ts
import MicRecorder from 'mic-recorder-to-mp3';
const MAX_AUDIO_SIZE = 5000000;

const useRecorder = (): [string, boolean, () => void, () => void, number] => {
  const [audioBlob, setAudioBlob] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isBlocked, setIsBlocked] = useState(true);
  const [recorder, setRecorder] = useState(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const durationRef = useRef<NodeJS.Timer>();
  …
  useEffect(() => {
    window.navigator.mediaDevices.getUserMedia({ audio: true })
      .then(() => setIsBlocked(false)).catch(() => setIsBlocked(true));
  }, []);

  useEffect(() => {
    if (!isBlocked) { setRecorder(new MicRecorder({ bitRate: 30000 })); /* re-request getUserMedia */ }
  }, [isBlocked]);
```

* Permission is probed on mount; denial flips `isBlocked`, shows a Chakra toast (`title: 'Microphone access denied'`, `status: 'error'`, `duration: 30000`), and disables recording.
* `startRecording` → `recorder.start()` + a `setInterval(..., 1000)` ticker incrementing `recordingDuration` (returned as the 5th tuple element so the UI can show elapsed time).
* `stopRecording` → `recorder.stop().getMp3()` → `[buffer, blob]` → `new File(buffer, 'me-at-thevoice.mp3', { type: blob.type, lastModified: Date.now() })` → `FileReader.readAsDataURL` → validation → `setAudioBlob(reader.result)`.

Validation is inline and worth porting as-is:

```ts
if (typeof e.target.result !== 'string' || !e.target.result.includes('data:audio/mp3')) {
  return toast({ title: 'Unable to record', description: 'Invalid file type. Must be .mp3', status: 'warning', duration: 9000 });
}
if (e.target.result?.length > MAX_AUDIO_SIZE) {
  return toast({ title: 'Unable to record', description: 'Audio is too large - 500Kb maximum. Shorten your recording.', status: 'warning', duration: 9000 });
}
if (reader.result !== 'data:audio/mp3;base64,') { return setAudioBlob(reader.result as string); }
```

(Two inconsistencies to fix in a reimplementation: `MAX_AUDIO_SIZE = 5000000` bytes but the toast says "500Kb maximum"; and the size is measured on the **base64** string, i.e. ~4/3 of the raw byte length.)

Accepted MIME types (`ValidAudioType.ts`): `audio/wav`, `audio/mp3`, `audio/mpeg`. `UploadButton` and `DragState` are wired to accept/drop files (both currently comment out the actual upload: `// const fileUrl = URL.createObjectURL(file);` / `// Use fileUrl to upload to Igbo API`).

### 8.4 Audio → base64 → transcription pipeline

`ConvertToTextButton.tsx` handles the three input sources (recorded blob, uploaded file, one of the three `DEFAULT_AUDIOS`):

```ts
const convertToBase64 = async () => {
  const res = await blobUrlToBase64({ url: mediaBlobUrl });   // fetch(url) -> blob -> FileReader data URL
  return { base64: res, audioUrl: mediaBlobUrl };
};
const handlePredictText = async () => {
  let res;
  if (selectedDefaultAudio) res = { base64: '', audioUrl: selectedDefaultAudio.audioUrl };
  else { res = await convertToBase64(); if (!res) return; }
  await predictText(res);
};
const { transcription } = await postSpeechToTextEndpoint({ base64: convertedAudio.base64 || convertedAudio.audioUrl });
```

Then the transport is a **Firebase callable**, not a REST call: `useCallable('demo', { type: DemoOption.SPEECH_TO_TEXT, data: { base64 } })` → `src/functions.ts#onDemo`.

Server side, `src/functions.ts` re-enters the API over HTTP with the master key:

```ts
url: `${API_ROUTE}/api/v2/speech-to-text`,
headers: { 'Content-Type': 'application/json', 'X-API-Key': MAIN_KEY },
data: { audioUrl: base64 },
```

`getTranscription` then:

1. requires `audioUrl` to start with `https://` **or** `data:audio`, else `'Audio URL must either be hosted publicly or a valid base64.'`;
2. `fetchBase64Data(url)` = `fetch(url)` → `arrayBuffer()` → `btoa(String.fromCharCode(...new Uint8Array(data)))` when a URL was given;
3. if the audio is not already in the Igbo API S3 bucket, `POST ${SPEECH_TO_TEXT_API}/audio` with `X-API-Key: MAIN_KEY` and `{ base64 }` → `{ audioId, audioUrl }` (`Endpoint.AUDIO = 'audio'`); otherwise reuse the URL as-is;
4. `POST ${SPEECH_TO_TEXT_API}/predict` with `{ url, id }` → `{ transcription }` (`Endpoint.PREDICT = 'predict'`);
5. respond `{ transcription }`.

`SPEECH_TO_TEXT_API` is `ENV_SPEECH_TO_TEXT_API` in production, else `'http://localhost:3333'`. Note the deliberate third-party upload: audio not already in the bucket is persisted by the model service and returned as a public URL — a privacy/retention decision to reconsider.

`src/controllers/translation.ts` is the sibling for text: `SUPPORTED_TRANSLATIONS` currently allows only `ibo → eng` (`maxInputLength: 120`, `IGBO_TO_ENGLISH_API`) and `eng → ibo` (`maxInputLength: 150`, `ENGLISH_TO_IGBO_API`), rejects same-language pairs (`'Source and destination languages must be different'`) and empty strings (`'Cannot translate empty string'`), and forwards `{ [PayloadKeyMap[source]]: text }` with `X-API-Key: MAIN_KEY`, responding `{ translation }`. Validation uses **zod** + `zod-validation-error` rather than Joi.

---

## 9. CONFIG, ENV, AND DEPLOYMENT

### 9.1 `src/config.ts` — the single config module

Firebase Functions v2 params (declared with `defineString` / `defineBoolean` / `defineInt`, then `.value()`):

| Param | Type | Consumer |
| --- | --- | --- |
| `RUNTIME_ENV` | String | `isBuild` / `isProduction` / `isDevelopment` / `isTest` |
| `ENV_REPLICA_SET` | Boolean | `useReplicaSet` → Mongo URI + `?replicaSet=rs0` |
| `ENV_MONGO_URI` | String | production `MONGO_URI` |
| `ENV_FIREBASE_CONFIG` | String | `FIREBASE_CONFIG` (server-side web SDK config) |
| `ENV_FIREBASE_SERVICE_ACCOUNT` | String | `FIREBASE_SERVICE_ACCOUNT` |
| `ENV_CLIENT_TEST` | Boolean | `CLIENT_TEST` — blocks the `developer@example.com` test account in prod-like runs |
| `SENDGRID_API_KEY` | String | `SENDGRID_API_KEY` |
| `SENDGRID_NEW_DEVELOPER_ACCOUNT_TEMPLATE` | String | `SENDGRID_NEW_DEVELOPER_ACCOUNT_TEMPLATE` |
| `ENV_MAIN_KEY` | String | `MAIN_KEY` (default `'main_key'`) |
| `ENV_SPEECH_TO_TEXT_API` | String | `SPEECH_TO_TEXT_API` (prod only; else `http://localhost:3333`) |
| `ENV_IGBO_STT_URL` | String | `IGBO_STT_API` |
| `ENV_IGBO_TO_ENGLISH_URL` | String | `IGBO_TO_ENGLISH_API` |
| `ENV_ENGLISH_TO_IGBO_URL` | String | `ENGLIGH_TO_IGBO_API` (typo in the export name) |
| `ANALYTICS_GA_TRACKING_ID` | String | `GA_TRACKING_ID` |
| `ANALYTICS_GA_API_SECRET` | String | `GA_API_SECRET` |
| `ENV_REDIS_PORT` | Int | `REDIS_PORT` |
| `ENV_REDIS_URL` | String | `REDIS_URL` |
| `ENV_REDIS_HOST` | String | `REDIS_HOST` |
| `ENV_REDIS_USERNAME` | String | `REDIS_USERNAME` |
| `ENV_REDIS_PASSWORD` | String | `REDIS_PASSWORD` |
| `GITHUB_STATS_TOKEN` | String | `GITHUB_STATS_TOKEN` |
| `STRIPE_SECRET_KEY` | String | `STRIPE_SECRET_KEY` (falls back to a **hardcoded test key** `sk_test_hpwuITjteocLizB8Afq7H3cV00FEEViC1s`) |
| `STRIPE_ENDPOINT_SECRET` | String | `STRIPE_ENDPOINT_SECRET` (falls back to `'local_endpoint'`) |

Plain `process.env` reads outside `config.ts`:

| Var | Where | Purpose |
| --- | --- | --- |
| `NODE_ENV` | 18 sites | `build` \| `development` \| `production` \| `test`; gates morgan/logger, the `/test` router, seeding, dictionary output dir, SendGrid init, the build smoke test |
| `PORT` | `config.ts`, `server.ts`, Dockerfile | HTTP port, default `8080` |
| `CONTAINER_HOST` | `config.ts` (×3) | Mongo host inside Docker (`mongodb`); forces the *test* DB outside dev/prod; triggers container restart after seeding |
| `FIREBASE_FUNCTIONS` | `attachRedisClient.ts` | when set together with `REDIS_URL`, connects Redis to `redis://localhost:6379` |
| `NEXT_PUBLIC_GA_ID` | `src/lib/gtag.js`, `build:site` | client-side GA4 measurement id, injected at build time from `$GA_TRACKING_ID` |
| `MONGO_URI`, `DB_NAME` | `migrate-mongo-config.js` | migration connection (`mongodb://0.0.0.0:27017`, database `igbo_api`) |

Declared but unused / stale: `PROD_LIMIT = 500` (exported, never imported), `FIREBASE_CONFIG`, `FIREBASE_SERVICE_ACCOUNT`, `CLIENT_TEST` (only a test-email guard), `IGBO_STT_API`, `GITHUB_STATS_TOKEN`, `READ_FILE_FORMAT`, `Endpoint.TEXT_TO_SPEECH` (commented out), `Query.apiLimit`, `AuthType`/`status` legacy names.

`deploy.yml` writes a `functions/.env` whose keys **do not all match** `config.ts`: it sets `ENV_VPC_CONNECTOR`, `ENV_REDIS_STATUS`, `AWS_BUCKET`, `AWS_ACCESS_KEY`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (none read by `config.ts`), plus the ones that do match (`ENV_MONGO_URI`, `ENV_REDIS_*`, `ENV_MAIN_KEY`, `ENV_REPLICA_SET`, `ENV_FIREBASE_*`, `ENV_CLIENT_TEST`, `ANALYTICS_GA_*`, `SENDGRID_*`, `GITHUB_STATS_TOKEN`, `RUNTIME_ENV`, `STRIPE_*`, `ENV_SPEECH_TO_TEXT_API`, `ENV_IGBO_STT_URL`, `ENV_IGBO_TO_ENGLISH_URL`, `ENV_ENGLISH_TO_IGBO_URL`). A reimplementation should generate a single typed env schema shared by both.

### 9.2 Derived config constants

```ts
export const PORT = process.env.PORT || 8080;
export const PROD_LIMIT = 500;                     // unused
export const MONGO_HOST = process.env.CONTAINER_HOST || '127.0.0.1';
export const REPLICA_SET_NAME = 'rs0';
export const FIRST_REPLICA_SET_PORT = '2717';
export const SECOND_REPLICA_SET_PORT = '2727';
export const THIRD_REPLICA_SET_PORT = '2737';
export const FALLBACK_MONGO_PORT = '27017';
export const REPLICA_SET_MONGO_ROOT = `mongodb://${MONGO_HOST}:2717,${MONGO_HOST}:2727,${MONGO_HOST}:2737`;
export const FALLBACK_MONGO_ROOT  = `mongodb://${MONGO_HOST}:27017`;
export const MONGO_ROOT = useReplicaSet ? REPLICA_SET_MONGO_ROOT : FALLBACK_MONGO_ROOT;
export const QUERIES    = useReplicaSet ? `?replicaSet=${REPLICA_SET_NAME}` : '';

const DB_NAME = 'igbo_api';
const TEST_DB_NAME = 'test_igbo_api';
const isTestingEnvironment = isTest || (process.env.CONTAINER_HOST === 'mongodb' && !isDevelopment && !isProduction);

export const MONGO_URI = isTestingEnvironment
  ? `${MONGO_ROOT}/${TEST_DB_NAME}`.concat(QUERIES)
  : isDevelopment
    ? `${MONGO_ROOT}/${DB_NAME}`.concat(QUERIES)
    : ENV_MONGO_URI || `${MONGO_ROOT}/${DB_NAME}`.concat(QUERIES);

export const CORS_CONFIG = { origin: true, exposedHeaders: ['Content-Range', 'X-Content-Range'] };
export const API_ROUTE = isProduction ? 'https://igboapi.com' : 'http://localhost:8080';
export const API_DOCS  = 'https://docs.igboapi.com';
export const SPEECH_TO_TEXT_API = isProduction ? ENV_SPEECH_TO_TEXT_API : 'http://localhost:3333';
export const SENDGRID_API_KEY = SENDGRID_API_KEY_SOURCE || '';
export const API_FROM_EMAIL = 'kedu@nkowaokwu.com';
export const MAIN_KEY = ENV_MAIN_KEY || 'main_key';
export const GA_URL = 'https://www.google-analytics.com/mp/collect';
export const DEBUG_GA_URL = 'https://www.google-analytics.com/debug/mp/collect';
export const REDIS_CACHE_EXPIRATION = 604800;   // Busts the cache every 7 days
export const STRIPE_SECRET_KEY = STRIPE_SECRET_KEY_SOURCE || 'sk_test_hpwuITjteocLizB8Afq7H3cV00FEEViC1s';
export const STRIPE_ENDPOINT_SECRET = STRIPE_ENDPOINT_SECRET_SOURCE || 'local_endpoint';
```

`dotenv` is loaded conditionally and only outside build: `const dotenv = process.env.NODE_ENV !== Environment.BUILD ? require('dotenv') : null; if (dotenv) dotenv.config();`. SendGrid is initialized eagerly outside build/test: `sgMail.setApiKey(SENDGRID_API_KEY)`.

`src/config.ts` therefore has a **two-source environment model**: Firebase params (production, via `functions/.env`) and `process.env` + `.env` (local). `isProduction` is true if *either* `RUNTIME_ENV === 'production'` *or* `NODE_ENV === 'production'`.

### 9.3 Firebase setup

| Artifact | Content |
| --- | --- |
| `firebase.json` | functions source `functions`; hosting public `public` with `**` → `api_2` (us-central1) rewrite and a `Cache-Control: public, max-age=302400, s-maxage=604800` header on `/`; emulators auth 9709, functions 8848, hosting 5061, ui disabled, pubsub 8088 |
| `.firebaserc` | `default: igbo-api-bb22d`, `staging: igbo-api-staging-99a67` |
| `functions/index.js` | exports `api_2` (`onRequest({ cors: true, concurrency: 500, memory: '2GiB' })`) and `demo` (`functions.https.onCall`) |
| `functions/package.json` | mirrors the root dependency list; `engines.node: "20"`; scripts `serve`/`shell`/`start`/`deploy`/`logs` |
| `src/services/firebase.ts` | web SDK init (`initializeApp`), exports `app`, `auth`, `functions`; connects the **functions emulator** (`localhost:8848`) and **auth emulator** (`http://localhost:9709`) whenever `NODE_ENV !== 'production'` |
| `src/services/firebase-admin.ts` | `initializeAdminApp({ credential: applicationDefault(), projectId: 'igbo-api-bb22d' })` in production, else `{ projectId: 'igbo-api-staging-99a67' }`; exports `adminApp` |
| `src/services/firebaseConfigs.ts` | hardcoded `STAGING_FIREBASE_CONFIG` / `PRODUCTION_FIREBASE_CONFIG` (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId, measurementId) |
| `functions/next.config.js`, `functions/next-i18next.config.js`, `functions/postcss.config.js`, `functions/tailwind.config.js` | copies of the root configs, shipped with the function |

`.github/FIREBASE_CONFIG.md` documents the contributor workflow: run `npx firebase login`, upgrade to the Blaze plan (needed for emulators), replace the project id in `.firebaserc`, replace the config object in `src/services/firebase.ts`, then `npx firebase use default`.

`src/functions.ts` defines the callable used by the demo with a narrow contract:

```ts
type DemoOption = 'speech-to-text' | 'dictionary' | 'translate';
export const onDemo = functions.https.onCall(demoInternal);
```

It proxies to `${API_ROUTE}/api/v2/{words,speech-to-text,translate}` using `X-API-Key: MAIN_KEY`, swallows upstream errors (`return { data: { words: [] } }` etc.), and throws `functions.https.HttpsError('internal', …)` for an invalid `type`. `export const TEST_ONLY = { demoInternal }` exposes the inner function for unit tests. This is the mechanism that keeps the master key off the client while letting the public site demo the API.

### 9.4 Migrations (`migrate-mongo`)

```js
// migrate-mongo-config.js
const config = {
  mongodb: {
    url: process.env.MONGO_URI || 'mongodb://0.0.0.0:27017',
    databaseName: process.env.DB_NAME || 'igbo_api',
    options: { useNewUrlParser: true, useUnifiedTopology: true },
  },
  migrationsDir: 'migrations',
  changelogCollectionName: 'changelog',
  migrationFileExtension: '.js',
};
module.exports = config;
```

* **63 migrations**, filenames `YYYYMMDDHHMMSS-kebab-case-description.js`, spanning `20201106045436` → `20250417110353`.
* Each exports `{ async up(db) { … }, async down(db) { … } }` operating on raw `db.collection(…)` (no Mongoose, no compiled models — so migrations survive schema refactors). Example:

```js
module.exports = {
  async up(db) {
    const collections = ['words', 'wordsuggestions', 'genericwords'];
    return collections.map(async (collection) => {
      db.collection(collection).updateMany({}, [
        { $set:   { relatedTerms: { $setUnion: ['$synonyms', '$antonyms'] } } },
        { $unset: ['synonyms', 'antonyms'] },
      ]);
    });
  },
  async down(db) { /* inverse */ },
};
```

* Applied with `npm run migrate-up` / `npm run migrate-down`; the changelog collection is `changelog`. `deploy.yml` runs `npm run migrate-up` **after** build and **before** `firebase deploy --only functions`.
* Migrations are the de-facto schema documentation. Patterns worth copying: aggregation-pipeline `updateMany({}, [pipeline])` for renames (no client-side loops), `$addFields`/`$unset` for adds/removes, `$setUnion` for field merges, and `down` implementations that are a true inverse.
* Migrations touching the suggestion collections are the only evidence of the wider data model (see §7.1); e.g. `20240908162526-assign-projectid-to-each-collection.js` iterates `[corpus, corpussuggestions, examples, examplesuggestions, exampletranscriptionfeedbacks, nsibidicharacters, stats, textimages, words, wordsuggestions]` and stamps a `projects` reference onto each — i.e. the real platform is **multi-project**, while the API's own `words`/`examples` are one project named `Igbo API`.

### 9.5 Redis / replica-set flags

* Redis is enabled by supplying `ENV_REDIS_HOST` + `ENV_REDIS_PORT` + `ENV_REDIS_USERNAME` + `ENV_REDIS_PASSWORD` (all four, per the `&&` chain). Local full-stack dev sets `env.redis_url=redis://localhost:6379`, `env.replica_set=true`, `env.redis_status=true` via `firebase functions:config:set`.
* `ENV_REDIS_STATUS` is set by dev/deploy tooling but never read by code — the fake-client fallback is what actually disables caching.
* Replica set is enabled by `ENV_REPLICA_SET=true` → `mongodb://host:2717,host:2727,host:2737/igbo_api?replicaSet=rs0`. Reading `readPreference: 'nearest'` in production requires the replica set; `'primary'` is forced in tests.
* The `dev:full:database` + `start:database:replica*` scripts let a developer reproduce the replica topology locally on ports 2717/2727/2737.

### 9.6 CI (`.github/workflows/`)

**`deploy.yml`** — on push to `master`; job `deploy`, ubuntu-latest, node 20. Steps: checkout → setup node 20 → `rm -rf ./node_modules; npm install && npm install -g firebase-tools` → `cd functions; rm -rf ./node_modules/; npm install; cd ..; firebase use default --token $FIREBASE_TOKEN` → `touch ./functions/.env` → `SpicyPizza/create-envfile@v2.0` writing ~32 `envkey_*` values into `functions/` → `firebase functions:config:set runtime.env=production` + `npm run build` → `firebase functions:config:set env.redis_status=true runtime.env=production` + `npm run migrate-up` → `firebase deploy --project=igbo-api-bb22d --only functions` → `firebase deploy --project=igbo-api-bb22d --only hosting` → `rm -rf ./functions/.env`. Job-level `env` supplies ~24 secrets for the build step. Note the ordering: **functions deploy before hosting**, and the env file is deleted at the end so no secrets are committed.

**`integration.yml`** — on `workflow_dispatch` and `pull_request`; `timeout-minutes: 15`; matrix node `20.x` × mongodb `5.0, 6.0`; `supercharge/mongodb-github-action@1.3.0`; then `npm install` (+ `firebase-tools`), `npm run build`, `npm run test:build` (the 5-second server boot smoke test), `npm run jest:backend`, `npm run jest:frontend`. Env: `FIREBASE_TOKEN`, `CI=test`, `NODE_ENV=test`, `MAIN_KEY`.

**`lint.yml`** — on `push`, node 20: `npx eslint ./src` then `npx tsc --noEmit`. (ESLint flat config `eslint.config.mjs` with `@eslint/js` recommended + `typescript-eslint` recommended + `eslint-plugin-react`, with `no-misleading-character-class`, `no-useless-escape`, `react/display-name`, `no-explicit-any`, `no-require-imports` explicitly relaxed — the last two because the codebase uses both.)

**`dockerize.yml`** — on push to `master`: docker login, `docker build -t igbo_api .`, tag and push `$DOCKER_USERNAME/igbo_api_server`.

**`release.yml`** — on push to `master`: semantic-release with `@semantic-release/{commit-analyzer,release-notes-generator,changelog,npm,git}`, `branches: ['master']`, `changelogFile: CHANGELOG.md`, `npmPublish: false`, git assets `dist/**/*.{js,css}`. Conventional commits enforced locally via `commitlint.config.js` (`@commitlint/config-conventional`) + husky + lint-staged (`prettier --write`, `eslint`, and `tsc --noEmit` on `**/*.ts`).

`@types/*.d.ts` (14 files: bcrypt, body-parser, compression, console, diacriticless, environment, express-rate-limit, is-word, morgan, react-scroll, shelljs, string-similarity, supertest, uuid) exist because several packages ship no types; `@types/console.d.ts` declares the `console.green/blue/red` helpers installed by `src/shared/utils/wrapConsole.ts`.

---

## 10. TESTS

### 10.1 Three Jest configs (the split is the design)

**`jest.backend.config.ts` — backend, no database required**

```ts
export default {
  displayName: 'igbo_api',
  testMatch: ['**/__tests__/*.ts'],
  testPathIgnorePatterns: ['<rootDir>/__tests__', '<rootDir>/src/__tests__', '<rootDir>/src/controllers/__tests__'],
  testTimeout: 20000,
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: { 'src/(.*)': '<rootDir>/src/$1' },
  transform: { '^.+\\.tsx?$': 'ts-jest' },
};
```

Everything else — `__mocks__/mongoose.ts`, `__mocks__/firebase-admin.ts`, `__mocks__/stripe.ts`, `__mocks__/axios.ts`, etc. — makes controllers/middleware/utilities testable in isolation. Run with `npm run jest:backend:no-database` (`NODE_ENV=test jest --forceExit --runInBand --config=jest.backend.config.ts`).

**`jest.backend.database.config.ts` — backend + live MongoDB**

```ts
import jestBackendConfig from './jest.backend.config';
export default { ...jestBackendConfig, testPathIgnorePatterns: [], globalSetup: './testSetup.ts' };
```

The only differences are (a) the integration directories are no longer ignored, so `__tests__/*.test.ts`, `src/__tests__`, and `src/controllers/__tests__` run, and (b) `testSetup.ts` runs once. Run with `npm run jest:backend:database`.

**`testSetup.ts`**

```ts
export default async () => {
  if (mongoose.connection?.db?.dropDatabase) {
    await mongoose.connection.collection('words').dropIndexes();
    await mongoose.connection.collection('examples').dropIndexes();
    await mongoose.connection.collection('developers').dropIndexes();
    await mongoose.connection.collection('developerUsages').dropIndexes();
    await mongoose.connection.collection('nsibidicharacters').dropIndexes();
    await mongoose.connection.db.dropDatabase();
  }
  await populateAPI();                                  // from __tests__/shared/commands.ts
  await new Promise((resolve) => { setTimeout(resolve, 2000); });
};
```

Dropping **indexes before the database** is essential: stale text indexes silently poison the `$text` search assertions.

**`jest.frontend.config.ts` — React/Next component tests**

```ts
export default {
  displayName: 'igbo_api',
  testMatch: ['./**/__tests__/**/*.test.tsx'],
  testTimeout: 20000,
  testEnvironment: 'jsdom',
  testPathIgnorePatterns: ['src/__tests__/*.tsx'],
  moduleFileExtensions: ['tsx', 'ts', 'js', 'json', 'html'],
  moduleNameMapper: { '^[./a-zA-Z0-9$_-]+\\.(svg|gif|png|less|css)$': '<rootDir>/src/__data__/assetStub.ts' },
  transform: { '^.+\\.(js|ts|tsx)$': ['ts-jest', { tsconfig: './tsconfig.test.json' }] },
  setupFilesAfterEnv: ['./src/__tests__/shared/script.ts'],
};
```

`tsconfig.test.json` only overrides `jsx: 'react-jsx'` (the base config uses `jsx: 'preserve'` for Next). `src/__data__/assetStub.ts` stubs SVG/PNG/CSS imports.

**Aggregate scripts**

```jsonc
"jest:backend:database":        "cross-env NODE_ENV=test jest --forceExit --runInBand --config=jest.backend.database.config.ts",
"jest:backend:no-database":     "cross-env NODE_ENV=test jest --forceExit --runInBand --config=jest.backend.config.ts",
"jest:backend":                 "npm run jest:backend:database && npm run jest:backend:no-database",
"jest:frontend":                "cross-env NODE_ENV=test jest --forceExit --runInBand --config=jest.frontend.config.ts",
"jest":                         "npm run jest:backend && npm run jest:frontend",
"test":                         "npm-run-all -p -r start:database jest"
```

`--forceExit --runInBand` are required because the app opens/closes Mongo connections per request and never fully quiesces; `runInBand` prevents test files from racing over the shared `test_igbo_api` database.

### 10.2 Test inventory (52 files)

**Backend integration (`__tests__/`, supertest against the real Express app):**

| File | Coverage |
| --- | --- |
| `api-json.test.ts` | `/api/v1/test/words` JSON-dictionary path, including `NO_PROVIDED_TERM` |
| `api-mongo.test.ts` | the main MongoDB suite (~470+ lines); includes the `diacriticless` + `string-similarity` ranking assertions |
| `developers.test.ts` | developer CRUD, API-key gating (200/401/403), usage-limit exhaustion — **entire suite is `describe.skip`** |
| `examples.test.ts` | `/api/v1/examples` and `/api/v1/examples/:id` |
| `nsibidi_characters.test.ts` | `/api/v2/nsibidi` |
| `parse.test.ts` | query parsing |
| `stripe.test.ts` | `/stripe/*` routes |
| `shared/commands.ts` | supertest request builders (`getWords`, `getWordsV2`, `getWord`, `getWordV2`, `getExamples`, `getExample`, `getDeveloper`, `createDeveloper`, `searchTerm`, `populateAPI`) that set `X-API-Key`/`Authorization` |
| `shared/constants.ts` | `API_ROUTE = '/api/v1'`, `API_ROUTE_V2 = '/api/v2'`, `TEST_ROUTE = '/api/v1/test'`, `STRIPE_ROUTE`, `WORD_KEYS_V1`/`WORD_KEYS_V2`, `EXAMPLE_KEYS_V1`/`EXAMPLE_KEYS_V2`, `FALLBACK_API_KEY = 'fallback_api_key'`, `MAIN_KEY = 'main_key'`, `INVALID_ID`/`NONEXISTENT_ID` |
| `shared/utils.ts`, `shared/uiFixtures.ts`, `__mocks__/documentData.ts`, `__mocks__/data.mock.json`, `__mocks__/genericWords.mock.json` | fixtures |
| `__mocks__/dictionaries/{ig-en,ig-en_1000_common,ig-en_expanded,ig-en_normalized_expanded}.json` | the `DICTIONARIES_DIR` rewrite target under `NODE_ENV=test` |

The `WORD_KEYS_V1` / `WORD_KEYS_V2` / `EXAMPLE_KEYS_V1` / `EXAMPLE_KEYS_V2` arrays are the **frozen API contract** — the most valuable artifact to port, since they pin the exact key set per version:

```ts
export const WORD_KEYS_V1 = ['variations','definitions','stems','id','word','wordClass','pronunciation','relatedTerms','hypernyms','hyponyms','nsibidi','attributes'];
export const WORD_KEYS_V2 = ['variations','definitions','stems','id','word','pronunciation','relatedTerms','hypernyms','hyponyms','attributes','tags'];
export const EXAMPLE_KEYS_V1 = ['igbo','english','meaning','nsibidi','style','associatedWords','id','pronunciation','updatedAt','createdAt'];
export const EXAMPLE_KEYS_V2 = ['igbo','english','meaning','style','type','associatedWords','associatedDefinitionsSchemas','id','nsibidi','pronunciations','updatedAt','createdAt'];
export const EXCLUDE_KEYS = ['__v', '_id'];
```

**Unit tests (`src/**/__tests__/`):**

`src/APIs/__tests__/FlagsAPI.test.ts`; `src/controllers/__tests__/{developers,examples,speechToText,stripe,translation}.test.ts`; `src/controllers/stripe/__tests__/index.test.ts`; `src/controllers/utils/__tests__/{minimizeVerbsAndSuffixes,parseAWS,queries}.test.ts`; `src/functions/__tests__/functions.test.ts`; `src/middleware/__tests__/{authorizeCheckoutSession,authorizePortalSession,developerAuthorization}.test.ts`; `src/middleware/helpers/__tests__/{authorizeDeveloperUsage,createDeveloperUsage,findDeveloperUsage}.test.ts`; `src/services/__tests__/{database,stripe}.test.ts`; `src/shared/utils/__tests__/{createRegExp,getErrorMessage}.test.ts`.

**Frontend tests:** `src/__tests__/{Card,Demo,FadeIn,Input,Statistics/Stat,Statistics/Statistics}`; `src/pages/APIs/__tests__/{DevelopersAPI,PredictionAPI}.test.tsx`; `src/pages/__tests__/App.test.tsx`; `src/pages/components/Footer/__tests__/Footer.test.tsx`; `src/pages/components/Navbar/__tests__/{Navbar,NavigationMenu,NavigationOptions}.test.tsx`; `src/pages/dashboard/__tests__/{credentials.page,dashboard,layout,plans.page,profile}.test.tsx`; `src/pages/dashboard/components/__tests__/{DashboardMenu,DashboardNavigationMenu}.test.tsx`; `src/pages/managers/__tests__/AuthManager.test.tsx`; `src/pages/pricing/__tests__/_index.page.test.tsx`; `src/pages/pricing/components/__tests__/PricingCard.test.tsx`.

**Manual mocks (`__mocks__/`, 17):** `@chakra-ui/react.tsx`, `@sendgrid/mail.ts`, `axios.ts`, `bcrypt.ts`, `firebase-admin.ts`, `firebase-functions/v1.ts`, `firebase/app.ts`, `firebase/auth.ts`, `firebase/functions.ts`, `i18next.ts`, `mongoose.ts`, `next/font/google.ts`, `next/router.ts`, `react-firebase-hooks/auth.ts`, `shelljs.ts`, `stripe.ts`, `uuid.ts`. `uuid.ts` makes API-key generation deterministic; `mongoose.ts` makes most controllers testable without a database; `next/router.ts` supplies `useRouter` for page tests.

### 10.3 Cypress

`cypress.config.js`:

```js
const { defineConfig } = require('cypress');
module.exports = defineConfig({
  e2e: {
    baseUrl: 'http://localhost:8080',
    video: false,
    chromeWebSecurity: false,
    execTimeout: 5000,
    retries: { runMode: 1 },
    pageLoadTimeout: 30000,
    taskTimeout: 30000,
    specPattern: 'cypress/e2e/**/*.cy.{js,jsx,ts,tsx}',
  },
});
```

Cypress 12. `cypress/support/e2e.js` wires Testing Library's `findByText`/`findByTestId` and repoints the test-id attribute:

```js
import { configure } from '@testing-library/cypress';
import './commands';
configure({ testIdAttribute: 'data-test' });      // matches data-test="…" in the components
```

`cypress/support/commands.js` → `import '@testing-library/cypress/add-commands';`. `cypress/plugins/index.js` is an empty stub (Cypress 12 moved config to the top-level file).

`cypress/e2e/client.cy.js` covers, at `viewport('macbook-16')` and with a `beforeEach(() => cy.visit('/'))`: the outbound link to `https://nkowaokwu.com/home` (`nkowaokwu-link`), hero `h1` containing "The First African Language API", the About page, the Privacy page, the Terms page, the try-it-out flow (`try-it-out-input` → type `biko` → click `dialects-flag` → assert the generated URL contains `/api/v1/words?keyword=biko&dialects=true`), and a Register Account block at `/signup`.

Scripts: `cypress` (`start` + `start:database` + `cypress:open`), `cypress:ci`, `cypress:open`, `cypress:run`. Cypress is **not** wired into any `.github/workflows` file (the e2e suite is run manually).

### 10.4 What a testing strategy for such a platform should look like

Derived from this repo's actual shape — the good parts to copy and the gaps to close:

1. **Split by infrastructure dependency, not by layer.** Two backend configs (with/without a real MongoDB) share one base config, with `testSetup.ts` as the only difference. It keeps ~70% of tests fast and dependency-free while the rest exercise the real aggregation pipelines, which is where the risk actually lives (regex + `$text` + `$lookup` behaviour is not reproducible with a mock).
2. **Golden key-set assertions per API version.** `WORD_KEYS_V1/V2` + `EXAMPLE_KEYS_V1/V2` make accidental field leakage/removal fail loudly. This is the highest-value test in the repo because the entire product is a JSON contract.
3. **Test the version boundary explicitly.** Every read path branches on `version`; V1↔V2 shape differences (`definitions`, `dialects`, `pronunciations`, `{data,length}`) deserve dedicated per-version assertions rather than a shared expectation.
4. **Own the search-ranking tests.** The `diacriticless` + `string-similarity` comparisons in `api-mongo.test.ts` are the only guard on `sortDocsBy`'s 9 magic constants. A different language needs a fixture-based ranking test (query → expected ordered headwords), because the constants will change.
5. **Auth matrix as a table test.** For each route × {no key, bad key, `fallback_api_key`, `main_key`, real key} assert the status and body. `developers.test.ts` sketches this but is `describe.skip`ped — reimplementations should not skip it.
6. **Metering needs deterministic time.** `isSameDate` + a mutable `usage.date` make day-rollover testable; inject a clock rather than relying on the calendar.
7. **Cypress for the few genuinely end-to-end paths** (signup → dashboard → copy API key; the demo's three tabs) and Testing Library for everything else. `configure({ testIdAttribute: 'data-test' })` is the convention that makes this painless.
8. **CI shape:** build → boot-smoke-test → backend-with-DB → backend-without-DB → frontend, on a MongoDB version matrix, with `NODE_ENV=test` and a `MAIN_KEY` secret. Add `cypress:run` (currently missing) and a docs/OpenAPI diff check if the API is a public contract.
9. **Missing and worth adding:** OpenAPI/Swagger generation from the route table (this repo has none — docs live in a separate repo), contract tests against the consuming client, load tests for the regex search paths, and migration round-trip tests (`up` then `down` then `up`).

---

## 11. WHAT TO CHANGE FOR A DIFFERENT LANGUAGE

Everything below is Igbo-specific and must be replaced. Classification is by evidence found in the code.

### 11.1 Must be replaced (hard-coded Igbo language content)

| Area | Files | What to do |
| --- | --- | --- |
| **Dictionaries** | `src/dictionaries/ig-en/{ig-en.json, ig-en_1000_common.json, ig-en_expanded.json, ig-en_normalized_expanded.json}`, `src/dictionaries/en-ig/en-ig_normalized_expanded.json`, `src/dictionaries/seed.ts` | Replace with `<target>-<pivot>` corpora in the same 4-file shape (a `{ headword: [ {word, wordClass, definitions[], examples[], variations[], stems} ] }` map). Update `DICTIONARIES_DIR`/`BUILD_DICTIONARIES_DIR` in `parseFileLocations.ts` and the `build:dictionaries:*` / `build:functions` scripts in `package.json`. The 6.7 MB `en-ig` map is only a build artifact today (§6.6) — if you want true reverse lookup, wire it in deliberately. |
| **Nsibidi character model** | `src/models/NsibidiCharacter.ts`, `src/types/nsibidiCharacter.ts`, `src/controllers/nsibidi.ts`, `src/dictionaries/nsibidi/nsibidi_dictionary.ts` (31,504 lines / 5,250 entries), the `WordClass.nsibidiValue` CJK strings in `WordClass.ts`, `cjkRange = '[\u4E00-\u9FFF]'` in `diacriticCodes.ts`, `searchNsibidiCharactersQuery`, and the `nsibidi`/`nsibidiCharacters` fields on `Word`/`Example` | This whole subsystem is a script-specific add-on. Either drop it end-to-end (model, controller, routes 16–17, `igboDefinitions[].nsibidi`, `definitions[].nsibidi`, the `?` CJK branch in `fullTextSearchQuery`) or re-point it at your language's traditional script. Note the nsibidi values also leak into `getStats` (`totalNsibidiWords`, `StatTypes.NSIBIDI_WORDS`, `NSIBIDI_WORD_SUGGESTIONS`) and into `WordClass` — removing it touches ~10 files. |
| **Dialect list** | `src/shared/constants/DialectEnum.ts` (46 codes), `src/shared/constants/Dialect.ts` (46 `ibo-*` codes + labels) | Replace with your language's dialect/variety list. Preserve the three-part shape (`EnumCode` / `code: '<iso3>-<abbr>'` / `label`) and the `validate: every(v => Dialects[d].value)` pattern. The `ibo-` prefix comes from `LanguageEnum.IGBO = 'ibo'` (ISO 639-3), so switch that too. Also re-check `migrations/20221107022314-resturcture-dialects-as-arrays.js`-style helpers if you seed dialect data. |
| **Diacritics / tone handling** | `src/shared/constants/diacriticCodes.ts` (the entire file: per-letter `caseInsensitive*` classes, `ALL_DIACRITICS = '\u00B4\u0301\u0060\u00AF\u0304\u0323\u0300'`, `OVERDOT_UPPERCASE_N`…`MACRON_LOWERCASE_U`), `src/shared/utils/removeAccents.ts` (`remove` drops `[\u0300-\u036f]`; `removeExcluding` keeps `\u0323`), `src/shared/utils/createRegExp.ts` (the `front`/`back` ranges `[^a-zA-Z\u00c0-\u1ee5]`), `src/shared/utils/normalization.js` (the `[a-zA-ZỊịṄṅỌỤụ\-'’]+` tokenizer and the `charCodeAt() > 128 && < 300` tone-stripping heuristic), `WordAttributeEnum.IS_ACCENTED`, `IS_STANDARD_IGBO` | This is the deepest Igbo coupling. The design to preserve is: (a) two-level folding — tone-insensitive but letter-preserving — because Igbo ị/ọ/ụ are phonemes while accents are tones; (b) a per-letter alternation table so a search for a folded letter matches every toned form; (c) explicit word-boundary classes instead of `\b` (ASCII-only in JS regex). For a language whose orthography differs (e.g. no underdots, or a different tone inventory, or an abugida), rewrite `diacriticCodes` and the two `removeAccents` modes, and re-derive `front`/`back`. Also re-tune the `sortDocsBy` constants, which were hand-fit to Igbo. |
| **Word classes** | `src/shared/constants/WordClass.ts` (21 entries with `label`, `nsibidiValue`, and Igbo example sentences), `WordClassEnum.ts` | Keep the enum *mechanism*; replace the taxonomy. The Igbo-specific parts are `AV`/`MV`/`PV` (active/medial/passive verb, which encode Igbo's stative-vs-performative verb split), `ISUF`/`ESUF` (inflectional/extensional suffix — an Igbo morphology concept with no clean analogue), the `nsibidiValue` CJK glyphs, and every `description` example (`Eg. nwayọnwayọ, Ikiike, Ọsịịsọ`, `Eg. I, Ị, O, Ọ, A, E, N, M, Na-, Ga-`, …). |
| **Tenses** | `src/shared/constants/Tenses.ts` (`infinitive`, `imperative`, `simplePast`, `presentPassive`, `simplePresent`, `presentContinuous`, `future`) and the 7 matching indexes in `Word.ts` plus `generateMultipleTensesWordRegex` | These are Igbo's verb paradigm slots. `presentPassive` in particular is Igbo grammar (and, note, is the one tense with no index). For another language, redefine the tense slots and regenerate both the schema fields and the search clauses — they are coupled by `Object.values(Tenses).reduce(...)`. |
| **i18n** | `src/public/locales/{en,ig}/{about,common,signup}.json`, `next-i18next.config.js` (`locales: ['en', 'ig']`), `functions/next-i18next.config.js`, the manual `i18n.init({ resources: { en, ig }, lng: 'en' })` in `_app.page.tsx`, `src/public/fonts/Akagu2020.ttf` | Replace the locale set (`ig` → your language) and all copy. Note the default locale is `en` and the pivot language for definitions is English throughout (`definitions.definitions` holds English glosses) — decide whether the target language is the headword language, the pivot, or both. |
| **Language enum / pivot** | `src/shared/constants/LanguageEnum.ts` (`UNSPECIFIED`, `ENG='eng'`, `HAU='hau'`, `IGO='ibo'`, `YOR='yor'`), `PayloadKeyMap` and `SUPPORTED_TRANSLATIONS` in `controllers/translation.ts`, `ApiType`/`ApiTypeToRoute` | Swap in your ISO 639-3 code(s). `SUPPORTED_TRANSLATIONS` has hardcoded `maxInputLength` (120 for ibo→eng, 150 for eng→ibo) and only those two directions; `SUPPORTED_TRANSLATIONS[YORUBA]` and `[HAUSA]` are empty objects, showing the intended extension point. |
| **Search tokenization / stop words** | `src/shared/constants/StopWords.ts` (178-entry English/MongoDB list), `IGNORE_ENGLISH_WORDS` (20 entries) in `controllers/words.ts`, `isWord('american-english')` | `StopWords` must become your pivot language's stopword list, and the `hasQuotes`/`isWord` heuristic assumes "Igbo vs English" as the only two possibilities. Replace `isWord('american-english')` with a language-appropriate discriminator (script detection, a stopword-based detector, or explicit language params). |
| **Culture-specific labels** | `SuggestionSourceEnum` (`IGBO_WIKIMEDIANS`, `IGBO_SPEECH`, `BBC`), `ExampleStyleEnum.PROVERB`/`BIBLICAL`, `SentenceTypes.BIBLICAL`, `StatTypes.{PROVERB_EXAMPLES,BIBLICAL_EXAMPLES,STANDARD_IGBO}`, `WordAttributeEnum.{IS_STANDARD_IGBO,IS_BORROWED_TERM}`, `src/pages/shared/useCases.ts`, `src/pages/components/Features/Features.tsx` and `MentionedIn.tsx`, `src/siteConstants.ts` | Corpus provenance enums and marketing copy are entirely Igbo/Nigerian. Keep the *pattern* (provenance enum, example styles) and re-populate for your corpus. |
| **Igbo-specific search rewrite** | `src/controllers/utils/index.ts`: `.replace(/[Aa]ana m /, 'm ')` | A one-off Igbo morphology fix; delete or replace. |
| **Branding and hosts** | `src/config.ts` (`DB_NAME = 'igbo_api'`, `TEST_DB_NAME = 'test_igbo_api'`, `API_ROUTE`, `API_DOCS`, `API_FROM_EMAIL = 'kedu@nkowaokwu.com'`, the hardcoded Stripe **test** key fallback), `src/siteConstants.ts`, `src/services/firebaseConfigs.ts` + `firebase-admin.ts` project ids, `.firebaserc`, `firebase.json` function name `api_2`, `functions/index.js`, `src/pages/_document.page.tsx` OG/favicon URLs, `README.md` | Full rebrand + new Firebase projects. Prioritize removing the hardcoded `sk_test_…` fallback and the committed Firebase web configs. |
| **Upstream model services** | `ENV_SPEECH_TO_TEXT_API`, `ENV_IGBO_STT_URL`, `ENV_IGBO_TO_ENGLISH_URL`, `ENV_ENGLISH_TO_IGBO_URL`; the hardcoded S3 bucket check `audio.includes('igbo-api.s3.us-east-2')` in `speechToText.ts`; `Endpoint.AUDIO`/`PREDICT`; `src/pages/APIs/PredictionAPI.ts` | Re-point to your ASR/MT services and make the bucket check configurable. The IgboSpeech/Igbo OCR marketing entries in `pricingFeatures.tsx` are product-specific. |

### 11.2 Keep as-is (language-agnostic infrastructure worth reusing verbatim)

* The whole Express/Next hybrid: `src/app.ts`, `src/server.ts`, `src/routers/siteRouter.ts`, `functions/index.js` (one `onRequest` function serving API + SSR), the `functions/` ↔ `build/` ↔ `dist/` split, and the `firebase.json` rewrite.
* `src/models/plugins/index.ts` — the `id`-for-`_id` contract (`toJSONPlugin` + `toObjectPlugin` + `virtuals: true`).
* `src/middleware/{validateApiKey,validateAdminApiKey,developerAuthorization,errorHandler,cache,noCache,validId}.ts` and the Joi body validators — the `X-API-Key` model, the `MAIN_KEY` bypass, the `isUsingMainKey` result-widening flag, and the "400 by default, 404 on `No … exist`" error convention.
* `src/middleware/attachRedisClient.ts` + `src/APIs/RedisAPI.ts` — the singleton-client-with-fake-fallback + `{ EX: 604800 }` response cache. (Fix the per-response `quit()` when you port it.)
* `startDocsBy`-style *structure*: the `finalScore > otherScore ? -1 : 1` comparator and its named-constant layout; the constants themselves need re-fitting.
* `src/shared/constants/diacriticCodes.ts`'s *approach* (per-letter alternation + explicit boundary classes) even though the table is Igbo.
* Version handling: `Version`, `packageResponse`, the derived-from-`baseUrl` version, and the V1-legacy/V2-modern projection split in `buildDocs.ts`/`minimizeWords.ts`/`FlagsAPI.ts`.
* `migrate-mongo` + the timestamped `{up, down}` pipeline-update pattern.
* The three-way Jest split, `testSetup.ts`, the `__mocks__` set, and the `WORD_KEYS_*`/`EXAMPLE_KEYS_*` golden contract arrays.
* `useRecorder.ts` (mic-recorder-to-mp3 at `bitRate: 30000`, permission probe, duration ticker, MP3/size validation) — replace only the toast copy.
* `src/controllers/stripe/*` + `webhooks.ts` + `AccountStatus` + `Plan`: the checkout/portal/webhook wiring is language-neutral. **Note the gap:** `plan`/`accountStatus` are stored but never consulted by `authorizeDeveloperUsage`, so tier gating must be built, not ported.

### 11.3 Sequencing suggestion for a new language

1. Fork the repo; strip nsibidi end-to-end (§11.1) to remove the largest single-language dependency early.
2. Replace `LanguageEnum`, `WordClass`, `Tenses`, `Dialect*`, `StopWords`, and `diacriticCodes`/`removeAccents` — then re-run `src/shared/utils/__tests__/createRegExp.test.ts` and re-fit `sortDocsBy`.
3. Import your `<target>-<pivot>` dictionary into the 4-file shape and re-seed; verify the 12 `words` indexes are created (`syncIndexes` + `migrate-up`).
4. Freeze your own `WORD_KEYS_V1/V2` and `EXAMPLE_KEYS_V1/V2` and make them the contract test.
5. Build the tier/quota enforcement that this repo advertises but does not implement (map `Plan` → per-`ApiType` daily limits instead of the flat `ApiUsageLimit`), and add burst rate limiting to the data routes.
6. Replace branding, Firebase projects, Stripe lookup keys, and remove the hardcoded secret fallbacks.
