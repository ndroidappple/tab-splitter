import { handle } from '../lib/core.mjs';
import { tabStore, previewStoreFor } from '../lib/store.mjs';

export default async (req, context) => handle(req, tabStore(context), undefined, previewStoreFor(context));

export const config = { path: '/api/tab' };
