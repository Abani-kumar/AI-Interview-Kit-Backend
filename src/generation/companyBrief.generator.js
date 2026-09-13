export function generateCompanyBrief(pages) {
  const source = pages[0];
  return { summary: source ? source.text.slice(0, 400) || 'No company information was retrieved.' : 'No company information was retrieved.', what_they_do: source ? source.text.slice(0, 700) || 'No company details were available.' : 'No company details were available.', sources: pages.map((page) => page.url) };
}
