/**
 * The six things a contributor can add, one component each.
 *
 * Pulled out of the old single /contribute page, where every form sat stacked on one
 * screen. The markup is the same — what changed is that each one now has a page, a
 * heading of its own and a sidebar entry, so a person arrives at the one they came for.
 */
import type { LanguageInfo } from '@ozituma/db/repository';

type Lang = { code: string; name: string };

const SELECT =
  'width:100%;padding:0.55rem 0.7rem;border:1px solid #e6e0d6;border-radius:8px;background:#fff;font:inherit;color:inherit';

export function WordForm({ languages }: { languages: LanguageInfo[] }) {
  return (
    <form className="cd-form" method="post" action="/api/contributions">
      <input type="hidden" name="kind" value="new_word" />
      <div className="cd-field">
        <label htmlFor="language">Language</label>
        <select id="language" name="language" style={{ width: '100%' }}>
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name} ({l.nativeName})
            </option>
          ))}
        </select>
      </div>
      <div className="cd-field">
        <label htmlFor="headword">Word or phrase</label>
        <input id="headword" name="headword" required maxLength={120} spellCheck={false} placeholder="e.g. ọ̀dị́nàlà" />
        <p className="cd-help">Include diacritics if you can. Plain letters are still searchable.</p>
      </div>
      <div className="cd-field">
        <label htmlFor="definitions">Meanings in English</label>
        <textarea id="definitions" name="definitions" required rows={4} placeholder={'One meaning per line\nhouse\nhome'} />
        <p className="cd-help">One meaning per line. Put the most common meaning first.</p>
      </div>
      <div className="cd-row">
        <div className="cd-field">
          <label htmlFor="partOfSpeech">Grammar category (optional)</label>
          <input id="partOfSpeech" name="partOfSpeech" maxLength={20} placeholder="e.g. NNC" />
        </div>
        <div className="cd-field">
          <label htmlFor="dialectNote">Which variety is it said in? (optional)</label>
          <input id="dialectNote" name="dialectNote" maxLength={1000} placeholder="e.g. Ọnịcha" />
        </div>
      </div>
      <div className="cd-field">
        <label htmlFor="example">Example sentence (optional)</label>
        <input id="example" name="example" maxLength={500} />
      </div>
      <div className="cd-field">
        <label htmlFor="exampleTranslation">Example translation (optional)</label>
        <input id="exampleTranslation" name="exampleTranslation" maxLength={500} />
      </div>
      <div className="cd-field">
        <label htmlFor="note">Note for the reviewer (optional)</label>
        <textarea id="note" name="note" rows={2} maxLength={1000} placeholder="Where did this come from? Which town uses it?" />
      </div>
      <div className="cd-actions">
        <button className="cd-btn" type="submit">Submit the word</button>
      </div>
    </form>
  );
}

export function NameForm({ language }: { language: Lang }) {
  return (
    <form className="cd-form" method="post" action="/api/contributions">
      <input type="hidden" name="kind" value="new_name" />
      <input type="hidden" name="language" value={language.code} />
      <div className="cd-field">
        <label htmlFor="nameName">Name</label>
        <input id="nameName" name="name" required maxLength={120} spellCheck={false} placeholder="e.g. Chidiebube" />
      </div>
      <div className="cd-field">
        <label htmlFor="nameMeaning">What it means</label>
        <input id="nameMeaning" name="meaning" maxLength={600} placeholder="e.g. God is wonderful" />
      </div>
      <div className="cd-field">
        <label htmlFor="nameGender">Gender</label>
        <select id="nameGender" name="gender" style={{ width: '100%' }}>
          <option value="unisex">Unisex</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
        <p className="cd-help">Choose male or female only if a source says so — father and mother in a name are not signals.</p>
      </div>
      <div className="cd-row">
        <div className="cd-field">
          <label htmlFor="nameVariants">Other spellings (optional)</label>
          <input id="nameVariants" name="variants" maxLength={600} placeholder="separated by commas" />
        </div>
        <div className="cd-field">
          <label htmlFor="nameOrigins">Where it is borne (optional)</label>
          <input id="nameOrigins" name="origins" maxLength={600} placeholder="towns or clans" />
        </div>
      </div>
      <div className="cd-field">
        <label htmlFor="nameNote">Note for the reviewer (optional)</label>
        <textarea id="nameNote" name="note" rows={2} maxLength={1000} placeholder="Who bears it, and where?" />
      </div>
      <div className="cd-actions">
        <button className="cd-btn" type="submit">Submit the name</button>
      </div>
    </form>
  );
}

