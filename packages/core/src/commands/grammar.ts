/**
 * The offline command grammar. Every core task works through it with no AI
 * model and no network (PLAN principle 3). Patterns are data so other
 * languages can ship their own pack (AR-23).
 */

export type ElementKind = 'link' | 'button' | 'heading' | 'field' | 'landmark' | 'image' | 'text' | 'any';
export type ListKind = 'headings' | 'links' | 'landmarks' | 'controls' | 'buttons' | 'images' | 'tables' | 'warnings' | 'fields';
export type MoveUnit = 'heading' | 'link' | 'landmark' | 'control' | 'paragraph' | 'item';

export interface Target {
  kind: ElementKind;
  /** 1-based position in the current list; negative counts from the end. */
  ordinal?: number;
  name?: string;
}

export type Intent =
  | { type: 'navigate'; target: string }
  | { type: 'search'; query: string; site?: boolean }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload' }
  | { type: 'home' }
  | { type: 'panic' }
  | { type: 'stop' }
  | { type: 'read'; what: 'page' | 'title' | 'summary' | 'description' }
  | { type: 'continue' }
  | { type: 'repeat' }
  | { type: 'more' }
  | { type: 'move'; dir: 'next' | 'previous'; unit: MoveUnit; level?: number }
  | { type: 'jump'; to: 'main' | 'top' | 'end' | 'search' }
  | { type: 'where' }
  | { type: 'list'; what: ListKind }
  | { type: 'activate'; target: Target }
  | { type: 'fill'; target: Target; value: string }
  | { type: 'check'; target: Target; checked: boolean }
  | { type: 'choose'; target: Target; option: string }
  | { type: 'submit' }
  | { type: 'find'; text: string }
  | { type: 'discover' }
  | { type: 'help' }
  | { type: 'speech'; setting: 'faster' | 'slower' | 'normal-speed' | 'terse' | 'normal' | 'guided' }
  | { type: 'images' }
  | { type: 'sent-log' }
  | { type: 'privacy'; action: 'never-ai-here' | 'forget-ai-consent' }
  | { type: 'privacy-notice' }
  | { type: 'yes' }
  | { type: 'no' };

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, last: -1, '1st': 1, '2nd': 2, '3rd': 3,
};
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
};

function parseNumber(s: string): number | undefined {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s in NUMBER_WORDS) return NUMBER_WORDS[s];
  const m = /^(\d+)(st|nd|rd|th)$/.exec(s);
  if (m) return parseInt(m[1]!, 10);
  return ORDINALS[s];
}

const KIND_WORDS: [RegExp, ElementKind][] = [
  [/^(links?|hyperlinks?)$/, 'link'],
  [/^(buttons?)$/, 'button'],
  [/^(headings?|headers?|titles?|sections?)$/, 'heading'],
  [/^(fields?|boxe?s?|inputs?|text ?box(es)?|edit ?box(es)?|check ?box(es)?|controls?|dropdowns?|menus?|lists?|options?)$/, 'field'],
  [/^(landmarks?|regions?)$/, 'landmark'],
  [/^(images?|pictures?|photos?|graphics?)$/, 'image'],
  [/^(results?|items?|ones?)$/, 'any'],
];

function kindOf(word: string): ElementKind | undefined {
  for (const [re, k] of KIND_WORDS) if (re.test(word)) return k;
  return undefined;
}

