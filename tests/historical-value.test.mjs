import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../dist/sensor-delta-card.js", import.meta.url), "utf8");
const context = vm.createContext({
  console: { info() {}, error() {} },
  HTMLElement: class {},
  customElements: { get() { return undefined; }, define() {} },
  window: { customCards: [] }
});
vm.runInContext(source, context);

const historyValues = rows => vm.runInContext("sdHistoryValues", context)(rows);
const valueAtTime = (values, target) => vm.runInContext("sdValueAtTime", context)(values, target);
const historyHref = (entity, now) => vm.runInContext("sdHistoryHref", context)(entity, now);
const moreInfoDetail = (entity, view) => vm.runInContext("sdMoreInfoDetail", context)(entity, view);

test("uses the last reading at or before the target", () => {
  const values = historyValues([
    { state: "34.5", last_changed: "2026-08-09T13:20:00Z" },
    { state: "34.2", last_changed: "2026-08-09T13:09:00Z" }
  ]);

  assert.equal(valueAtTime(values, Date.parse("2026-08-09T13:12:00Z")), 34.2);
});

test("uses an exact timestamp when one exists", () => {
  const values = historyValues([
    { state: "20", last_changed: "2026-08-09T12:00:00Z" },
    { state: "21", last_changed: "2026-08-09T13:00:00Z" }
  ]);

  assert.equal(valueAtTime(values, Date.parse("2026-08-09T13:00:00Z")), 21);
});

test("returns null when history does not reach the target", () => {
  const values = historyValues([
    { state: "21", last_changed: "2026-08-09T13:00:00Z" }
  ]);

  assert.equal(valueAtTime(values, Date.parse("2026-08-09T12:59:59Z")), null);
});

test("ignores invalid states and timestamps", () => {
  const values = historyValues([
    { state: "unknown", last_changed: "2026-08-09T12:00:00Z" },
    { state: "22", last_changed: "invalid" },
    { state: "23", last_updated: "2026-08-09T13:00:00Z" }
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(values)), [
    { t: Date.parse("2026-08-09T13:00:00Z"), v: 23 }
  ]);
});

test("builds the native Home Assistant history link for the selected entity", () => {
  const href = historyHref("sensor.outdoor temperature", new Date(2026, 7, 14, 12));
  const url = new URL(href, "https://home-assistant.local");

  assert.equal(url.pathname, "/history");
  assert.equal(url.searchParams.get("entity_id"), "sensor.outdoor temperature");
  assert.equal(url.searchParams.get("back"), "1");

  const start = new Date(url.searchParams.get("start_date"));
  assert.equal(start.getDate(), 13);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
});

test("builds native Home Assistant more-info requests for entity subviews", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(moreInfoDetail("sensor.outdoor_temperature", "related"))),
    { entityId: "sensor.outdoor_temperature", view: "related" }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(moreInfoDetail("sensor.outdoor_temperature", "details"))),
    { entityId: "sensor.outdoor_temperature", view: "details" }
  );
});
