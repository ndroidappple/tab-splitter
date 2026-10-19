import { handle } from '../lib/core.mjs';
import { tabStore } from '../lib/store.mjs';

export default async (req, context) => handle(req, tabStore(context));

export const config = { path: '/api/tab' };
