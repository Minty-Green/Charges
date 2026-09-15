import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const functionSource = source.match(
  /async function recordPendingLoginSuccess\(user\)\{[\s\S]*?\n\}\n\nasync function enterApp/
)?.[0]?.replace(/\n\nasync function enterApp$/, '');

assert.ok(functionSource, 'recordPendingLoginSuccess must be present');

async function runScenario(responses) {
  const storage = new Map([
    ['mintygreenPendingLoginSuccess', JSON.stringify({
      eventId: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      email: 'staff@example.com',
      at: Date.now()
    })]
  ]);
  const inserts = [];
  let responseIndex = 0;

  const context = vm.createContext({
    console: { warn() {} },
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      removeItem: key => storage.delete(key)
    },
    setTimeout: callback => callback(),
    sb: {
      from(table) {
        assert.equal(table, 'login_activity');
        return {
          async insert(payload) {
            inserts.push(payload);
            return responses[Math.min(responseIndex++, responses.length - 1)];
          }
        };
      }
    }
  });

  vm.runInContext(functionSource, context);
  await context.recordPendingLoginSuccess({
    id: '22222222-2222-4222-8222-222222222222',
    email: 'staff@example.com'
  });

  return { storage, inserts };
}

const retried = await runScenario([
  { error: { code: 'PGRST000' } },
  { error: { code: 'PGRST000' } },
  { error: null }
]);
assert.equal(retried.inserts.length, 3, 'transient failures should be retried');
assert.equal(retried.storage.size, 0, 'marker should clear after confirmed insert');
assert.equal(retried.inserts[0].event_id, '11111111-1111-4111-8111-111111111111');

const exhausted = await runScenario([{ error: { code: 'PGRST000' } }]);
assert.equal(exhausted.inserts.length, 3, 'all configured attempts should run');
assert.equal(exhausted.storage.size, 1, 'marker should survive a longer outage');

const duplicate = await runScenario([{ error: { code: '23505' } }]);
assert.equal(duplicate.inserts.length, 1, 'duplicate acknowledgement should stop retries');
assert.equal(duplicate.storage.size, 0, 'duplicate acknowledgement should clear marker');

console.log('Login audit regression check: 3/3 passed');
