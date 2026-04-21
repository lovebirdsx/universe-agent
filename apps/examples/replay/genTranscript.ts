import * as path from 'node:path';
import { generateTranscript } from '@universe-agent/agent';

const dirArg = process.argv[2];
if (!dirArg) {
  console.error('用法: tsx apps/examples/replay/genTranscript.ts <录像目录>');
  console.error(
    '示例: tsx apps/examples/replay/genTranscript.ts .data/recordings/apps-examples-research-researchAgent',
  );
  process.exit(1);
}

const dirPath = path.resolve(dirArg);
console.log(`正在从 ${dirPath} 生成 transcript.md ...`);
generateTranscript(dirPath);
console.log('完成！');
