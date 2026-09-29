# About-page research: nkowaokwu.com and ozikoro.com

Fetched and read in full on the dates of this research, with `curl -sL` and HTML tags stripped.

Both pages returned HTTP 200 and both are server-rendered — neither is JavaScript-rendered, so no sibling-URL fallback was needed. Raw sizes: `nkowaokwu.com/about` is 176 KB of HTML yielding about 5,960 characters of visible text; `ozikoro.com/about/` is 109 KB yielding about 2,250 characters.

Sibling checks on ozikoro.com, for the record: `/dictionary/`, `/about-us/`, and `/igbo-dictionary/` all return HTTP 404. `/about/` is the canonical page.

---

## A. nkowaokwu.com/about — full content inventory

Presented in page order. Section headings are quoted verbatim.

### Hero

Heading: **"Spreading Igbo culture around the world"**

Directly beneath it, the same sentence appears twice, as two separate blocks:

> "Nkọwa okwu is a 501(c)(3) non-profit organization focused on building accessible and robust Igbo language learning tools."

Each copy is followed by a "Join us" button. Both buttons are `<button>` elements carrying no href — they are JavaScript-handled, so the destination is not recorded in the HTML. A world-map image sits alongside the hero.

### "How We Started"

> "Nkọwa okwu is a non-profit founded by Ijemma Onwuzulike in 2020 from the desire to have reliable, well-maintained Igbo language learning tools."

> "She noticed that something as foundational as an Igbo dictionary wasn't readily available. She decided to create a digital dictionary so the resource could be accessed from anywhere."

### "Our Mission"

> "Nkọwa okwu was built on the foundation that we believe Igbo education should be free and easy to access."

> "Igbo is a rich language with more than 20 known dialects, thats why for any search you make on the Igbo Dictionary you are provided with the word, a voice recording, the accented word, the parts of speech, the variations, definitions, example sentences, along with its dialectal variations, and more."

