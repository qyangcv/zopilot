type PageRange = { pageStart?: number; pageEnd?: number };

function pageRangeContains(
  range: PageRange,
  page: number | undefined,
): boolean {
  return (
    page !== undefined &&
    range.pageStart !== undefined &&
    range.pageEnd !== undefined &&
    page >= range.pageStart &&
    page <= range.pageEnd
  );
}

export { pageRangeContains };
export type { PageRange };
