import { assert } from "chai";
import {
  getSidebarPerformanceReport,
  recordSidebarPerformanceMetric,
  resetSidebarPerformanceMetrics,
  setSidebarPerformanceMetricsEnabled,
} from "../../../src/features/sidebar/ui/performanceMetrics.ts";

describe("sidebar performance metrics", function () {
  afterEach(function () {
    setSidebarPerformanceMetricsEnabled(false);
    resetSidebarPerformanceMetrics();
  });

  it("does not collect samples until explicitly enabled", function () {
    recordSidebarPerformanceMetric("markdown.parse", 4, { textLength: 10 });

    assert.deepEqual(getSidebarPerformanceReport(), {});
  });

  it("aggregates timing and input-size samples", function () {
    setSidebarPerformanceMetricsEnabled(true);
    recordSidebarPerformanceMetric("markdown.parse", 4, { textLength: 10 });
    recordSidebarPerformanceMetric("markdown.parse", 6, { textLength: 20 });

    const metric = getSidebarPerformanceReport()["markdown.parse"];
    assert.deepEqual(metric, {
      averageMs: 5,
      count: 2,
      maxMs: 6,
      samples: [
        { durationMs: 4, textLength: 10 },
        { durationMs: 6, textLength: 20 },
      ],
      totalMs: 10,
    });
  });

  it("keeps only a bounded tail of detailed samples", function () {
    setSidebarPerformanceMetricsEnabled(true);
    for (let index = 0; index < 250; index += 1) {
      recordSidebarPerformanceMetric("markdown.render", index, {
        textLength: index,
      });
    }

    const metric = getSidebarPerformanceReport()["markdown.render"];
    assert.equal(metric?.count, 250);
    assert.lengthOf(metric?.samples ?? [], 200);
    assert.equal(metric?.samples[0]?.textLength, 50);
    assert.equal(metric?.samples[199]?.textLength, 249);
  });
});
