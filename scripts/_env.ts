// Scripts load .env themselves so they run with plain `pnpm <script>`.
import { readFileSync, existsSync } from 'node:fs';
const file = new URL('../.env', import.meta.url);
if (existsSync(file))
	for (const line of readFileSync(file, 'utf8').split('\n')) {
		const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
		if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
	}
export const need = (k: string) => {
	const v = process.env[k];
	if (!v) throw new Error(`${k} is not set (see .env.example)`);
	return v;
};
