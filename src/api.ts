import { createClient } from '@supabase/supabase-js';
import type { Snapshot } from './game';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(url && key && !url.includes('your-project') && key !== 'your-publishable-key');
const client = configured ? createClient(url, key) : null;
export async function callGame(action: string, code: string, payload: Record<string, unknown> = {}): Promise<Snapshot> {
  if (!client) throw new Error('Online rooms need Supabase setup. See README.md to connect your project.');
  const { data: session } = await client.auth.getSession();
  if (!session.session) {
    const { error } = await client.auth.signInAnonymously();
    if (error) throw new Error(`Could not join anonymously: ${error.message}`);
  }
  const { data, error } = await client.rpc('hot_game', { p_action: action, p_code: code, p_payload: payload });
  if (error) throw new Error(error.message);
  return data as Snapshot;
}
