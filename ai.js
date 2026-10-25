const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Put verified Zambian helpline / support numbers here.
// Leave as '' until you have confirmed real numbers.
const HELP_INFO = '';

const LANGUAGE_NAMES = {
  english: 'English',
  bemba: 'Bemba',
  nyanja: 'Nyanja (Chichewa)',
  tonga: 'Tonga (Chitonga)',
};

// Languages the AI is allowed to WRITE replies in.
// Add 'bemba', 'nyanja' or 'tonga' back only after fluent speakers
// have reviewed sample replies and approved them.
const AI_REPLY_LANGUAGES = ['english'];

// Pre-written replies for sensitive moments, written by humans.
// Fill in bemba / nyanja / tonga. Anything left '' falls back to English.
const SAFETY_REPLIES = {
  // Sent whenever a message is flagged as suicidal_thoughts
  keyword: {
    english:
      "I'm really sorry you're hurting this much. You matter, and you don't have to carry this alone. Please reach out to someone you trust right now. I am here to listen.",
    bemba: '',
    nyanja: '',
    tonga: '',
  },
  // Sent when the AI could not understand the message
  review: {
    english:
      'I want to make sure I understand you properly. How are you feeling right now? You are not alone, and I am here to listen.',
    bemba: '',
    nyanja: '',
    tonga: '',
  },
};

function safetyReply(kind, language) {
  const options = SAFETY_REPLIES[kind];
  const text = options[language] && options[language].trim() ? options[language] : options.english;
  return kind === 'keyword' && HELP_INFO ? `${text} ${HELP_INFO}` : text;
}

// Safety net: if the message contains any of these, ALWAYS flag it as
// suicidal_thoughts. Spaces and punctuation are ignored when matching, so
// "kill myself" and "killmyself" both match.
// Ask fluent speakers to check and extend the Bemba/Nyanja/Tonga entries.
const SELF_HARM_KEYWORDS = [
  // English
  'killmyself', 'killingmyself', 'killedmyself',
  'endmylife', 'endingmylife', 'endmyownlife',
  'takemyownlife', 'takemylife',
  'wanttodie', 'wishiwasdead', 'wishiwerendead', 'betteroffdead',
  'dontwanttolive', 'donotwanttolive', 'nolongerwanttolive',
  'hurtmyself', 'harmmyself', 'hangmyself',
  'suicid',
  // Bemba (verify spellings)
  'ukwipaya', 'kuipaya', 'kuyipaya',
  // Nyanja (verify)
  'kudzipha',
];

function containsKeyword(message) {
  const squashed = message.toLowerCase().replace(/[^a-z]/g, '');
  return SELF_HARM_KEYWORDS.some((k) => squashed.includes(k));
}

async function getAIResponse(userMessage, language = 'english') {
  const chosen = LANGUAGE_NAMES[language] ? language : 'english';
  const replyLanguage = AI_REPLY_LANGUAGES.includes(chosen) ? chosen : 'english';

  const prompt = `You are MindCare AI, a warm, culturally-aware wellness
companion for Zambian youth and adults. Someone just sent you this
message: "${userMessage}"

The person chose ${LANGUAGE_NAMES[chosen]} as their language in the app, but
they may type in English, Nyanja, Bemba, or Tonga, often with informal
spelling or spaces in odd places.

Steps:
1. Translate the message into English in "english_translation".
2. If you cannot confidently understand the message, set "understood" to
   false. NEVER guess a cheerful or harmless meaning for a message you do
   not understand.
3. Decide on the red flag from the translation. When unsure, lean towards
   flagging it.
4. Write "reply" in ${LANGUAGE_NAMES[replyLanguage]}.

Reply rules:
- Use short, simple, everyday words, the way a caring friend would speak.
- Always speak TO the person (you). Never repeat their words as if the
  problem were yours.
- Acknowledge how they feel before giving any suggestion.
- Keep the JSON keys and flag_type values in English exactly as shown below.

${HELP_INFO ? `If is_red_flag is true, end the reply by sharing this: ${HELP_INFO}` : ''}

Respond with ONLY a JSON object in this exact shape, nothing else:
{
  "english_translation": "the message translated into English",
  "understood": true or false,
  "reply": "a kind, supportive reply in 1-3 short sentences, in ${LANGUAGE_NAMES[replyLanguage]}",
  "is_red_flag": true or false,
  "flag_type": "suicidal_thoughts" or "substance_abuse" or "other_red_flag" or "none",
  "likely_cause": "short phrase in English describing the likely cause, or empty string if none"
}`;

  const completion = await groq.chat.completions.create({
    model: 'openai/gpt-oss-120b',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  });

  const result = JSON.parse(completion.choices[0].message.content);

  console.log('Translation:', result.english_translation, '| understood:', result.understood, '| flag:', result.flag_type);

  // Guard: flagged but no type given
  if (result.is_red_flag && (!result.flag_type || result.flag_type === 'none')) {
    result.flag_type = 'other_red_flag';
  }

  // Safety net 1: the AI did not understand -> flag for human review
  if (result.understood === false && !result.is_red_flag) {
    result.is_red_flag = true;
    result.flag_type = 'other_red_flag';
    result.likely_cause = 'message not clearly understood - needs human review';
    result.reply = safetyReply('review', chosen);
  }

  // Safety net 2: self-harm keyword found -> always flag
  if (containsKeyword(userMessage)) {
    result.is_red_flag = true;
    result.flag_type = 'suicidal_thoughts';
    result.likely_cause = result.likely_cause || 'possible self-harm wording (keyword match)';
  }

  // Any suicidal_thoughts flag (from the AI or the keyword net) gets the
  // pre-written human reply, never AI-written text
  if (result.flag_type === 'suicidal_thoughts') {
    result.reply = safetyReply('keyword', chosen);
  }

  return result;
}

module.exports = { getAIResponse };