export function ProverbForm({ language }: { language: Lang }) {
  return (
    <form className="cd-form" method="post" action="/api/contributions">
      <input type="hidden" name="kind" value="new_proverb" />
      <input type="hidden" name="language" value={language.code} />
      <div className="cd-field">
        <label htmlFor="proverbText">The proverb</label>
        <textarea id="proverbText" name="text" required rows={2} maxLength={600} placeholder="e.g. Ọ bụ nwayọọ ka e ji aracha ọfe dị ọkụ" />
      </div>
      <div className="cd-field">
        <label htmlFor="proverbTranslation">What it means in English (optional)</label>
        <textarea id="proverbTranslation" name="translation" rows={2} maxLength={600} />
        <p className="cd-help">
          If you have one, send it. If it came from a book or a page, say so below — a proverb with
          no English is held until one is found.
        </p>
      </div>
      <div className="cd-field">
        <label htmlFor="proverbNote">Note for the reviewer (optional)</label>
        <textarea id="proverbNote" name="note" rows={2} maxLength={1000} placeholder="Where did you hear it? Which town says it this way?" />
      </div>
      <div className="cd-actions">
        <button className="cd-btn" type="submit">Submit the proverb</button>
      </div>
    </form>
  );
}

export function ClanForm({ divisions }: { divisions: string[] }) {
  return (
    <form className="cd-form" method="post" action="/api/contributions">
      <input type="hidden" name="kind" value="new_clan" />
      <div className="cd-row">
        <div className="cd-field">
          <label htmlFor="clanName">Name</label>
          <input id="clanName" name="name" required maxLength={120} spellCheck={false} placeholder="e.g. Ozubulu" />
        </div>
        <div className="cd-field">
          <label htmlFor="clanKind">What it is</label>
          <select id="clanKind" name="entryKind" style={{ width: '100%' }}>
            <option value="clan">Clan</option>
            <option value="town">Town</option>
            <option value="section">Section</option>
            <option value="confederation">Confederation of clans</option>
            <option value="kingdom">Kingdom</option>
            <option value="other">Something else</option>
          </select>
        </div>
      </div>
      <div className="cd-field">
        <label htmlFor="clanDivision">Division of Igboland (optional)</label>
        <select id="clanDivision" name="division" style={{ width: '100%' }}>
          <option value="">Not sure</option>
          {divisions.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>
      <div className="cd-row">
        <div className="cd-field">
          <label htmlFor="clanStates">State or states today</label>
          <input id="clanStates" name="states" maxLength={300} placeholder="e.g. Anambra" />
          <p className="cd-help">The present-day state, not a colonial division.</p>
        </div>
        <div className="cd-field">
          <label htmlFor="clanLgas">Local government areas (optional)</label>
          <input id="clanLgas" name="lgas" maxLength={400} placeholder="e.g. Ekwusigo, Nnewi North" />
        </div>
      </div>
      <div className="cd-field">
        <label htmlFor="clanTowns">Towns and villages in it</label>
        <textarea id="clanTowns" name="towns" rows={4} maxLength={6000} placeholder="One per line, or separated by commas" />
        <p className="cd-help">A clan with no town under it is not accepted — the registry's rule.</p>
      </div>
      <div className="cd-field">
        <label htmlFor="clanOrigin">Summary (optional)</label>
        <input id="clanOrigin" name="origin" maxLength={600} placeholder="one or two sentences for the index card" />
      </div>
      <div className="cd-field">
        <label htmlFor="clanDescription">Description (optional)</label>
        <textarea id="clanDescription" name="description" rows={5} maxLength={6000} placeholder="Leave a blank line between paragraphs" />
        <p className="cd-help">A summary or a description is needed — a reviewer must have something to check.</p>
      </div>
      <div className="cd-field">
        <label htmlFor="clanNote">Note for the reviewer (optional)</label>
        <textarea id="clanNote" name="note" rows={2} maxLength={1000} placeholder="Where does this account come from?" />
      </div>
      <div className="cd-actions">
        <button className="cd-btn" type="submit">Submit the entry</button>
      </div>
    </form>
  );
}

export function DialectForm({ language }: { language: Lang }) {
  return (
    <form className="cd-form" method="post" action="/api/contributions">
      <input type="hidden" name="kind" value="new_dialect" />
      <input type="hidden" name="language" value={language.code} />
      <div className="cd-row">
        <div className="cd-field">
          <label htmlFor="dialectName">Name of the variety</label>
          <input id="dialectName" name="name" required maxLength={120} spellCheck={false} placeholder="e.g. Ọnịcha" />
        </div>
        <div className="cd-field">
          <label htmlFor="dialectCode">Short code</label>
          <input id="dialectCode" name="code" required maxLength={24} spellCheck={false} placeholder="e.g. Onicha" />
          <p className="cd-help">Letters, digits, spaces, hyphens or underscores.</p>
        </div>
      </div>
      <div className="cd-row">
        <div className="cd-field">
          <label htmlFor="dialectNative">Name in the variety itself (optional)</label>
          <input id="dialectNative" name="nativeName" maxLength={120} />
        </div>
        <div className="cd-field">
          <label htmlFor="dialectRegion">Where it is spoken (optional)</label>
          <input id="dialectRegion" name="region" maxLength={120} placeholder="a town, an LGA, a state" />
        </div>
      </div>
      <div className="cd-field">
        <label htmlFor="dialectNote">Note for the reviewer (optional)</label>
        <textarea id="dialectNote" name="note" rows={2} maxLength={1000} />
      </div>
      <div className="cd-actions">
        <button className="cd-btn" type="submit">Submit the variety</button>
      </div>
    </form>
  );
}

export function RecordingForm({ language, dialects }: { language: Lang; dialects: { code: string; name: string }[] }) {
  return (
    <form className="cd-form" method="post" action="/api/audio" encType="multipart/form-data">
      <input type="hidden" name="language" value={language.code} />
      <div className="cd-field">
        <label htmlFor="audioHeadword">The word being said</label>
        <input id="audioHeadword" name="headword" required maxLength={120} spellCheck={false} placeholder="e.g. ụlọ" />
        <p className="cd-help">The word must already be published, so add it first if it is not.</p>
      </div>
      <div className="cd-field">
        <label htmlFor="audioFile">The recording</label>
        <input id="audioFile" name="file" type="file" accept="audio/*" required />
        <p className="cd-help">A sound file under two minutes. Your browser can record one for you.</p>
      </div>
      <div className="cd-field">
        <label htmlFor="audioDialect">Which variety is it said in? (optional)</label>
        <select id="audioDialect" name="dialectCode" style={{ width: '100%' }}>
          <option value="">Not stated</option>
          {dialects.map((d) => (
            <option key={d.code} value={d.code}>{d.name} ({d.code})</option>
          ))}
        </select>
      </div>
      <div className="cd-field">
        <label htmlFor="audioNote">Note for the reviewer (optional)</label>
        <textarea id="audioNote" name="provenanceNote" rows={2} maxLength={1000} placeholder="Who is speaking? Where is this said?" />
      </div>
      <div className="cd-actions">
        <button className="cd-btn" type="submit">Submit the recording</button>
      </div>
    </form>
  );
}

export { SELECT };
