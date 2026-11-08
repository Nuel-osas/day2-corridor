// Resume or recover a transfer: pnpm relay out <suiDigest> | pnpm relay in <0xBaseHash>
import './_env.js';
import { follow } from './_follow.js';
const [direction, tx] = process.argv.slice(2);
if ((direction !== 'out' && direction !== 'in') || !tx) throw new Error('usage: pnpm relay out <suiDigest> | in <0xhash>');
await follow(direction, tx);
