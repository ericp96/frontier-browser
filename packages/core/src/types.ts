/**
 * Shared types for Frontier Browser. Everything here is plain data so it can
 * cross process boundaries (page ↔ main process ↔ model) as JSON.
 */

/** Stable handle for an element inside a page, e.g. "e12". */
export type Ref = string;

export type PageKind =
  | 'article'
  | 'search-results'
  | 'form'
  | 'product'
  | 'listing'
  | 'app'
  | 'page';

export interface Landmark {
  ref: Ref;
  role: string;
  name: string;
}

export interface Heading {
  ref: Ref;
  level: number;
  text: string;
}

export interface LinkInfo {
  ref: Ref;
  text: string;
  href: string;
  /** Link leaves the current site. */
  external: boolean;
  /** Link lives inside the main content (not nav/footer chrome). */
  inMain: boolean;
}

export type SensitiveKind = 'password' | 'payment' | 'otp' | 'government-id' | 'bank';

export type ControlKind =
  | 'textbox'
  | 'textarea'
  | 'search'
  | 'email'
  | 'password'
  | 'number'
  | 'tel'
  | 'url'
  | 'date'
  | 'checkbox'
  | 'radio'
  | 'select'
  | 'button'
  | 'submit'
  | 'slider'
  | 'file'
  | 'combobox'
  | 'switch';

export interface ControlInfo {
  ref: Ref;
  kind: ControlKind;
  name: string;
  /** Current value. Never populated for sensitive fields. */
  value?: string;
  /** True if a sensitive field has any value (without revealing it). */
  hasValue?: boolean;
  required: boolean;
  invalid: boolean;
  disabled: boolean;
  checked?: boolean;
  /** Checkbox was already checked when the page loaded (possible dark pattern). */
  prechecked?: boolean;
  options?: string[];
  description?: string;
  /** Validation message associated with the field, if any. */
  error?: string;
  sensitive?: SensitiveKind;
  /** Ref of the owning form, if any. */
  form?: Ref;
  /** For buttons: the form's action URL, used by the safety gate. */
  formAction?: string;
}

export interface ImageInfo {
  ref: Ref;
  /** Author-provided alt text; null when missing entirely. */
  alt: string | null;
  decorative: boolean;
  src: string;
  inMain: boolean;
}

export interface TableInfo {
  ref: Ref;
  caption: string;
  rows: number;
  cols: number;
  headers: string[];
}

export type BlockKind = 'heading' | 'paragraph' | 'list-item' | 'quote' | 'code' | 'caption' | 'text';

/** A readable unit of the main content. */
export interface Block {
  ref: Ref;
  kind: BlockKind;
  text: string;
  level?: number;
}

export type WarningKind =
  | 'captcha'
  | 'prechecked-optin'
  | 'insecure-password'
  | 'modal-open'
  | 'urgency-timer'
  | 'unlabelled-controls'
  | 'lookalike-domain'
  | 'scam-suspected';

export interface PageWarning {
  kind: WarningKind;
  message: string;
  ref?: Ref;
}

export interface PageDigest {
  url: string;
  origin: string;
  title: string;
  lang: string;
  kind: PageKind;
  landmarks: Landmark[];
  headings: Heading[];
  links: LinkInfo[];
  controls: ControlInfo[];
  images: ImageInfo[];
  tables: TableInfo[];
  /** Main content in reading order. */
  main: Block[];
  /** Short plain-text description of the page (meta description or first paragraph). */
  description: string;
  warnings: PageWarning[];
  /** Number of elements excluded because they're hidden from assistive tech. */
  hiddenCount: number;
  /** Lists were capped to keep the digest small enough for small models. */
  truncated: boolean;
  /** Ref of the focused element, if any. */
  focused?: Ref;
}

export type ElementAction =
  | { type: 'click'; ref: Ref }
  | { type: 'focus'; ref: Ref }
  | { type: 'type'; ref: Ref; text: string; clear?: boolean }
  | { type: 'select'; ref: Ref; option: string }
  | { type: 'check'; ref: Ref; checked: boolean }
  | { type: 'scroll'; ref: Ref }
  | { type: 'submit'; ref: Ref };

export interface ActionResult {
  ok: boolean;
  message?: string;
  /** Present when the action selected a specific option/value. */
  value?: string;
}

export interface DigestOptions {
  maxLinks?: number;
  maxControls?: number;
  maxBlocks?: number;
  maxHeadings?: number;
  maxBlockChars?: number;
}
