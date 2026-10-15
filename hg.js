import { App } from './hg/app.js';
import { TextProxy } from './hg/text-proxy.js';
import { Events } from './hg/events.js';
import { Resources } from './hg/resources.js';
import { Storage } from './hg/storage.js';
import { Strings } from './hg/strings.js';
import { Layout } from './hg/layout.js';

// One mutable namespace object; state belongs to explicitly supplied apps.
const hg = { App, Events, TextProxy, Resources, Storage, Strings, Layout };
export default hg;
