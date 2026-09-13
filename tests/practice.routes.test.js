const fs = require('fs');
const path = require('path');

describe('practice routes auth wiring', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/kits/kit.routes.js'),
    'utf8'
  );

  test('practice routes require protect and ownsKit', () => {
    expect(source).toMatch(/router\.get\('\/:id\/practice',\s*protect,\s*ownsKit,\s*getPractice\)/);
    expect(source).toMatch(
      /router\.post\(\s*'\/:id\/practice\/flashcards\/:flashcardId',\s*protect,\s*ownsKit,\s*postPracticeAttempt\s*\)/
    );
  });
});
