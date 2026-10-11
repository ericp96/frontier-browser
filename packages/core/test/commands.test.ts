import { describe, expect, test } from 'vitest';
import { isQuestion, parseCommand, parseTarget } from '../src/commands/grammar.js';
import { normalizeDictation, toUrl } from '../src/text/dictation.js';

describe('grammar', () => {
  const cases: [string, unknown][] = [
    ['stop', { type: 'stop' }],
    ['Get me out of here!', { type: 'panic' }],
    ['go back', { type: 'back' }],
    ['please go back', { type: 'back' }],
    ['go to bbc.co.uk', { type: 'navigate', target: 'bbc.co.uk' }],
    ['open example dot com', { type: 'navigate', target: 'example dot com' }],
    ['search for cheap flights to Lisbon', { type: 'search', query: 'cheap flights to Lisbon' }],
    ['search this site for returns', { type: 'search', query: 'returns', site: true }],
    ['read the article', { type: 'read', what: 'page' }],
    ['summarize this page', { type: 'read', what: 'summary' }],
    ['what is this page about', { type: 'read', what: 'description' }],
    ['next heading', { type: 'move', dir: 'next', unit: 'heading' }],
    ['next heading level 2', { type: 'move', dir: 'next', unit: 'heading', level: 2 }],
    ['previous link', { type: 'move', dir: 'previous', unit: 'link' }],
    ['skip to main content', { type: 'jump', to: 'main' }],
    ['list headings', { type: 'list', what: 'headings' }],
    ['what are the links', { type: 'list', what: 'links' }],
    ['is this site safe?', { type: 'list', what: 'warnings' }],
    ['click the third link', { type: 'activate', target: { kind: 'link', ordinal: 3 } }],
    ['click link 3', { type: 'activate', target: { kind: 'link', ordinal: 3 } }],
    ['press the sign in button', { type: 'activate', target: { kind: 'button', name: 'sign in' } }],
    ['3', { type: 'activate', target: { kind: 'any', ordinal: 3 } }],
    ['the last one', null],
    ['fill email with sam at example dot com', { type: 'fill', target: { kind: 'field', name: 'email' }, value: 'sam at example dot com' }],
    ['type hello world into the message box', { type: 'fill', target: { kind: 'field', name: 'message' }, value: 'hello world' }],
    ['my zip code is 90210', { type: 'fill', target: { kind: 'field', name: 'zip code' }, value: '90210' }],
    ['choose Canada from country', { type: 'choose', target: { kind: 'field', name: 'country' }, option: 'Canada' }],
    ['uncheck send me offers', { type: 'check', target: { kind: 'field', name: 'send me offers' }, checked: false }],
    ['check out', { type: 'activate', target: { kind: 'any', name: 'checkout' } }],
    ['submit the form', { type: 'submit' }],
    ['find the word potassium', { type: 'find', text: 'potassium' }],
    ['speak faster', { type: 'speech', setting: 'faster' }],
    ['be brief', { type: 'speech', setting: 'terse' }],
    ['what can I do here', { type: 'discover' }],
    ['where am I', { type: 'where' }],
    ['what did you send to the AI?', { type: 'sent-log' }],
    ['never send this site to the AI', { type: 'privacy', action: 'never-ai-here' }],
    ['yes', { type: 'yes' }],
    ['privacy', { type: 'privacy-notice' }],
    ['is my data private?', { type: 'privacy-notice' }],
    ['Frontier, read it', { type: 'read', what: 'page' }],
    ['how much is the laptop with 16GB?', null],
  ];
  test.each(cases)('%s', (input, expected) => {
    expect(parseCommand(input)).toEqual(expected);
  });

  test('targets', () => {
    expect(parseTarget('the second result')).toEqual({ kind: 'any', ordinal: 2 });
    expect(parseTarget('last button')).toEqual({ kind: 'button', ordinal: -1 });
    expect(parseTarget('link to contact us')).toEqual({ kind: 'link', name: 'contact us' });
  });

  test('question vs task (ask vs act mode)', () => {
    expect(isQuestion('How much does it cost?')).toBe(true);
    expect(isQuestion('what are the opening hours')).toBe(true);
    expect(isQuestion('add the blue one to my cart')).toBe(false);
    expect(isQuestion('book a table for two at seven')).toBe(false);
  });
});

describe('dictation', () => {
  test.each([
    ['john dot smith at gmail dot com', 'john.smith@gmail.com'],
    ['spell j o h n underscore 9 9 at example dot org', 'john_99@example.org'],
    ['mary dash jane at mail dot co dot uk', 'mary-jane@mail.co.uk'],
    ['alpha bravo seven at x dot io', 'ab7@x.io'],
    ['double t at a dot com', 'tt@a.com'],
  ])('%s → %s', (spoken, expected) => {
    expect(normalizeDictation(spoken, 'email')).toBe(expected);
  });

  test('urls', () => {
    expect(toUrl('bbc.co.uk')).toBe('https://bbc.co.uk');
    expect(toUrl('example dot com slash news')).toBe('https://example.com/news');
    expect(toUrl('localhost:8080')).toBe('http://localhost:8080');
    expect(toUrl('the weather')).toBeNull();
  });
});
