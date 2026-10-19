import { getStore } from '@netlify/blobs';

// Production keeps the original store. Deploy previews and branch deploys get
// their own, so trying a preview can never change the live tab.
export function tabStore(context) {
  const where = context && context.deploy && context.deploy.context;
  const name = !where || where === 'production' ? 'tab-split' : `tab-split-${where}`;
  return getStore({ name, consistency: 'strong' });
}

// On the live site only: where deploy previews kept their tabs, so a host can bring one over.
export function previewStoreFor(context) {
  const where = context && context.deploy && context.deploy.context;
  return where === 'production' ? getStore({ name: 'tab-split-deploy-preview', consistency: 'strong' }) : null;
}
