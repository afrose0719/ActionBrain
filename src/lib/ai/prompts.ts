// Rules shared by every extraction prompt (Inbox and Meetings). Review round 3: language, honest dates, evidence.

/** Extra fields every extracted item may carry, appended to each item's JSON shape in the prompts. */
export const EXTRA_ITEM_FIELDS = `"language":"en"|"ta"|"hi"|"ml"|"te"|"kn"|"ta-Latn"|"hi-Latn"|"mixed"|"other","date_unclear"?:boolean`;

export const LANGUAGE_AND_DATE_RULES = `Languages:
- Messages may be in English, Tamil, Hindi, Malayalam, Telugu, Kannada, or mixed (Tanglish = Tamil in Latin letters, Hinglish = Hindi in Latin letters).
- language = the language of the quoted text: "ta-Latn" for Tanglish, "hi-Latn" for Hinglish, "mixed" when several are used.
- Write title and description in clear English. quote stays EXACTLY as written, in the original language and script.
- Common time words: Tamil naalai / naalaiku / naalaikku = tomorrow, inniku / indru = today, nethu = yesterday; Hindi aaj = today,
  parson = the day after tomorrow OR the day before yesterday, kal = tomorrow OR yesterday.
Dates:
- If a date could mean two days (Hindi "kal" or "parson" without a clear future tense, "next Friday" said on a Thursday, a time with no day),
  set "date_unclear": true, give your best guess in due_date, and lower confidence. Never present a guess as certain.
- Ordinary chat with no action or promise ("ok", "thanks", "see you") produces nothing.`;
