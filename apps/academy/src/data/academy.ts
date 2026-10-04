export const courses = [
 {slug:"igbo-language-foundations",code:"IGB 101",title:"Igbo Language Foundations",subject:"Language",level:"Beginner",duration:"8 weeks",lessons:24,description:"Build a confident foundation in spoken and written Igbo through tone, vocabulary and everyday expression."},
 {slug:"igbo-history-sources",code:"HIS 204",title:"Reading Igbo History Through Sources",subject:"History",level:"Intermediate",duration:"6 weeks",lessons:18,description:"Learn to interpret oral testimony, archival records and material culture with scholarly care."},
 {slug:"cosmology-epistemology",code:"CUL 210",title:"Foundations of Igbo Cosmology",subject:"Culture",level:"Intermediate",duration:"7 weeks",lessons:20,description:"Examine traditional worldviews, moral philosophy, personhood and the structures of Odinani."},
 {slug:"oral-history-methods",code:"RES 301",title:"Oral History & Community Research",subject:"Research",level:"Advanced",duration:"10 weeks",lessons:26,description:"Plan, conduct and preserve rigorous community-based interviews and field research."},
 {slug:"proverbs-literature",code:"LIT 220",title:"Igbo Proverbs & Oral Literature",subject:"Language",level:"Intermediate",duration:"5 weeks",lessons:15,description:"Read proverbial language as literature, argument and a living record of social thought."},
 {slug:"precolonial-governance",code:"HIS 260",title:"Pre-colonial Governance & Society",subject:"History",level:"Intermediate",duration:"8 weeks",lessons:22,description:"Study political authority, title systems, assemblies and community justice before colonial rule."},
] as const;
export const syllabus=["Language, sound and tone","Greetings, identity and kinship","Home, place and belonging","Verbs and sentence patterns","Listening across dialects","Conversation and final assessment"];

/* ---------- Version 2: knowledge architecture ---------- */
export const masteryLevels = ["Not started", "Attempted", "Familiar", "Proficient", "Mastered"] as const;
export type Mastery = (typeof masteryLevels)[number];

export type Topic = { slug: string; title: string; summary: string; courses: string[]; cultures?: string[] };
export const subjects: Topic[] = [
  { slug: "african-history", title: "African History", summary: "States, societies and change across the continent, read through evidence.", courses: ["igbo-history-sources", "precolonial-governance"], cultures: ["igbo", "yoruba", "edo"] },
  { slug: "african-languages", title: "African Languages", summary: "Sound, structure, literature and the living use of African languages.", courses: ["igbo-language-foundations", "proverbs-literature"], cultures: ["igbo", "yoruba"] },
  { slug: "religion-worldview", title: "Religions & Worldviews", summary: "Cosmology, moral philosophy, ritual and personhood.", courses: ["cosmology-epistemology"], cultures: ["igbo", "yoruba"] },
  { slug: "archaeology", title: "African Archaeology", summary: "Material culture, sites and the methods that interpret them.", courses: ["igbo-history-sources"], cultures: ["igbo", "edo"] },
  { slug: "research-methods", title: "Research Methods", summary: "Oral history, archives and ethical cultural documentation.", courses: ["oral-history-methods"], cultures: ["igbo"] },
];
export const regions: Topic[] = [
  { slug: "west-africa", title: "West Africa", summary: "Forest, savannah and coast: from Igbo-Ukwu and Ife to Benin and the Sahelian states.", courses: ["igbo-history-sources", "precolonial-governance", "igbo-language-foundations"], cultures: ["igbo", "yoruba", "edo"] },
  { slug: "east-africa", title: "East Africa", summary: "Swahili coast trade, highland kingdoms and Great Lakes societies.", courses: [], cultures: [] },
  { slug: "southern-africa", title: "Southern Africa", summary: "Great Zimbabwe, Mapungubwe and the histories of Southern African peoples.", courses: [], cultures: [] },
];
export const collections: Topic[] = [
  "African Civilisations", "African Kingdoms and States", "African Archaeology", "African Languages", "African Traditional Religions and Worldviews",
  "African Art and Material Culture", "African Political Systems", "African Trade and Economic History", "African Colonial History", "African Diaspora",
].map((title, i) => ({ slug: title.toLowerCase().replace(/[^a-z]+/g, "-"), title, summary: "A curated collection of courses, lessons, sources and archive items for sustained study.", courses: [courses[i % courses.length]!.slug, courses[(i + 2) % courses.length]!.slug], cultures: ["igbo", "yoruba", "edo"].slice(0, (i % 3) + 1) }));