(The page's wording, including "thats", is reproduced as written.)

### "The Dictionary"

> "Nkọwa okwu leverages the Igbo API that hosts over 25,000 words, 100,000 example Igbo sentences, and 100,000 audio pronunciations and 17 dialectal variations."

Contribution model:

> "Because we believe the language is defined by its community, Nkọwa okwu supports open-contributions from you. You can add words, dialectal variations, and even example Igbo sentences. Users any where in the world can change/update the Igbo Dictionary by submitting a suggested edit."

Outbound link labelled "Igbo Dictionary" → `https://igboapi.com`.

### "The Team"

Fourteen people, each presented as a photograph, a name, and a short role description.

| Name | Title | Remit as written |
|---|---|---|
| Ijemma Onwuzulike | Co-founder and CEO | "Ijemma is the Co-founder and CEO of Nkọwa okwu. She wears multiple hats to ensure that progress on the core product, Nkọwa okwu Learning, is made. On top of that she engages with the online Igbo community to grow our Slack volunteer community." Also linked to `https://www.linkedin.com/in/ijemmao/`. |
| Ebube Chuba | Co-founder and Head of AI | "Ebube is the Co-founder and Head of AI at Nkọwa okwu. He focuses on building our AI features used inside and outside our community. The voice-enabled search was a project he wanted to see come to life." |
| Laura Nwogu | Head of Operations | "Laura is the Head of Operations at Nkọwa okwu. She is responsible for ensuring our community members know how to start contributing in addition to reaching out organizations for partnerships and collaborations." |
| Emeka Ukaga | Head of Product | "Emeka is the Head of Product at Nkọwa okwu. He is responsible for improving the user experience and quality of all our projects. He also works closely with outside organizations to define partnerships." |
| Obioha Nmezi | in-house Senior Translator and Audio Recorder | "Obioha serves as in-house Senior Translator and Audio Recorder for adding, updating, and verifying the thousands of words and example sentences in the Igbo API." |
| Eze Ojukwu | Translator, specialisation in Nsịbịdị | "Eze is a translator with a specialization in Nsịbịdị who focuses on maintaining and expanding the Nsịbịdị data within the Igbo API and Nkọwa okwu." |
| Uche Muonago | Translator | "Uche is a translator with a specialization and focus in the practice of creating modern Igbo words in the dictionary." |
| Egorp David | Product Designer | "David is a Product Designer who primarily works on the designs for the entire Nkọwa okwu platform, which includes Nkọwa okwu Learning." |
| Angel Chukwu | UI/UX Researcher | "Angel Chukwu is a UI/UX Researcher that focuses on enhancing our internal products that enable our editors and audio recorders to enhance the content in the Igbo API dictionary." |
| Mary Mazi | Senior Backend Software Engineer | "Mary is a senior Backend Software Engineer primarily working on Nkọwa okwu Learning." |
| Robert Orazu | Mid-level Backend Software Engineer | "Robert is a mid-level Backend Software Engineer primary working on Nkọwa okwu Learning." |
| Kola Muhammed | Communications/copy (no formal title given) | "Kola manages our email newsletters, Medium blog posts, and general copy across our multiple projects." |
| Ijeoma Onwuzulike | Business Operator | "Ijeoma is our Business Operator solely responsible for finding funding sources for the company alongside engaging with our volunteer community to make sure that progress is being made." |
| Hyginus Ugwumba | Business Budgeter | "Hyginus is our Business Budgeter who's responsible for defining quarterly budgets for employees and finding qualified members to join the contributors." |

The team block closes with an Igbo proverb and a community statement:

> "Otu onye tuo izu, o gbue ochu! Nkọwa okwu is supported by a growing community of more than one hundred members. We are grateful to the people who work on these projects, to make them available for everyone learning Igbo."

Followed by a third "Join us" button.

### "Mentioned In"

Six linked logos. The only machine-readable label for each is its `alt` text; the displayed name is inside the logo image.

| alt text | Outbound link |
|---|---|
| Nigerian Tribune | `https://tribuneonlineng.com/why-i-created-first-igbo-english-online-open-to-cont…` |
| Umu Igbo Unite | `https://www.ozisco.com/tag/nkowa-okwu/` |
| Built in Africa | `https://www.builtinafrica.io/blog-post/ijemma-onwuzulike-igbo-api` |
| Nuesroom | `https://neusroom.com/her-igbo-parents-didnt-teach-her-the-language-so-ijemma-onw…` |
| We Dey Code | `https://www.youtube.com/watch?v=kjHi7p1j-ts` |
| Nasdaq | `https://thecenter.nasdaq.org/foe-ijemma-onwuzulike-nkowa-okwu` |

### "Supported By"

One linked logo:

| alt text | Outbound link |
|---|---|
| Lacuna Fund | `https://lacunafund.org` |

Nothing else appears in this section.

### "You can be a part of our journey"

Donation copy, presented twice in near-identical form — once with "expansions", once with "expansion":

> "Your support of Nkọwa okwu encourages the expansions and modernization of the Igbo language in the digital space."

> "Your support of Nkọwa okwu encourages the expansion and modernization of the Igbo language in the digital space. If you believe in what we're doing and want to support, please donate 🤍"

A preset amount, "$15.00", and a "Donate" button linking to `https://donate.stripe.com/dR62aP6UlcmE3kIfYY`.

### "Frequently asked questions"

Five items.

1. **"Is there an iOS or Android app for Nkọwa okwu?"** — "There is currently only an Android app for Nkọwa okwu, which can be found here." (the word "here" is a link).
2. **"How do I suggest new words?"** — "To suggest a new word you can click on the plus sign beside the search bar, then fill the form by providing an English headword, including its parts of speech, definitions, variations and helpful contextual comments to assist our editors."
3. **"I found an error in a word, how can I fix it?"** — "After searching for a word you can find an edit button just below. Click on the button and choose the option to edit a word."
4. **"I don't see a fitting role? Can I still contribute to Nkọwa okwu?"** — "We're always happy to welcome new contributors. Please check out our volunteer page to identify a role that suits you. Don't see a fitting role? No worries. Fill out the Volunteer Form describing what you can add to this project!"
5. **"How can I delete my account?"** — "You can delete your account by sending a request to kedu@nkowaokwu.com" — this email address is the only contact detail on the page.

### Footer

Tagline: "Learning Igbo made easy, free, and accessible."

A mailing-list block with the field label "Join our mailing list" and a "Register" button.

Three grouped link columns:

- **Explore** — Home, Volunteer (`https://nkowaokwu.com/volunteer`)
- **Organization** — About (`/about`), Nsịbịdị (`/nsibidi`)
- **Legal** — Privacy (`/privacy`), Terms & Conditions (`/terms`)

Social accounts: X/Twitter (`twitter.com/nkowaokwu`), Instagram (`instagram.com/nkowaokwu/`), LinkedIn company page (`linkedin.com/company/nkowa-okwu`), Medium (`medium.com/@nkowaokwu`).

Copyright line: "© 2026 Nkọwa okwu 501(c)(3). All rights reserved."

### Absent from this page

No data licence or open-source licence statement; no technology stack or framework credit; no data source named other than the Igbo API; no changelog; no roadmap; no street address; no phone number; no learner or user statistics; no founding timeline beyond the year 2020; no financial information or annual report; no historical contributors roll beyond the fourteen named.

---

## B. ozikoro.com/about/ — full content inventory

Server-rendered WordPress/Elementor. The text is present in the HTML and no JavaScript execution is required; the page is simply short, at roughly 2,250 characters of visible text.

### Headings, verbatim

- h1: **"About US"**
- **"Welcome to Ozikoro"**
- **"Our Aim"**
- **"What We Do"**

Below the h1 sits a breadcrumb: "Home About US".

### "Welcome to Ozikoro"

> "Ozikoro was born out of a passion for preserving the cultural heritage of African peoples. Our mission is to explore the often-overlooked aspects of African history and culture, to understand the societal structures, spiritual traditions, philosophies, and ways of life that thrived across the continent long before colonial contact. We aspire to make this a platform where history meets anthropology, customs, and indigenous knowledge systems that continue to shape African identity today."

### "Our Aim"

> "The primary motivation for this website is to challenge the misconceptions we have inherited about African history. Our ancestors were deliberately dehumanised by those who sought to exploit them, and though time has passed, the effects of that distortion remain. These false narratives have continued to influence global and African media, education, politics, and culture, reinforcing habits of self-neglect and a diminished sense of self-awareness. Ozikoro exists to question, correct, and reclaim that history."

### "What We Do"

> "At Ozikoro, we create a rich repository of articles, research, and thought pieces that celebrate African heritage in all its forms. From the ancient origins of African civilisations and the spiritual systems that guided them, to the social norms, artistic expressions, and political institutions of precolonial societies, we strive to illuminate the vast and interconnected stories that define Africa's past and present. Our goal is to educate, inspire, and spark meaningful conversations, encouraging readers to reconnect with their roots and engage with the diverse traditions that make up the African world."

### Navigation (repeated above the content and again below it)

- Cultural Heritage — `https://ozikoro.com/cultural-heritage/`
- Historical Studies — `https://ozikoro.com/historical-studies/`
- Discography — `https://ozikoro.com/discography/`
- Indigenous Architecture — `https://ozikoro.com/indigenous-architecture/`
- Ethnohistory — `https://ozikoro.com/ethnohistory/`
- Religion and Spirituality — `https://ozikoro.com/%e2%81%a0religion-and-spirituality/`
- Biography — `https://ozikoro.com/biography/`
- Folklores — `https://ozikoro.com/folklores/`
- Proverbs & Idioms — `https://ozikoro.com/proverbsidioms/`
- Privacy Policy — `https://ozikoro.com/privacy-policy/`
- Contact Us — `https://ozikoro.com/?page_id=3591`

### Footer

> "Ozikoro ©. All Rights Reserved."

Social links: Facebook (`facebook.com/OziIkoro`), X (`twitter.com/OziIkoro`), YouTube (`youtube.com/@OziIkoro`), Instagram (`instagram.com/OziIkoro/`). A theme toggle offering "Default" and "Dark". A footer image with an empty `alt` attribute, `image-1-copyright.jpg`, whose content is not recoverable as text.

### How it frames the archive/history side against a dictionary side

It does not frame them at all, because the page never mentions a dictionary. The string "dictionary" does not appear anywhere in the page HTML, and no dictionary URL exists on the site — `/dictionary/`, `/igbo-dictionary/` both return 404. The only language-adjacent item anywhere in the navigation is the "Proverbs & Idioms" category. The history and archive side is the entirety of what this page describes.

### Founders, team and ownership

No person is named anywhere on the page: no founders, no contributors, no authors, no team list, no advisory board. The only ownership signal is the footer copyright line, "Ozikoro ©. All Rights Reserved." Contact exists only as a navigation link to a separate Contact Us page; no address, email, or phone number appears on the about page itself. There are no statistics, no sources, no licensing, no FAQ, no funding acknowledgment, and no press mentions.

---

## C. What nkowaokwu's about page includes that a typical about page does not

- **A full team roster with individual roles** — fourteen people, not just the founders, including staff roles most projects never list: an in-house translator and audio recorder, and a translator specialising in a single script (Nsịbịdị).
- **A one-to-two sentence remit for each person**, so the reader learns what each actually does, plus photographs and one personal LinkedIn link.
- **The upstream data layer named and linked** — the Igbo API, credited by name with an outbound link to igboapi.com.
- **Quantified dataset statistics**: over 25,000 words, 100,000 example Igbo sentences, 100,000 audio pronunciations, 17 dialectal variations.
- **An itemised account of what one search returns**: the word, a voice recording, the accented word, the parts of speech, the variations, definitions, example sentences, and dialectal variations.
- **Two distinct contribution routes** — adding content (words, dialectal variations, example sentences) and correcting it (a suggested-edit flow on any existing entry).
- **Community attribution**: an Igbo proverb plus the statement that the project is supported by "a growing community of more than one hundred members".
- **Press recognition as linked logos** under "Mentioned In", and **a funder acknowledged** under "Supported By" (Lacuna Fund).
- **Tax status stated explicitly** — 501(c)(3) — in the body copy and again in the footer.
- **A five-item operational FAQ**, including how to get the app, how to add a word, how to fix an error, how to volunteer without a matching role, and how to delete an account.
- **A donation flow** with a preset amount ($15.00) and a live payment link.
- **Legal and sibling-project links from the footer** — Privacy, Terms & Conditions, and the Nsịbịdị sub-project — plus a Slack volunteer community, a Medium blog, and a LinkedIn company page.

For contrast, ozikoro.com/about/ contains none of these except a copyright line.

---

## D. Structural outline of a complete about page

A numbered outline only; prose not written.

1. **Hero** — one sentence saying what the project is and its legal or organisational form, plus a single primary action.
2. **Origin** — who started it, in what year, and the specific gap or frustration that triggered it, kept concrete rather than abstract.
3. **Mission** — the belief the project rests on, and what the language or subject itself is (its scale, dialects, range).
4. **What it returns** — the unit of value the user actually gets, itemised entry by entry.
5. **Data layer** — the upstream source named and linked, with counts: entries, example sentences, audio recordings, variants.
6. **Contribution** — how to add content, how to correct it, who reviews submissions, and that it is open to anyone.
7. **Team** — founders first, then every role with a one-line remit; close with the wider volunteer community.
8. **Credits** — press mentions and funders, each one linked out.
9. **Support** — donation copy, a preselected amount, and a payment link.
10. **FAQ** — four to six operational questions covering apps, adding, fixing, volunteering, and account deletion.
11. **Contact** — a named address or form, easy to find rather than buried in the FAQ.
12. **Related projects** — sibling sites or products, in one or two lines.
13. **Legal** — privacy, terms, and a licence or reuse statement for the data if one exists.
14. **Footer** — tagline, newsletter signup, grouped link columns, social accounts, and the copyright line.
