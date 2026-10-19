import { handleReport } from '../lib/report.mjs';
import { tabStore } from '../lib/store.mjs';

// The host opens /api/report?t=<tab>&key=<host key>; the tab page links to it.
export default async (req, context) => handleReport(req, tabStore(context));

export const config = { path: '/api/report' };