export const profileSections = ["Geography and regions", "Language", "Origins and historical development", "Political organisation", "Religion and worldview", "Economy and trade", "Family and social organisation", "Marriage and life-cycle traditions", "Festivals and ceremonies", "Food and material culture", "Art, architecture and technology", "Archaeology", "Colonial and modern history", "Diaspora", "Further study and sources"];
export type Culture = { slug: string; name: string; region: string; language: string; summary: string; facts: Record<string, string> };
export const cultures: Culture[] = [
  { slug: "igbo", name: "Igbo", region: "west-africa", language: "Igbo (Asụsụ Igbo)", summary: "A people of south-eastern Nigeria whose history spans Igbo-Ukwu bronzes, Nri ritual authority and republican village assemblies.",
    facts: { "Geography and regions": "South-eastern Nigeria, east and west of the lower Niger.", "Political organisation": "Largely decentralised: village assemblies, age grades, title societies and the ritual authority of Nri.", "Religion and worldview": "Odinani: Chukwu, alụsị, ancestors and the personal chi.", "Archaeology": "Igbo-Ukwu (9th–10th century CE) bronzes and glass beads." } },
  { slug: "yoruba", name: "Yoruba", region: "west-africa", language: "Yorùbá", summary: "A people of south-western Nigeria, Benin and Togo, associated with Ife, Oyo and a rich tradition of urban kingship and art.",
    facts: { "Geography and regions": "South-western Nigeria, Benin and Togo.", "Political organisation": "City-states led by obas with councils of chiefs; the Oyo empire.", "Religion and worldview": "Òrìṣà, Ifá divination and Olódùmarè.", "Archaeology": "Ife terracotta and copper-alloy heads (12th–15th century CE)." } },
  { slug: "edo", name: "Edo (Benin)", region: "west-africa", language: "Edo", summary: "The people of the Kingdom of Benin, known for royal court arts, guilds and long-lived monarchy.",
    facts: { "Geography and regions": "Edo State, southern Nigeria.", "Political organisation": "Centralised monarchy under the Oba with palace and town chiefs.", "Art, architecture and technology": "Guild-produced brass plaques and ivory carving; the city walls.", "Colonial and modern history": "The 1897 British punitive expedition and dispersal of the court arts." } },
  { slug: "akan", name: "Akan", region: "west-africa", language: "Akan languages, including Asante Twi and Fante", summary: "A group of related peoples in Ghana and Côte d’Ivoire whose histories include forest states, gold trade and matrilineal institutions.",
    facts: { "Geography and regions": "Southern and central Ghana and eastern Côte d’Ivoire.", "Political organisation": "States and chiefdoms organised through stools, councils and matrilineal clans; Asante developed a confederated kingdom.", "Religion and worldview": "Belief in a supreme creator, abosom spiritual beings and ancestors, alongside Christianity and Islam today.", "Archaeology": "Begho and other sites document long-distance trade and urban development in the forest–savannah zone.", "Art, architecture and technology": "Goldweights, lost-wax casting, kente weaving, wood carving and adinkra visual communication.", "Colonial and modern history": "British and French colonial rule divided Akan communities across modern borders; chiefly institutions remain influential." } },
  { slug: "hausa", name: "Hausa", region: "west-africa", language: "Hausa", summary: "A major West African people shaped by city-states, trans-Saharan commerce, Islamic scholarship and far-reaching language networks.",
    facts: { "Geography and regions": "Northern Nigeria and southern Niger, with communities across West and Central Africa.", "Political organisation": "Historic walled city-states led by rulers and councils; many were incorporated into the Sokoto Caliphate in the nineteenth century.", "Religion and worldview": "Islam has shaped public life and scholarship for centuries, alongside older practices and local traditions.", "Archaeology": "Walled settlements, craft quarters and trade goods document urbanism and regional exchange.", "Art, architecture and technology": "Decorated earthen architecture, indigo dyeing, leatherwork, embroidery and metalworking.", "Colonial and modern history": "British and French conquest reorganised emirates and borders while Hausa became a major regional lingua franca." } },
  { slug: "swahili", name: "Swahili", region: "east-africa", language: "Kiswahili", summary: "Coastal East African communities whose urban culture grew through African, Indian Ocean and Islamic connections.",
    facts: { "Geography and regions": "The East African coast and islands from southern Somalia through Kenya and Tanzania to northern Mozambique.", "Political organisation": "Independent coastal towns governed by local elites, councils and rulers, with changing Portuguese, Omani and Zanzibar influence.", "Religion and worldview": "Islam is central to Swahili historical identity, interpreted through local coastal traditions.", "Archaeology": "Coral-stone mosques, houses, imported ceramics and local material culture reveal centuries of urban life and oceanic exchange.", "Art, architecture and technology": "Coral-rag architecture, carved wooden doors, poetry, textiles and dhow-building traditions.", "Colonial and modern history": "European colonial boundaries divided the coast, while Kiswahili expanded as a regional and national language." } },
  { slug: "zulu", name: "Zulu", region: "southern-africa", language: "isiZulu", summary: "A Southern African people whose nineteenth-century kingdom and later struggles are central to the history of the region.",
    facts: { "Geography and regions": "Primarily KwaZulu-Natal and neighbouring parts of South Africa.", "Political organisation": "Lineage-based chiefdoms were consolidated into a kingdom under Shaka and his successors; monarchy and traditional councils continue in changed forms.", "Religion and worldview": "Ancestral relations, divination and a creator tradition coexist with diverse Christian practices.", "Archaeology": "Settlement remains and material studies illuminate homesteads, cattle economies and political consolidation.", "Art, architecture and technology": "Beadwork, basketry, ceramics, hideworking and distinctive homestead architecture.", "Colonial and modern history": "The kingdom resisted British invasion in 1879; dispossession, segregation and apartheid profoundly reshaped Zulu life." } },
];

