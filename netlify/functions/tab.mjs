import { getStore } from '@netlify/blobs';
import { handle } from '../lib/core.mjs';

export default async (req) => handle(req, getStore({ name: 'tab-split', consistency: 'strong' }));

export const config = { path: '/api/tab' };