/** "the third link", "link 3", "the sign in button", "search box", "3" */
export function parseTarget(phrase: string, defaultKind: ElementKind = 'any'): Target {
  let p = phrase.trim().toLowerCase().replace(/^(on|at|in|into)\s+/, '').replace(/^(the|a|an|that|this)\s+/, '');
  p = p.replace(/[.!?]$/, '').trim();
  const words = p.split(/\s+/);
  // "third link", "last button", "2nd result"
  if (words.length >= 1) {
    const n = parseNumber(words[0]!);
    if (n !== undefined && words.length <= 2) {
      const k = words[1] ? kindOf(words[1]) : undefined;
      if (words.length === 1 || k) return { kind: k ?? defaultKind, ordinal: n };
    }
  }
  // "link 3", "result number 4"
  if (words.length >= 2) {
    const k = kindOf(words[0]!);
    const tail = words.slice(1).filter((w) => w !== 'number');
    const n = tail.length === 1 ? parseNumber(tail[0]!) : undefined;
    if (k && n !== undefined) return { kind: k, ordinal: n };
  }
  // "the sign in button", "email field", "link to contact us"
  const last = words[words.length - 1]!;
  const lastKind = words.length > 1 ? kindOf(last) : undefined;
  if (lastKind) return { kind: lastKind, name: words.slice(0, -1).join(' ') };
  const first = kindOf(words[0]!);
  if (first && words.length > 1) {
    return { kind: first, name: words.slice(1).join(' ').replace(/^(to|for|called|named|labell?ed|that says)\s+/, '') };
  }
  return { kind: defaultKind, name: p };
}

type Rule = [RegExp, (m: RegExpMatchArray) => Intent | null];

const R = (re: string) => new RegExp(`^(?:${re})$`, 'i');

const LIST_WORDS: Record<string, ListKind> = {
  heading: 'headings', headings: 'headings', headers: 'headings', sections: 'headings', outline: 'headings',
  link: 'links', links: 'links', landmarks: 'landmarks', regions: 'landmarks', controls: 'controls',
  buttons: 'buttons', images: 'images', pictures: 'images', tables: 'tables', warnings: 'warnings',
  fields: 'fields', form: 'fields', forms: 'fields', 'form fields': 'fields', results: 'links',
};

