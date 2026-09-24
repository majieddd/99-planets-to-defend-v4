import { formatResult, parseBotArgs, runBot } from './runBot';

console.log(formatResult(runBot(parseBotArgs(process.argv.slice(2)))));
