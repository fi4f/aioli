import { App } from './app.js';
import { TextProxy } from './text-proxy.js';
import { Events } from './events.js';

// One mutable namespace object; state belongs to explicitly supplied apps.
const hg = { App, Events, TextProxy };
export default hg;
