
OZIKORO

Technical Scoping & Hiring Guide
Every project, by skill set, stack, and difficulty — for deciding who to hire and what to pay them for.

Prepared for Team Build-Out & Vendor Evaluation

# Table of Contents

# 1. How to Read This Document
This breaks the platform into its actual buildable projects — not the six identity layers, but the engineering work behind them — so you know exactly what kind of developer each piece needs, what it's built with, and where the real difficulty is.
It assumes the decisions already made: a small in-house team of 2–5 people, web-first with a mobile app to follow, and a lean Year 1 budget. Every stack recommendation below is chosen to fit that — common, well-documented technology that a small team can actually hire for and that won't need to be thrown away when the mobile app or the GIS work arrives later.
One structural point worth holding onto throughout: most of what looks intimidating about this platform (six layers, five years, dozens of ethnic groups) is content and partnership work, not engineering work. The actual code surface area is closer to a handful of well-understood project types — a content platform, a structured database with search, a dictionary/audio app, a mapping tool, a family-tree graph, and an AI chat assistant — each of which is a known, scopeable kind of project that experienced developers will recognize immediately.
# 2. Hiring Summary — All Projects at a Glance
Use this table to triage: which projects can your core 2–5 person team handle directly, and which need a specialist brought in for a defined period rather than hired full-time.

