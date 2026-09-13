const fs = require('fs');
const path = require('path');

describe('kit routes auth wiring', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/kits/kit.routes.js'),
    'utf8'
  );

  test('core kit routes require protect', () => {
    expect(source).toMatch(/router\.post\('\/',\s*protect,\s*createKit\)/);
    expect(source).toMatch(/router\.get\('\/',\s*protect,\s*listKits\)/);
    expect(source).toMatch(/router\.get\('\/:id',\s*protect,\s*ownsKit,\s*getKit\)/);
    expect(source).toMatch(/router\.delete\('\/:id',\s*protect,\s*ownsKit,\s*deleteKit\)/);
    expect(source).toMatch(/router\.get\('\/:id\/progress',\s*protect,\s*ownsKit/);
  });

  test('core kit routes do not use unauthenticated loadKit', () => {
    expect(source).not.toMatch(/loadKit/);
    expect(source).not.toMatch(/optionalProtect/);
  });
});