export const paths = [
  "Study Igbo History", "Study Yoruba History", "Study African Kingdoms", "Study African Archaeology", "Study African Traditional Religions",
  "Study African Languages", "Study African Art and Material Culture", "Study African Political Systems", "Study Colonial Africa", "Study the African Diaspora",
].map((title, i) => ({ slug: title.toLowerCase().replace("study ", "").replace(/[^a-z]+/g, "-"), title, summary: "A guided sequence that answers: what should I study next to understand this subject?", steps: [courses[i % 6]!.slug, courses[(i + 1) % 6]!.slug, courses[(i + 3) % 6]!.slug] }));

export const programmes = [
  { slug: "igbo-language-expression", n: "01", title: "Igbo Language & Expression", summary: "From first sounds to confident speech, reading and writing.", meta: "4 courses · 24 weeks", steps: ["igbo-language-foundations", "proverbs-literature", "cosmology-epistemology", "oral-history-methods"] },
  { slug: "history-archive-community", n: "02", title: "History, Archive & Community", summary: "Read evidence, interpret oral traditions and place local histories in context.", meta: "3 courses · 20 weeks", steps: ["igbo-history-sources", "precolonial-governance", "oral-history-methods"] },
  { slug: "cultural-research-practice", n: "03", title: "Cultural Research Practice", summary: "A rigorous pathway into fieldwork, archives and ethical documentation.", meta: "3 courses · 22 weeks", steps: ["oral-history-methods", "igbo-history-sources", "cosmology-epistemology"] },
];

export const concepts = [
  { slug: "archaeological-interpretation", title: "Archaeological interpretation", skill: "Can interpret an archaeological find in context", mastery: "Proficient" as Mastery },
  { slug: "nri-political-organisation", title: "Nri political organisation", skill: "Understands Nri ritual authority and its reach", mastery: "Familiar" as Mastery },
  { slug: "oral-testimony", title: "Evaluating oral testimony", skill: "Can weigh oral testimony against other evidence", mastery: "Attempted" as Mastery },
  { slug: "lexical-tone", title: "Lexical tone", skill: "Hears and produces tone as meaning", mastery: "Mastered" as Mastery },
  { slug: "chronology-igbo-ukwu", title: "Dating Igbo-Ukwu", skill: "Explains how radiocarbon dates are used and limited", mastery: "Not started" as Mastery },
];

export const units = [
  { slug: "early-igbo-civilisation", course: "igbo-history-sources", title: "Early Igbo Civilisation", lessons: ["Igbo-Ukwu and Material Culture", "Dating the finds", "Trade networks and glass beads", "Nri and ritual authority"], concepts: ["archaeological-interpretation", "chronology-igbo-ukwu", "nri-political-organisation"] },
  { slug: "voices-and-records", course: "igbo-history-sources", title: "Voices and Records", lessons: ["What oral testimony preserves", "Colonial records and their gaps", "Triangulating evidence"], concepts: ["oral-testimony"] },
];