/** English grammar pack. Order matters: specific rules first. */
export const EN_RULES: Rule[] = [
  [R('(?:stop|quiet|shush|silence|hush|pause|be quiet|shut up)'), () => ({ type: 'stop' })],
  [R('(?:get me out(?: of here)?|panic|emergency|escape|close this(?: page)?(?: now)?|take me home now)'), () => ({ type: 'panic' })],
  [R('(?:yes|yeah|yep|ok(?:ay)?|sure|go ahead|do it|confirm)'), () => ({ type: 'yes' })],
  [R('(?:no|nope|cancel|never ?mind|don\'?t)'), () => ({ type: 'no' })],
  [R('(?:help|commands|what can i say|what do i say|how does this work)'), () => ({ type: 'help' })],
  [R('(?:what can i do(?: here)?|options|what(?:\'s| is) here|what are my options|suggestions)'), () => ({ type: 'discover' })],
  [R('(?:where am i|what page is this|what(?:\'s| is) this page|status)'), () => ({ type: 'where' })],
  [R('(?:go )?back|previous page|go to (?:the )?previous page'), () => ({ type: 'back' })],
  [R('(?:go )?forward|next page'), () => ({ type: 'forward' })],
  [R('(?:reload|refresh)(?: (?:the )?page)?'), () => ({ type: 'reload' })],
  [R('(?:go )?home|home ?page|start page'), () => ({ type: 'home' })],
  [R('(?:continue|keep (?:going|reading)|go on|resume|read on)'), () => ({ type: 'continue' })],
  [R('(?:repeat|say (?:that|it) again|again|what(?: did you say)?|pardon|sorry)'), () => ({ type: 'repeat' })],
  [R('(?:more|next (?:ten|10|few)|keep listing)'), () => ({ type: 'more' })],
  [R('(?:read|say|what(?:\'s| is)) (?:the )?(?:page )?title'), () => ({ type: 'read', what: 'title' })],
  [R('(?:summari[sz]e|summary|give me (?:a|the) summary|tl;?dr|gist)(?: (?:this|the) (?:page|article))?'), () => ({ type: 'read', what: 'summary' })],
  [R('(?:read|start reading|read (?:it|this|the (?:page|article|content|story|text|main content))(?: (?:to me|aloud|out loud))?|read from (?:the )?(?:top|start|beginning))'), () => ({ type: 'read', what: 'page' })],
  [R('(?:what(?:\'s| is) (?:this|it|the)(?: page| site| article)? about|describe (?:this|the) page|overview)'), () => ({ type: 'read', what: 'description' })],
  [R('(?:skip to |go to |jump to )?(?:the )?main(?: content)?'), () => ({ type: 'jump', to: 'main' })],
  [R('(?:go to |jump to )?(?:the )?(?:top|start)(?: of (?:the )?page)?'), () => ({ type: 'jump', to: 'top' })],
  [R('(?:go to |jump to )?(?:the )?(?:bottom|end)(?: of (?:the )?page)?'), () => ({ type: 'jump', to: 'end' })],
  [R('(?:list|show|read|what are|tell me|give me)(?: me)?(?: (?:the|all))? (headings?|headers|sections|outline|links|landmarks|regions|controls|buttons|images|pictures|tables|warnings|fields|forms?|form fields|results)(?: on (?:this|the) page)?'), (m) => ({ type: 'list', what: LIST_WORDS[m[1]!.toLowerCase()]! })],
  [R('(?:describe|what are) (?:the )?(?:images|pictures|photos)'), () => ({ type: 'images' })],
  [R('(?:any )?warnings\\??|is (?:this|it) safe\\??|is this (?:site|page) (?:safe|legit(?:imate)?|real)\\??'), () => ({ type: 'list', what: 'warnings' })],
  [R('(next|previous|prev|last) (heading|link|landmark|region|control|field|button|paragraph|item|result)(?: level (\\d))?'), (m) => ({
    type: 'move',
    dir: m[1]!.toLowerCase() === 'next' ? 'next' : 'previous',
    unit: ({ region: 'landmark', field: 'control', button: 'control', result: 'heading' } as Record<string, MoveUnit>)[m[2]!.toLowerCase()] ?? (m[2]!.toLowerCase() as MoveUnit),
    ...(m[3] ? { level: parseInt(m[3], 10) } : {}),
  })],
  [R('(?:go to |jump to )?(?:the )?search(?: box| field)?'), () => ({ type: 'jump', to: 'search' })],
  [R('search (?:this|the) (?:site|page) for (.+)'), (m) => ({ type: 'search', query: m[1]!, site: true })],
  [R('(?:search the web|find online|search|look up|google) (?:for )?(.+)'), (m) => ({ type: 'search', query: m[1]! })],
  [R('(?:find the (?:word|text|phrase)|where does it say|find on (?:this |the )?page) (.+?)(?: on (?:this|the) page)?'), (m) => ({ type: 'find', text: m[1]! })],
  // Bare "find X" is find-on-page only for short phrases; "find the cheapest
  // laptop under $500" is a task for the model.
  [R('(?:find|look for) ((?:\\S+\\s*){1,3}?)(?: on (?:this|the) page)?'), (m) => ({ type: 'find', text: m[1]!.trim() })],
  [R('(?:speak |talk |read )?(faster|quicker|speed up)'), () => ({ type: 'speech', setting: 'faster' })],
  [R('(?:speak |talk |read )?(slower|slow down)'), () => ({ type: 'speech', setting: 'slower' })],
  [R('(?:normal|default) speed'), () => ({ type: 'speech', setting: 'normal-speed' })],
  [R('(?:be )?(?:brief|terse|shorter|less detail|expert mode)'), () => ({ type: 'speech', setting: 'terse' })],
  [R('(?:more detail|explain more|guided mode|beginner mode|be more helpful)'), () => ({ type: 'speech', setting: 'guided' })],
  [R('(?:normal|standard) (?:mode|detail|verbosity)'), () => ({ type: 'speech', setting: 'normal' })],
  [R('what did you send(?: to (?:the )?ai)?\\??|(?:show|read) (?:the )?(?:ai )?(?:privacy )?log'), () => ({ type: 'sent-log' })],
  [R('(?:never|don\'?t ever) (?:send|share) (?:this (?:site|page) )?(?:to|with) (?:the )?ai(?: on this site)?'), () => ({ type: 'privacy', action: 'never-ai-here' })],
  [R('(?:forget|reset) (?:ai |my )?(?:consent|permissions)(?: for this site)?'), () => ({ type: 'privacy', action: 'forget-ai-consent' })],
  [R('privacy|privacy (?:notice|policy)|what do you do with my data|is my data (?:safe|private)\\??'), () => ({ type: 'privacy-notice' })],
  [R('submit(?: (?:the|this) form)?|send (?:the )?form'), () => ({ type: 'submit' })],
  // Forms — "fill email with x", "type x into email", "enter x in the name field", "set email to x"
  [R('(?:fill(?: in)?|fill out) (.+?) (?:with|as) (.+)'), (m) => ({ type: 'fill', target: parseTarget(m[1]!, 'field'), value: m[2]! })],
  [R('(?:type|enter|write|put) (.+?) (?:in|into|in to|on) (.+)'), (m) => ({ type: 'fill', target: parseTarget(m[2]!, 'field'), value: m[1]! })],
  [R('set (.+?) to (.+)'), (m) => ({ type: 'fill', target: parseTarget(m[1]!, 'field'), value: m[2]! })],
  [R('(?:my )?(email|e-mail|name|full name|first name|last name|phone|phone number|address|zip|zip code|postcode|postal code|city|username|user name) is (.+)'), (m) => ({ type: 'fill', target: { kind: 'field', name: m[1]! }, value: m[2]! })],
  [R('my ((?:\\S+\\s){0,2}\\S+) is (.+)'), (m) => ({ type: 'fill', target: { kind: 'field', name: m[1]! }, value: m[2]! })],
  [R('(?:choose|select|pick) (.+?) (?:from|in|for) (.+)'), (m) => ({ type: 'choose', target: parseTarget(m[2]!, 'field'), option: m[1]! })],
  [R('check ?out|go to (?:the )?checkout|proceed to checkout'), () => ({ type: 'activate', target: { kind: 'any', name: 'checkout' } })],
  [R('(?:uncheck|untick|deselect|turn off|disable|clear) (.+)'), (m) => ({ type: 'check', target: parseTarget(m[1]!, 'field'), checked: false })],
  [R('(?:check|tick|turn on|enable) (.+)'), (m) => ({ type: 'check', target: parseTarget(m[1]!, 'field'), checked: true })],
  [R('(?:click|press|tap|activate|hit|push|select|choose|pick|follow|open link|open result)(?: on)? (.+)'), (m) => ({ type: 'activate', target: parseTarget(m[1]!) })],
  // "go to bbc.com", "open the weather", "visit example dot com"
  [R('(?:go to|open|visit|navigate to|take me to|load|browse to|show me) (.+)'), (m) => ({ type: 'navigate', target: m[1]! })],
  // Bare ordinal / number after a list: "3", "the third one"
  [R('(?:number )?(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|first|second|third|fourth|fifth|last)(?: one)?'), (m) => ({ type: 'activate', target: { kind: 'any', ordinal: parseNumber(m[1]!.toLowerCase())! } })],
];

/** Parse a command. Returns null when the grammar doesn't understand it. */
export function parseCommand(input: string, rules: Rule[] = EN_RULES): Intent | null {
  const text = input
    .trim()
    .replace(/^(?:hey |ok |okay )?(?:frontier|browser|computer)[,:]?\s+/i, '')
    .replace(/^(?:please|can you|could you|would you|i want to|i'd like to|let'?s)\s+/i, '')
    .replace(/\s+(?:please|for me|now)$/i, '')
    .replace(/[.!]+$/, '')
    .trim();
  if (!text) return null;
  for (const [re, make] of rules) {
    const m = text.match(re);
    if (m) {
      const intent = make(m);
      if (intent) return intent;
    }
  }
  return null;
}

/** Heuristic: is this a question (read-only "ask" mode) or a task ("act" mode)? (AR-2) */
export function isQuestion(input: string): boolean {
  const t = input.trim().toLowerCase();
  return /\?$/.test(t) || /^(what|who|whom|whose|when|where|why|how|which|is|are|was|were|does|do|did|can|could|should|would|will|has|have|tell me|explain|summari[sz]e|describe|compare|list|give me|any)\b/.test(t);
}
