import type { QueryPlan } from "../types";

export { parseRetrievalQuery, routeQuery };

function parseRetrievalQuery(question: string | undefined): QueryPlan {
  const query = (question || "").trim();
  const lower = query.toLowerCase();
  const locator = findLocator(query);
  return {
    query,
    intent: locator?.type || inferIntent(lower),
    locator,
    includeReferences:
      /\b(reference|references|bibliography|citation|cite|related work)\b/i.test(
        query,
      ),
  };
}

const routeQuery = parseRetrievalQuery;

function inferIntent(lower: string): QueryPlan["intent"] {
  if (/abstract|summary|summari[sz]e|概括|总结|摘要/.test(lower)) {
    return "summary";
  }
  if (/metadata|title|author|year|venue|元数据|作者/.test(lower)) {
    return "metadata";
  }
  return "general";
}

function findLocator(query: string): QueryPlan["locator"] | undefined {
  const table =
    /\b(?:table|tab\.)\s*(\d+(?:\.\d+)*)\b|表\s*(\d+(?:\.\d+)*)/i.exec(query);
  if (table) {
    return { type: "table", value: table[1] || table[2] };
  }
  const figure =
    /\b(?:figure|fig\.)\s*(\d+(?:\.\d+)*)\b|图\s*(\d+(?:\.\d+)*)/i.exec(query);
  if (figure) {
    return { type: "figure", value: figure[1] || figure[2] };
  }
  const equation =
    /\b(?:equation|eq\.|formula)\s*(\d+(?:\.\d+)*)\b|(?:公式|方程)\s*(\d+(?:\.\d+)*)/i.exec(
      query,
    );
  if (equation) {
    return { type: "equation", value: equation[1] || equation[2] };
  }
  const page = /\bpage\s*(\d+)\b|第\s*(\d+)\s*页/i.exec(query);
  if (page) {
    const value = page[1] || page[2];
    return { type: "page", value, page: Number(value) };
  }
  return undefined;
}
