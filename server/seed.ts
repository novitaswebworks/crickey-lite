import { createContext } from './context';
import { DATA_DIR } from './paths';
import { seedDemo } from './seed-data';

const ctx = await createContext(DATA_DIR);
const { matchId } = seedDemo(ctx);
console.log(`Seeded demo teams and match #${matchId} (now the active match).`);
console.log('Start the app with "npm start" and open the Live Scoring page.');
ctx.store.close();