| Project | Hire Type Needed | Year Active | Est. Difficulty |
| Site Migration & CMS Rebuild | Full-stack web developer (generalist) | Year 1 | Low–Medium |
| Name Dictionary & Clan Registry | Backend/database developer | Year 1 | Low–Medium |
| Language Platform (Dictionary, Audio, Translation) | Full-stack developer + ML/NLP engineer (part-time) | Year 1–2 | Medium–High |
| History Archive & Search | Backend developer (same as above, extended) | Year 1–2 | Low–Medium |
| AI Assistant (Layer 6, early) | ML/AI engineer (can be contracted) | Year 1 | Medium |
| Geography & Mapping (GIS) | GIS specialist / geospatial developer | Year 3 | High |
| Genealogy & Family Trees | Backend developer with graph-data experience | Year 4 | Medium–High |
| Diaspora Reconnection + DNA Integration | Full-stack developer + partnership/API integration work | Year 5 | Medium |
| Mobile App | Mobile developer (React Native, reusing web team's React skills) | Year 2–3 onward | Medium |
| Research Network, Academy, Foundation portal | Full-stack developer (content/LMS-style build) | Year 5 | Low–Medium |

Reading this as a hiring plan: one strong full-stack developer can personally carry the Migration, Name Dictionary, History Archive, and most of the Language platform — that's the backbone hire for Year 1. The GIS specialist (Year 3) and the ML/NLP engineer (Year 1–2, part-time) are the two roles worth contracting rather than hiring permanently, since the work is front-loaded and specialized. The mobile developer role can often be the same person as the web full-stack hire if you choose React Native, since it reuses React skills your team already has.

Project-by-Project Breakdown
# 3. Project: Site Migration & Core Platform
Node.js       React/Next.js       PostgreSQL       WordPress API
What it is: Exporting the existing ozikoro.com WordPress archive and rebuilding it as the foundation of the new platform — a proper web application with a real database underneath it, instead of a blog.
Why it's first: Every other project depends on this existing. The Name Dictionary, Clan Registry, and History layer all need somewhere structured to live, and the easiest place to start is restructuring content you already have rather than building a database with nothing in it.
### Core Features
- WordPress REST API export script to pull all existing posts, images, categories, and author data out of the old site.
- A re-tagging tool (even a simple internal admin screen) so a human can go through each article and assign it to an ethnic group, sub-group, and layer — this is half data-entry, half software, and doesn't need to be elegant, just functional.
- A new database schema that replaces WordPress's flat "posts and categories" model with structured tables: ethnic groups, clans, towns, people, articles, with proper relationships between them.
- 301 redirects from every old URL to its new location, so existing Google rankings and social traffic aren't lost.
- A new front-end (the public website) — doesn't need to be flashy in Year 1, needs to be fast, readable, and correctly organized by ethnic group and topic.
### Recommended Stack
Next.js (React) for the front end — it's the most commonly hired-for web framework right now, handles both the content site and later interactive features well, and has a huge hiring pool. Node.js with PostgreSQL for the backend and database — PostgreSQL specifically because Layer 1's clan/lineage relationships and Layer 1's eventual family trees are naturally relational data, and Postgres handles that well without needing anything exotic.
Difficulty: Low to medium. This is standard CRUD web development — reading and writing structured data, displaying it, basic admin tools. Any competent full-stack web developer can do this; it does not require a specialist.
Hire for this: A full-stack web developer with React/Next.js and Node/Postgres experience. This is the single most important hire for Year 1, since this same person likely carries most of Layers 1, 3, and part of 2 as well.
# 4. Project: Name Dictionary & Clan Registry (Layer 1, Year 1)
PostgreSQL       Node.js/Next.js       Search (Postgres full-text or Algolia)       PWA
What it is: A searchable database of Igbo names and clans (then other ethnic groups from Year 2 onward), where each entry carries meaning, origin, cosmological context, dialect notes, and which clan or town it's associated with.
Reference model: Afam (afam.name.ng) is a close, smaller-scale working model for exactly this piece — name, meaning, cosmological context, theme tags, a public submission form, and an editorial review queue before anything goes live, built as a simple installable web app rather than a heavy platform. The Name Dictionary can essentially launch as an Afam-style product for Igbo first, with the Clan Registry, Family Trees, and full Genealogy added as separate, connected database tables in later years rather than bolted onto the name archive itself.
### Core Features
- Structured entry format: name, meaning, origin/etymology, cosmological/spiritual context, associated clan(s), gender association if any, dialectal variants.
- Search and filter by name, clan, theme, or town — fast, typo-tolerant search matters here since names will be transliterated inconsistently.
- A contribution/submission flow so Traditional-class partners (town unions, clan leaders) and the public can submit entries, with a review step before publishing — the same open-contribution-plus-editorial-queue model both Afam and nkowaokwu.com already use successfully.
- An admin review queue for the small editorial team to approve, edit, or reject submissions.
- Installable as a Progressive Web App (PWA) — Afam does this already, and it's a low-cost way to get an app-like mobile experience without building a separate native app in Year 1.
Difficulty: Low to medium. This is a database and search problem, not an algorithmically hard one. The work that takes time is data entry and partner coordination, not code.
Hire for this: Same backend/full-stack developer as the migration project. No separate hire needed.
# 5. Project: Language Platform — Dictionary, Pronunciation, Translation (Layer 2)
Node.js/Next.js       PostgreSQL       Audio storage (S3-compatible)       Python (NLP/ML)
What it is: The Igbo-then-multi-language dictionary and translation system, modeled directly on nkowaokwu.com's existing structure — word entries, audio pronunciation, dialect variants, example sentences — generalized so it works for Yoruba, Edo, Ibibio, Ijaw, and beyond, not just Igbo.
### Core Features
- Word entry system: term, part of speech, definition(s), example sentences, dialectal variations, audio pronunciation file.
- Audio recording and storage pipeline — needs cheap, reliable file storage (S3 or equivalent) and a straightforward way for human translators to upload and attach recordings.
- A "language" field on every entry so the same database structure works across Igbo, Yoruba, Edo, etc. — this is the key generalization step beyond what nkowaokwu.com does for Igbo alone.
- Basic translation lookup (word/phrase to English and back) — this can start as a simple dictionary lookup, not a full machine-translation system.
- Open contribution and editorial review flow, same pattern as the Name Dictionary.
### Where it gets harder: Language AI
Layer 6's "AI assistant" launching alongside the dictionaries in Year 1 is the one piece of this project that needs an actual ML/AI specialist rather than a generalist. There are two realistic approaches, and the cheap one is the right one for a lean Year 1: build a retrieval-based assistant on top of an existing large language model API (OpenAI, Anthropic, or similar) that answers questions using the dictionary and history content as its source material, rather than training a custom language model from scratch. Training a true Igbo-language model is a research-scale undertaking that doesn't fit a bootstrap budget or a 2–5 person team — that ambition should be deferred, not abandoned.
Difficulty: Medium for the dictionary and audio system (well-understood, similar to many e-learning apps). Medium-high for the AI assistant, but only if scoped correctly as an API-based retrieval assistant rather than custom model training.
Hire for this: Core full-stack developer builds the dictionary and audio system. A part-time or contracted ML/NLP engineer — or a generalist developer comfortable calling LLM APIs and building retrieval systems — handles the AI assistant. This does not require a PhD-level ML researcher; it requires someone who has built a "chatbot on top of a knowledge base" before.

# 6. Project: History Archive & Search (Layer 3)
Node.js/Next.js       PostgreSQL       Search (Postgres full-text or Algolia/Elasticsearch)
What it is: The structured version of what the existing ozikoro.com Historical Studies and Cultural Heritage categories already do as a blog — town histories, kingdom histories, colonial records, oral histories, migration records — but tagged to specific peoples, clans, and places instead of sitting in flat blog categories.
### Core Features
- Article/entry system similar to a CMS, but with required structured tags: ethnic group, sub-group/clan, town/place, time period, source type (oral history, colonial record, academic source).
- Full-text search across the whole archive, filterable by those tags.
- Citation/source tracking — since Academic and Archive partners will expect proper sourcing, each entry should support attached references.
- This is largely an extension of the migration project's database schema, not a separate system.
Difficulty: Low to medium. This is the most "normal" software project on the list — a tagged, searchable content archive is an extremely common pattern.
Hire for this: Same core full-stack/backend developer. This project and the migration project together are realistically one continuous piece of work for one person across Year 1.
# 7. Project: Geography & Mapping (Layer 4, Year 3)
Mapbox GL JS or Leaflet       PostGIS       Python (data processing)
What it is: Interactive maps — cultural maps, clan maps, migration routes, settlement maps — built from two years of accumulated Layer 1–3 data. This is the platform's first genuinely specialized engineering project.
### Core Features
- Interactive map rendering with custom layers (clan territories, migration paths, historical settlement boundaries) — not just pins on a map, but custom-drawn regions and routes.
- A geospatial database extension (PostGIS, which plugs into the PostgreSQL database already in use) to store and query location data properly, rather than bolting coordinates onto regular tables.
- Digitization pipeline for historical maps and cartographic sources coming from Archive-class partners — turning old paper maps into usable digital map layers is a real, non-trivial task that involves manual georeferencing work, not pure coding.
- Migration route visualization — animated or stepped paths showing movement over time, which is a recognizable but specialized front-end mapping feature.
Difficulty: High, relative to everything else on this list. Not because the code is exotic, but because GIS (geographic information systems) is a genuine specialization most generalist web developers haven't done, and historical cartography digitization requires domain judgment alongside the engineering.
Hire for this: This is the clearest case for a contracted specialist rather than a generalist hire — a GIS developer or geospatial engineer, engaged for the Year 3 build window specifically, rather than carried on staff year-round. Mapbox and Leaflet (the two standard web-mapping libraries) are both widely used, so this is a hireable, well-defined skill — it's just not a skill your core team needs to have in Year 1.
# 8. Project: Genealogy & Family Trees (Layer 1 completion, Year 4)
Node.js/Next.js       PostgreSQL (or a graph database like Neo4j)       D3.js or similar (tree visualization)
What it is: Family tree construction and the full genealogy product, anchored to the places established in the Geography layer — letting users build, view, and connect their own family lineage to documented clans and towns.
### Core Features
- Family tree data model — people, relationships (parent/child, marriage), and links out to clan and place records from earlier layers.
- Tree visualization — an interactive, explorable family tree diagram in the browser. This is a well-known front-end problem; libraries like D3.js or existing genealogy-specific open-source components handle the rendering.
- Privacy controls — family data is sensitive, and living relatives may not want their information public, so permission and visibility settings matter here in a way they don't for the historical layers.
- Matching/suggestion features — connecting a user's submitted tree to existing clan registry and town history data where names and places line up.
Difficulty: Medium to high. Family-tree data is naturally a graph (people connected to people), which standard relational databases like PostgreSQL can handle reasonably well at this scale, though a graph database becomes worth considering if the connecting/matching features grow complex. The visualization and the privacy/permissions logic are the parts that take real care.
Hire for this: A backend or full-stack developer with some relational/graph-data modeling experience. This can likely still be the core team rather than a new specialist hire, but it's worth budgeting extra time for since it's more intricate than the earlier layers.

# 9. Project: Diaspora Reconnection & DNA Integration (Layer 5, Year 5)
Node.js/Next.js       PostgreSQL       Third-party API integration
What it is: The platform's payoff feature — connecting diaspora descendants to communities, slave-trade-route history, and DNA results, through a licensed partnership with an existing DNA testing provider rather than building genetic sequencing in-house.
### Core Features
- DNA result import — an integration (API or file upload) that takes a result from a partner DNA testing company and matches it against the platform's own ethnic group and clan data.
- Diaspora community directory — connecting users to existing diaspora associations (World Igbo Congress, Yoruba diaspora associations, etc.) relevant to their match.
- Slave trade route visualization — this reuses the Geography layer's mapping work, applied to the Bight of Biafra, Bight of Benin, and other Phase B regions.
- Messaging or introduction features connecting diaspora users to Traditional-class contacts (town unions, clan representatives) — this is as much a partnership/moderation workflow as a technical one.
Difficulty: Medium. The hard part of this project is the external partnership and licensing relationship, not the code — integrating with another company's API is routine work once that partnership exists. The community/messaging features are standard web application patterns.
Hire for this: Core full-stack team, possibly with a short contracted engagement if the DNA partner's API integration turns out to be unusually complex. No new permanent specialist role needed.
# 10. Project: Research Network, Academy, and Foundation Portal (Layer 6 capstones, Year 5)
Node.js/Next.js       PostgreSQL       File storage (S3-compatible)       Existing LMS patterns
What it is: The institutional layer — a publishing and profile platform for African and Nigerian students and academics to publish their research and be discovered, plus a learning platform (the Academy) for teaching language and culture from everything the platform has accumulated.
Reference model, scoped down: ResearchGate is the directional reference, but building its full feature set (25 million users, citation tracking, algorithmic scoring, job boards, group messaging) is not realistic for a small team or a lean budget, and isn't actually what's needed here. The right-sized version is closer to a focused publication repository: a researcher profile, the ability to upload and publish papers or research output, search and discovery by topic or institution, and basic following/visibility — leaving out the parts of ResearchGate that exist mainly because it competes at global social-network scale.
### Core Features
- Researcher/student profile — credentials, institution, research interests, and a list of published or uploaded work.
- Publication upload and storage — PDF or document upload, stored in cheap object storage (S3-compatible), with basic metadata (title, abstract, authors, topic tags, institution).
- Search and discovery by topic, author, or institution — the core value of a repository like this is being findable, not the social features around it.
- Researcher access tier to the broader Ozikoro archive — structured data export or query access for academic partners, likely with some access control, since not everything in the archive may be appropriate for fully open public access, particularly culturally sensitive material.
- Course/curriculum delivery for the Academy — this is a well-worn problem (online course platforms are one of the most common project types in software), so it can lean heavily on existing patterns rather than novel design.
Difficulty: Low to medium. Scoped as a publication-and-profile repository rather than a full social network, this is a standard content-and-file-storage application — well within reach of the same core team, not a separate specialist undertaking.
Hire for this: Core team. No specialist required.
# 11. Project: Mobile App
React Native       Shared backend (same API as web)
What it is: A mobile version of the platform, planned for after the web platform is established.
Why React Native specifically: Since the web front end is being built in React (via Next.js), choosing React Native for mobile means the same developers, and a meaningful amount of the same code (shared logic, shared understanding of the data), can carry over to mobile rather than needing an entirely separate iOS/Android team. This is the single biggest cost-saving decision available in the whole stack, given the lean budget and small team constraints.
Difficulty: Medium. Mobile development always has its own quirks (app store submission, device testing, offline behavior), but choosing React Native specifically minimizes the gap between your web team's existing skills and what's needed here.
Hire for this: A developer with React Native experience — ideally the same full-stack hire if they have mobile experience, or one additional contractor when the mobile build window arrives, rather than a separate native iOS/Android team.

# 12. What This Means for Who You Hire
Stripped down, the small in-house team needs one strong generalist and access to two specialists at the right moments — not a large team from day one.
- Hire 1 (Year 1, core, full-time): A full-stack web developer comfortable with React/Next.js, Node.js, and PostgreSQL. This person carries the migration, Name Dictionary, History Archive, and the non-AI parts of the Language platform. This is the most important hire on the list — everything else is built on the foundation this person lays in Year 1.
- Hire 2 (Year 1, can start part-time/contract): A second full-stack or backend developer, partly to give Hire 1 capacity and partly to start owning Layer 2's audio/dictionary system and prepare for Layer 1's later genealogy work.
- Contracted specialist — AI/ML (Year 1, part-time): Someone who has built retrieval-based assistants on top of LLM APIs before. This does not need to be a full-time hire or an elite ML researcher — it needs to be someone who has shipped a "chatbot that answers from a knowledge base" project.
- Contracted specialist — GIS (Year 3, focused engagement): A geospatial/mapping developer brought in specifically for the Year 3 Geography build, then released or kept on retainer rather than carried as permanent headcount.
- Mobile (Year 2–3 onward): Either an existing hire picks up React Native, or one additional contractor joins for the mobile build — not a new department.
This sequencing matters for budget as much as for the work itself: in a lean Year 1, the spend is one strong generalist developer plus a part-time AI contractor, not a five-person team assembled all at once. The GIS and later specialist needs don't become real costs until Year 3 and beyond, by which point the platform should have real traction to justify them.

Stack recommendations reflect commonly available, well-documented technology chosen for hireability and cost on a lean budget, not the only valid technical approach. A developer or agency you're evaluating may reasonably propose alternatives (for example, Django/Python instead of Node, or Vue instead of React) — the important test is not whether they match this document exactly, but whether they can explain their choice in plain terms and whether they've shipped something comparable before.