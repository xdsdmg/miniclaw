/**
 * Quick smoke test for the new LLM layer.
 * Usage: npx ts-node scripts/test-llm.ts "hello"
 */
import { LLMProvider } from '../src/llm';

async function main() {
  const task = process.argv[2] || 'Say hi in one sentence';
  console.log(`Testing DeepSeek provider with task: ${task}\n`);

  const llm = new LLMProvider({ provider: 'deepseek' });

  console.log('Provider:', llm.provider);

  const response = await llm.generateResponse([
    { role: 'user', content: task },
  ], undefined);

  console.log('\nResponse content:', response.content);
  console.log('Tool calls:', response.toolCalls ? JSON.stringify(response.toolCalls) : '(none)');

  console.log('\n✅ LLM call succeeded');
}

main().catch((err) => {
  console.error('\n❌ LLM call failed:', err);
  process.exit(1);
});
