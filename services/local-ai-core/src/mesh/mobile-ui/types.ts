export interface UIElement {
  index: number;
  text: string;
  desc?: string;
  id?: string;
  className: string;
  bounds: [number, number, number, number]; // [left, top, right, bottom]
  center: [number, number];                 // [cx, cy]
  clickable: boolean;
  editable: boolean;
  scrollable: boolean;
  selected?: boolean;
}

export interface UIDumpResult {
  ok: boolean;
  package: string;
  activity?: string;
  screenWidth: number;
  screenHeight: number;
  count: number;
  elements: UIElement[];
}

export interface UIStatusResult {
  ok: boolean;
  version?: string;
  serviceEnabled: boolean;
  currentPackage?: string;
  currentActivity?: string;
  screenWidth?: number;
  screenHeight?: number;
}

export interface ClickOptions {
  index?: number;
  text?: string;
  id?: string;
  point?: [number, number];
}

export interface ClickResult {
  ok: boolean;
  target?: Partial<UIElement>;
  method?: 'action_click' | 'gesture_tap';
  error?: string;
}

export interface InputOptions {
  text: string;
  index?: number;
  clear?: boolean;
}

export interface InputResult {
  ok: boolean;
  inputText: string;
  targetIndex?: number;
  error?: string;
}

export interface ScrollOptions {
  direction: 'down' | 'up' | 'left' | 'right';
  distance?: number;
  durationMs?: number;
}

export interface ScrollResult {
  ok: boolean;
  direction: string;
  error?: string;
}

export interface ActionOptions {
  action: 'back' | 'home' | 'recents';
}

export interface ActionResult {
  ok: boolean;
  action: string;
  error?: string;
}

export interface WaitOptions {
  text?: string;
  id?: string;
  timeoutSeconds?: number;
  intervalMs?: number;
}

export interface MobileUiClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}