export const sources = [
  { slug: "igbo-ukwu-roped-pot", title: "Roped pot on a stand, Igbo-Ukwu", kind: "Primary · Artefact", date: "c. 9th–10th century CE", creator: "Igbo-Ukwu metalworkers", provenance: "Excavated by Thurstan Shaw, 1959–60; National Museum, Lagos.", limitations: "Function and patronage are inferred; the excavation context is incomplete for some items.", citation: "Shaw, T. (1970). Igbo-Ukwu: An Account of Archaeological Discoveries in Eastern Nigeria. Faber." },
  { slug: "nri-oral-testimony", title: "Testimony on Eze Nri's ritual journeys", kind: "Primary · Oral testimony", date: "Recorded 1970s", creator: "Nri elders, recorded by M. A. Onwuejeogwu", provenance: "Field notes published in Onwuejeogwu's study of Nri.", limitations: "Recalled generations later; shaped by the speakers' own position within Nri.", citation: "Onwuejeogwu, M. A. (1981). An Igbo Civilization: Nri Kingdom and Hegemony. Ethnographica." },
  { slug: "afigbo-ropes-of-sand", title: "Ropes of Sand", kind: "Secondary · Scholarship", date: "1981", creator: "Adiele Afigbo", provenance: "University Press Ltd, Ibadan.", limitations: "A synthesis; interpretations have since been debated and refined.", citation: "Afigbo, A. E. (1981). Ropes of Sand: Studies in Igbo History and Culture. UPL." },
];

export const timeline = [
  { year: "c. 900 CE", title: "Igbo-Ukwu bronzes cast", note: "Dates from radiocarbon; range is approximate.", source: "igbo-ukwu-roped-pot" },
  { year: "c. 1000–1100", title: "Ife naturalistic sculpture flourishes", note: "Dating based on thermoluminescence and stylistic sequence." },
  { year: "c. 1100s", title: "Emergence of Nri ritual authority", note: "Oral chronology; exact dates uncertain.", source: "nri-oral-testimony" },
  { year: "c. 1440", title: "Oba Ewuare expands Benin", note: "Court tradition, corroborated by later European accounts." },
  { year: "1897", title: "British expedition to Benin City", note: "Documented in military and press records." },
  { year: "1911", title: "Colonial suppression of Nri ritual journeys", note: "Recorded in colonial and Nri sources." },
];

export const mapSites = [
  { name: "Kumasi", kind: "Historic capital", region: "West Africa", x: 32, y: 46, culture: "akan", description: "A major centre of Asante political authority, trade and court culture." },
  { name: "Kano", kind: "Historic city", region: "West Africa", x: 45, y: 34, culture: "hausa", description: "A walled commercial and scholarly city within the historic Hausa city-state network." },
  { name: "Ile-Ife", kind: "Historical city", region: "West Africa", x: 37, y: 43, culture: "yoruba", description: "A sacred Yoruba city renowned for its artistic traditions and place in accounts of origin." },
  { name: "Benin City", kind: "Historical state", region: "West Africa", x: 40, y: 47, culture: "edo", description: "The royal centre of the Kingdom of Benin, known for its earthworks, palace and court arts." },
  { name: "Igbo-Ukwu", kind: "Archaeological site", region: "West Africa", x: 44, y: 46, culture: "igbo", description: "A ninth–tenth century site whose bronzes and beads reveal exceptional technical skill and wide exchange." },
  { name: "Nri", kind: "Ritual centre", region: "West Africa", x: 45, y: 44, culture: "igbo", description: "A centre of ritual authority associated with Nri influence across parts of Igboland." },
  { name: "Kilwa Kisiwani", kind: "Swahili city", region: "East Africa", x: 73, y: 63, culture: "swahili", description: "An island trading city whose ruins document Swahili urban life and Indian Ocean exchange." },
  { name: "Ulundi", kind: "Royal centre", region: "Southern Africa", x: 62, y: 84, culture: "zulu", description: "A nineteenth-century royal capital associated with King Cetshwayo and the Zulu kingdom." },
];

export const classroom = { name: "HIS 204 · University of Nigeria seminar", students: 24, assigned: "Unit: Early Igbo Civilisation", conceptInsights: concepts.slice(0, 4).map((c, i) => ({ ...c, proficientShare: [72, 41, 28, 88][i]! })) };
