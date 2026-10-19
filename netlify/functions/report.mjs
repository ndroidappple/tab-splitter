import { handleReport } from '../lib/report.mjs';
import { tabStore } from '../lib/store.mjs';

// Off until REPORT_KEY is set in Netlify (Site configuration → Environment variables).
export default async (req, context) => handleReport(req, tabStore(context), process.env.REPORT_KEY);

export const config = { path: '/api/report' };
